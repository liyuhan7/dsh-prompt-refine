/** 输入必须是长度范围内的非空纯文本，且不含宿主保留的引用占位符。 */
export function validText(value, limit) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\uE100-\uE11D\uFFFC]/u.test(value)
}
/** 为客户端模块补齐结尾换行。 */
export function clientModule(slice) {
  return `${slice.trimEnd()}\n`
}
/** 按调用方给出的优先顺序选择完整的模型配置。 */
export function selectRoute(session, defaultSelection, fallback) {
  for (const candidate of [session, defaultSelection, fallback]) {
    if (candidate && typeof candidate.provider === 'string' && candidate.provider.trim()
      && typeof candidate.model === 'string' && candidate.model.trim()) {
      return { provider: candidate.provider.trim(), model: candidate.model.trim(), ...(candidate.reasoningEffort ? { reasoningEffort: candidate.reasoningEffort } : {}) }
    }
  }
  return null
}
const META_PREFIXES = [
  /^优化后的提示词[：:]\s*/u,
  /^优化结果[：:]\s*/u,
  /^最终提示词[：:]\s*/u,
  /^Optimized prompt[：:]\s*/iu
]

/** 仅清理首尾空白、单层代码围栏和明确的元输出前缀，保留正文。 */
export function normalizeOutput(value) {
  let result = String(value ?? '').trim()
  const match = result.match(/^```(?:[\w+-]*)\s*\n([\s\S]*?)\n```\s*$/u)
  if (match) result = match[1].trim()
  for (const pattern of META_PREFIXES) result = result.replace(pattern, '').trim()
  return result
}
