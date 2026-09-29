import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOutput, selectRoute, validText } from '../lib/protocol.js'

test('session route beats defaults; no fallback on an existing route', () => {
  assert.deepEqual(selectRoute({ provider: 'picked', model: 'new', reasoningEffort: 'high' }, { provider: 'global', model: 'old' }, { provider: 'backup', model: 'x' }), { provider: 'picked', model: 'new', reasoningEffort: 'high' })
  assert.deepEqual(selectRoute(null, { provider: 'global', model: 'old' }, { provider: 'backup', model: 'x' }), { provider: 'global', model: 'old' })
  assert.deepEqual(selectRoute(null, null, { provider: 'backup', model: 'x' }), { provider: 'backup', model: 'x' })
  assert.equal(selectRoute(null, null, { provider: 'backup', model: '' }), null)
})
test('reject empty, over-limit, and reference placeholder text', () => {
  assert.equal(validText('  ', 100), false)
  assert.equal(validText('a'.repeat(101), 100), false)
  assert.equal(validText('x\uFFFC', 100), false)
  assert.equal(validText('hello', 5), true)
})

test('normalization trims, strips one outer code fence, then a meta prefix', () => {
  assert.equal(normalizeOutput(null), '')
  assert.equal(normalizeOutput(undefined), '')
  assert.equal(normalizeOutput('  正文  '), '正文')
  assert.equal(normalizeOutput('```\nhello\n```'), 'hello')
  assert.equal(normalizeOutput('```text\n优化后的提示词：根据当前代码检查异常处理。\n```'), '根据当前代码检查异常处理。')
  // 内部代码围栏属于正文，只清理最外层围栏。
  assert.equal(normalizeOutput('```\n```text\n正文\n```\n```'), '```text\n正文\n```')
  for (const prefix of ['优化后的提示词', '优化结果', '最终提示词', 'Optimized prompt', 'OPTIMIZED PROMPT']) {
    for (const colon of ['：', ':']) assert.equal(normalizeOutput(`${prefix}${colon} 正文`), '正文')
  }
  // 出现在正文内部的标签不能被清理。
  assert.equal(normalizeOutput('根据当前代码检查优化结果：是否符合约束。'), '根据当前代码检查优化结果：是否符合约束。')
  assert.equal(normalizeOutput('分析“优化后的提示词”的优缺点。'), '分析“优化后的提示词”的优缺点。')
})
