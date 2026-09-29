import test from 'node:test'
import assert from 'node:assert/strict'
import { validateOptimizedPrompt } from '../lib/prompt-validator.js'

test('empty output is an error', () => {
  for (const output of ['', ' \n\t ', null, undefined]) {
    assert.deepEqual(validateOptimizedPrompt('检查代码', output), { valid: false, issues: [{ code: 'empty-output', severity: 'error' }] })
  }
})

test('normal enhancement and reasonable expansion are valid', () => {
  assert.deepEqual(validateOptimizedPrompt('解释一下这个函数', '解释这个函数的主要作用和执行逻辑，并说明其中关键部分分别负责什么。'), { valid: true, issues: [] })
  // 合理扩写不受原文长度倍数限制。
  const original = '现在帮我写一个测试看看这轮代码有没有问题'
  const result = '针对本轮代码修改补充并运行相关测试。先结合实际代码变更和已有实现确定需要重点验证的功能与受影响行为，再沿用项目现有的测试方式编写相应测试，重点覆盖主要执行路径、关键边界情况以及本轮修改可能影响的已有行为。完成后运行相关测试，根据测试结果检查本轮修改是否存在问题，并说明测试覆盖范围、发现的问题及验证结果。'
  assert.ok(result.length > original.length * 3)
  assert.deepEqual(validateOptimizedPrompt(original, result), { valid: true, issues: [] })
})

test('over-expansion warns only for a short source past 1000 trimmed chars', () => {
  assert.deepEqual(validateOptimizedPrompt('文'.repeat(50), '文'.repeat(999)), { valid: true, issues: [] })
  assert.deepEqual(validateOptimizedPrompt(` ${'文'.repeat(50)} `, ` ${'文'.repeat(1000)} `), { valid: true, issues: [{ code: 'possible-over-expansion', severity: 'warning' }] })
  // 过度扩写警告仅针对短原文，长度错误由独立规则判断。
  assert.deepEqual(validateOptimizedPrompt('文'.repeat(51), '文'.repeat(1000)), { valid: true, issues: [] })
})

test('output over 12000 characters is an error even when a warning also applies', () => {
  assert.equal(validateOptimizedPrompt('文'.repeat(51), '文'.repeat(12000)).valid, true)
  assert.deepEqual(validateOptimizedPrompt('文'.repeat(51), '文'.repeat(12001)), { valid: false, issues: [{ code: 'output-too-long', severity: 'error' }] })
  assert.deepEqual(validateOptimizedPrompt('检查代码', '文'.repeat(12001)), { valid: false, issues: [
    { code: 'output-too-long', severity: 'error' },
    { code: 'possible-over-expansion', severity: 'warning' }
  ] })
})
