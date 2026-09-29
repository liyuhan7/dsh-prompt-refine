import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'

// 仅模拟宿主配置 schema，端点和提示词逻辑均使用真实分发模块。
const schemaUrl = `data:text/javascript,${encodeURIComponent(`
  const schema = new Proxy({}, { get: () => () => schema })
  export default schema
`)}`
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/schemastery') return { url: schemaUrl, shortCircuit: true }
    return nextResolve(specifier, context)
  }
})
let apply
try { ({ apply } = await import('../lib/index.js')) } finally { hook.deregister() }

function endpoint(stream) {
  let handler
  const calls = []
  const warnings = []
  const ctx = {
    effect: register => register(),
    webServer: { register: route => { handler = route.handler } },
    sessions: { get: () => ({ requestHeader: () => ({ config: { provider: 'test-provider', model: 'test-model' } }) }) },
    sessionProjections: { stateOf: () => null },
    agentDefaultModel: { currentSelection: () => null },
    logger: { warn: message => warnings.push(message) },
    llm: { stream: options => { calls.push(options); return stream(options) } }
  }
  apply(ctx, { customRules: '保持简洁' })
  const req = {
    method: 'POST', socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'localhost', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ sessionId: 'test-session', text: '检查代码', note: '重点检查异常处理' }))
    }
  }
  const res = new EventEmitter()
  const events = []
  res.writeHead = status => { res.status = status; res.headersSent = true }
  res.write = chunk => {
    const [, type, data] = chunk.match(/^event: ([^\n]+)\ndata: ([^\n]+)\n\n$/u)
    events.push({ type, data: JSON.parse(data) })
  }
  res.end = () => { res.writableEnded = true }
  return { run: () => handler(req, res), calls, warnings, events, res }
}

async function* outputStream(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

test('endpoint normalizes and validates only after the complete model stream', async () => {
  const text = '```text\n优化结果：根据当前代码检查异常处理。\n```'
  const { promise: eof, resolve: closeStream } = Promise.withResolvers()
  const { promise: finished, resolve: finishStream } = Promise.withResolvers()
  const h = endpoint(async function* () {
    yield* outputStream(text)
    finishStream()
    await eof
  })
  const pending = h.run()
  try {
    await finished
    assert.deepEqual(h.events.map(event => event.type), ['delta'])
    assert.equal(h.res.writableEnded, undefined)
  } finally { closeStream(); await pending }
  assert.deepEqual(h.events.map(event => event.type), ['delta', 'done'])
  assert.deepEqual(h.events.at(-1).data, { text: '根据当前代码检查异常处理。', route: { provider: 'test-provider', model: 'test-model' } })
  assert.equal(h.calls.length, 1)
  // 示例对数量可变；不变的是一条收尾 user 消息与成对的 user/assistant 结构。
  const messages = h.calls[0].messages
  assert.equal(messages.length % 2, 1)
  assert.equal(messages.at(-1).role, 'user')
  assert.match(messages.at(-1).content[0].text, /<preferences>\n保持简洁\n<\/preferences>/u)
  assert.match(h.calls[0].messages.at(-1).content[0].text, /<additional_requirements>\n重点检查异常处理\n<\/additional_requirements>/u)
  assert.equal(h.res.writableEnded, true)
})

for (const [name, text, code] of [
  ['empty normalized result', '```text\n优化结果：\n```', 'empty-output'],
  ['over-limit result', '文'.repeat(12001), 'output-too-long']
]) {
  test(`endpoint rejects ${name} without emitting a writable done result`, async () => {
    const h = endpoint(() => outputStream(text))
    await h.run()
    assert.deepEqual(h.events.map(event => event.type), ['delta', 'failure'])
    assert.ok(h.events.at(-1).data.error.includes(code))
    assert.equal(h.res.writableEnded, true)
    assert.equal(h.calls.length, 1)
  })
}

test('independent model calls do not append previous optimized results to the messages', async () => {
  const h = endpoint(() => outputStream('独有的上次输出标记'))
  await h.run()
  await h.run()
  assert.equal(h.calls.length, 2)
  assert.deepEqual(h.calls[1].messages, h.calls[0].messages)
  for (const call of h.calls) {
    assert.equal(call.messages.at(-1).role, 'user')
    assert.match(call.messages.at(-1).content[0].text, /<prompt>\n检查代码\n<\/prompt>$/u)
    assert.doesNotMatch(JSON.stringify(call.messages), /独有的上次输出标记/u)
  }
})

test('endpoint logs expansion warnings and still returns a valid result without retry', async () => {
  const text = '文'.repeat(1500)
  const h = endpoint(() => outputStream(text))
  await h.run()
  assert.deepEqual(h.events.map(event => event.type), ['delta', 'done'])
  assert.equal(h.events.at(-1).data.text, text)
  assert.deepEqual(h.warnings, ['dsh-prompt-refine: possible-over-expansion'])
  assert.equal(h.calls.length, 1)
})
