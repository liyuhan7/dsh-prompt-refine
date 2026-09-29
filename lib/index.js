import z from '@deepseek-ai/schemastery'
import { SYSTEM_STRATEGY, promptFor } from './strategy.js'
import { normalizeOutput, selectRoute, validText } from './protocol.js'
import { validateOptimizedPrompt } from './prompt-validator.js'

export const name = 'dsh-prompt-refine'
export const inject = ['webServer', 'llm', 'sessions', 'sessionProjections', 'agentDefaultModel']
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  fallbackProvider: z.string().default('').volatile(),
  fallbackModel: z.string().default('').volatile(),
  temperature: z.number().min(0).max(2).default(0.3).volatile(),
  maxOutputTokens: z.number().step(1).min(1).max(16384).default(2048).volatile(),
  timeoutMs: z.number().step(1).min(1000).max(300000).default(60000).volatile(),
  maxInputChars: z.number().step(1).min(1).max(100000).default(12000).volatile(),
  customRules: z.string().default('').volatile(),
  streaming: z.boolean().default(true).volatile()
})
const ROUTE = '/dsh-prompt-refine/api'
const DEFAULTS = { enabled: true, fallbackProvider: '', fallbackModel: '', temperature: 0.3, maxOutputTokens: 2048, timeoutMs: 60000, maxInputChars: 12000, customRules: '', streaming: true }
function settings(config) {
  const result = {}
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const field = config?.[key]
    const value = typeof field?.get === 'function' ? field.get() : field
    result[key] = value ?? fallback
  }
  return result
}
function send(res, status, data) {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(data))
}
function ipv4Loopback(value) {
  const parts = value.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
}
function loopbackAddress(address) {
  if (typeof address !== 'string') return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return ipv4Loopback(normalized.slice(7))
  return ipv4Loopback(normalized)
}
function loopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  return ipv4Loopback(hostname)
}
/**
 * 同时校验连接地址、Host 和浏览器同源标记，仅接受本机同源请求。
 * 不信任转发头，避免外部请求通过代理伪装成本机连接。
 */
function safeRequest(req) {
  if (!loopbackAddress(req.socket?.remoteAddress)) return false
  if (req.headers.forwarded || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try { hostUrl = new URL(`http://${host}`) } catch { return false }
  if (!loopbackHostname(hostUrl.hostname)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}
function sessionRoute(ctx, sessionId, cfg) {
  const session = ctx.sessions.get(sessionId)
  if (!session) throw new Error('会话已失效，请重新选择会话。')
  const pending = ctx.sessionProjections.stateOf(session, 'modelSelection')?.pending
  const header = session.requestHeader()
  const fromHeader = header ? {
    provider: header.config?.provider, model: header.config?.model,
    ...(header.adapterDefaults?.reasoningEffort === true || header.config?.reasoningEffort === undefined ? {} : { reasoningEffort: header.config.reasoningEffort })
  } : null
  const route = selectRoute(pending, fromHeader, ctx.agentDefaultModel.currentSelection())
    ?? selectRoute(null, null, { provider: cfg.fallbackProvider, model: cfg.fallbackModel })
  if (!route) throw new Error('没有可用模型。请在会话中选择模型或在插件设置中配置备用模型。')
  return route
}
async function bodyJson(req, limit, signal) {
  let body = ''
  for await (const part of req) {
    signal.throwIfAborted()
    body += part.toString('utf8')
    if (Buffer.byteLength(body, 'utf8') > limit) throw new Error('请求内容过大。')
  }
  return JSON.parse(body)
}
export function apply(ctx, config) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler: async (req, res) => {
    if (req.method !== 'POST' || !safeRequest(req)) return send(res, 403, { error: '只接受本机同源 POST 请求。' })
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return send(res, 415, { error: '需要 JSON 请求。' })
    const cfg = settings(config)
    if (!cfg.enabled) return send(res, 403, { error: '提示词优化已关闭。' })
    const controller = new AbortController()
    const onClose = () => { if (!res.writableEnded) controller.abort(new Error('客户端已断开')) }
    res.on('close', onClose)
    const timer = setTimeout(() => controller.abort(new Error('模型调用超时')), cfg.timeoutMs)
    let started = false
    const event = (type, data) => { if (!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`) }
    try {
      const data = await bodyJson(req, Math.min(cfg.maxInputChars * 4 + 8192, 450000), controller.signal)
      if (!data || typeof data.sessionId !== 'string' || data.sessionId.length > 256 || !validText(data.text, cfg.maxInputChars)
        || (data.note !== undefined && (typeof data.note !== 'string' || data.note.length > 2000))) throw new Error(`输入为空、包含引用占位符或超过 ${cfg.maxInputChars} 字，请选中纯文本并重试。`)
      const route = sessionRoute(ctx, data.sessionId, cfg)
      const { system, messages } = promptFor(data.text, cfg.customRules, data.note ?? '')
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' })
      started = true
      const blocks = new Map()
      let finish = null
      for await (const chunk of ctx.llm.stream({ ...route, messages, system, temperature: cfg.temperature, maxTokens: cfg.maxOutputTokens, signal: controller.signal })) {
        controller.signal.throwIfAborted()
        if (chunk.type === 'block-start') blocks.set(chunk.index, { type: chunk.blockType, text: '' })
        if (chunk.type === 'text-delta') {
          const block = blocks.get(chunk.index) ?? { type: 'text', text: '' }
          block.text += chunk.text
          blocks.set(chunk.index, block)
          if (cfg.streaming) event('delta', { text: chunk.text })
        }
        if (chunk.type === 'block-end') blocks.set(chunk.index, chunk.block)
        if (chunk.type === 'finish') finish = chunk.reason
      }
      // 等模型流完整结束后再检查结束原因和正文，失败时不发送可回填的 done。
      if (finish?.kind !== 'stop') throw new Error(finish?.kind === 'max-tokens' ? '输出达到 token 上限，请提高预算或缩短输入。' : finish?.failure?.message ?? `模型未正常完成（${finish?.kind ?? '无结束标记'}）。`)
      const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block)
      if (ordered.some(block => block.type === 'tool-call')) throw new Error('模型意外返回工具调用，未回填草稿。')
      const text = normalizeOutput(ordered.filter(block => block.type === 'text').map(block => block.text).join(''))
      const validation = validateOptimizedPrompt(data.text, text)
      if (!validation.valid) throw new Error(`Invalid optimized prompt: ${validation.issues.map(issue => issue.code).join(', ')}`)
      if (/[\uE100-\uE11D\uFFFC]/u.test(text)) throw new Error('模型没有返回安全的正文，请重试。')
      // 扩写警告只记录日志，不阻断有效结果。
      for (const issue of validation.issues) {
        if (issue.severity === 'warning') ctx.logger?.warn?.(`dsh-prompt-refine: ${issue.code}`)
      }
      event('done', { text, route })
      res.end()
    } catch (error) {
      const message = controller.signal.aborted && !res.destroyed ? `请求已取消或超过 ${Math.round(cfg.timeoutMs / 1000)} 秒。` : (error instanceof Error ? error.message : '模型调用失败。')
      if (started) { event('failure', { error: message }); res.end() }
      else send(res, 400, { error: message })
    } finally { clearTimeout(timer); res.off('close', onClose) }
  } }), 'prompt-refine: model endpoint')
}
export { SYSTEM_STRATEGY }
