import test from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_STRATEGY, promptFor } from '../lib/strategy.js'

const userText = result => result.messages.at(-1).content[0].text

test('custom rules and the regeneration note are user-level context', () => {
  // 固定系统策略不应混入用户偏好或单次补充要求。
  const result = promptFor('检查代码', '保持简洁', '重点检查异常处理')
  assert.match(userText(result), /<preferences>\n保持简洁\n<\/preferences>/u)
  assert.match(userText(result), /<additional_requirements>\n重点检查异常处理\n<\/additional_requirements>/u)
  assert.match(userText(result), /<prompt>\n检查代码\n<\/prompt>$/u)
  assert.doesNotMatch(result.system, /保持简洁|重点检查异常处理/u)
})

test('optional sections are trimmed, ordered, and omitted when blank', () => {
  for (const optional of ['', ' \n\t ']) {
    assert.equal(userText(promptFor('解释代码', optional, optional)), '<prompt>\n解释代码\n</prompt>')
  }
  // 仅去除首尾空白，具体路径、术语和约束保持原样。
  const text = '修改这个 bug，只改后端，不要动数据库结构，也不要新增依赖\n检查 lib/example.js 中的 API'
  const result = promptFor(`  ${text}\n`, '  技术术语保留英文  ', '\n重点检查异常路径 ')
  assert.equal(userText(result), `<preferences>\n技术术语保留英文\n</preferences>\n\n<additional_requirements>\n重点检查异常路径\n</additional_requirements>\n\n<prompt>\n${text}\n</prompt>`)
})

test('few-shot pairs precede the final user prompt with text-block content', () => {
  const result = promptFor('实际请求')
  const last = result.messages.at(-1)
  const examples = result.messages.slice(0, -1)
  // 每个示例是一对 user/assistant；示例数量可变，结构不可变。
  assert.ok(examples.length >= 2, 'expected at least one few-shot pair')
  assert.equal(examples.length % 2, 0)
  assert.deepEqual(examples.map(message => message.role),
    examples.map((_, index) => index % 2 === 0 ? 'user' : 'assistant'))
  for (const message of [...examples, last]) {
    assert.equal(message.content.length, 1)
    assert.equal(message.content[0].type, 'text')
  }
  for (const message of examples.filter(message => message.role === 'assistant')) {
    assert.deepEqual(message.source, { kind: 'model', provider: 'dsh-prompt-refine', model: 'few-shot' })
    assert.equal(message.source.replayState, undefined)
  }
  // 示例输入统一用 <prompt> 信封，助手侧是不含信封的成品提示词。
  for (const message of examples.filter(message => message.role === 'user')) {
    assert.match(message.content[0].text, /^<prompt>\n[\s\S]+\n<\/prompt>$/u)
  }
  for (const message of examples.filter(message => message.role === 'assistant')) {
    assert.doesNotMatch(message.content[0].text, /^<prompt>/u)
    assert.ok(message.content[0].text.trim().length > 0)
  }
  assert.equal(userText(result), '<prompt>\n实际请求\n</prompt>')
})

test('the system strategy states the language and return-only rules', () => {
  assert.match(SYSTEM_STRATEGY, /Preserve the primary language of the user's original prompt unless the user explicitly requests another language\./u)
  assert.match(SYSTEM_STRATEGY, /Return only the final optimized prompt\./u)
  assert.equal(userText(promptFor('Explain this function')), '<prompt>\nExplain this function\n</prompt>')
})
