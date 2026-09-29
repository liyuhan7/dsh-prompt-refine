import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTextDiff, diffSegments, diffHunks, segmentsToHunks } from '../lib/highlight-core.js'
import * as expansion from './fixtures/prompt-expansion.js'

function roundTrip(original, result, options) {
  const diff = computeTextDiff(original, result, options)
  assert.equal(diff.segments.filter(segment => segment.type !== 'insert').map(segment => segment.text).join(''), original)
  assert.equal(diff.segments.filter(segment => segment.type !== 'delete').map(segment => segment.text).join(''), result)
  for (const segment of diff.segments) {
    assert.deepEqual(Object.keys(segment).sort(), ['text', 'type'])
    assert.ok(['equal', 'delete', 'insert'].includes(segment.type))
  }
  return diff
}

test('equal, empty and one-sided texts have complete normalized segments', () => {
  assert.deepEqual(diffSegments('相同 text', '相同 text'), [{ type: 'equal', text: '相同 text' }])
  assert.deepEqual(diffSegments('', ''), [])
  assert.equal(computeTextDiff('same', 'same').reason, 'unchanged')
  assert.equal(computeTextDiff(null, 'text').reason, 'invalid-text')
  assert.deepEqual(diffSegments('', '新增\ntext😀'), [{ type: 'insert', text: '新增\ntext😀' }])
  assert.deepEqual(diffSegments('删除\ntext😀', ''), [{ type: 'delete', text: '删除\ntext😀' }])
  assert.deepEqual(segmentsToHunks(diffSegments('删除😀', '')), [{ add: null, rem: { start: 0, end: 4 }, resultAnchor: 0 }])
})

test('Chinese word insertion remains equal / insert / equal', () => {
  const diff = roundTrip('帮我检查代码', '帮我检查当前代码')
  assert.equal(diff.mode, 'inline')
  assert.deepEqual(diff.segments, [
    { type: 'equal', text: '帮我检查' }, { type: 'insert', text: '当前' }, { type: 'equal', text: '代码' }
  ])
})

test('small replacements can refine within a word', () => {
  assert.deepEqual(diffSegments('代码实现', '当前实现'), [
    { type: 'delete', text: '代码' }, { type: 'insert', text: '当前' }, { type: 'equal', text: '实现' }
  ])
  assert.deepEqual(diffSegments('cat', 'cut'), [
    { type: 'equal', text: 'c' }, { type: 'delete', text: 'a' },
    { type: 'insert', text: 'u' }, { type: 'equal', text: 't' }
  ])
})

test('front, middle and end edits map to result UTF-16 ranges', () => {
  for (const [original, result, add] of [
    ['检查代码', '先检查代码', { start: 0, end: 1 }],
    ['帮我检查代码', '帮我检查当前代码', { start: 4, end: 6 }],
    ['检查代码', '检查代码。', { start: 4, end: 5 }]
  ]) {
    roundTrip(original, result)
    assert.deepEqual(diffHunks(original, result).hunks, [{ add, rem: null }])
  }
})

test('Chinese rewrites do not scatter shared characters through the result', () => {
  const diff = roundTrip('查看代码有没有问题', '检查当前代码是否存在问题')
  assert.equal(diff.mode, 'block-replace')
  assert.deepEqual(diff.segments, [
    { type: 'delete', text: '查看代码有没有问题' }, { type: 'insert', text: '检查当前代码是否存在问题' }
  ])
})

test('emoji insertion and replacement use UTF-16 without splitting surrogates', () => {
  for (const [original, result] of [['A😀B', 'A😀测试B'], ['😀🧑', '🧑😀'], ['A👨‍💻B', 'A👩‍💻B']]) {
    const diff = roundTrip(original, result)
    for (const segment of diff.segments) assert.equal(segment.text.isWellFormed(), true)
  }
})

test('mixed languages, punctuation, whitespace and CRLF reconstruct exactly', () => {
  for (const [original, result] of [
    ['检查 API 的 bug。\n保留接口', '检查 API 的异常！\n保留接口'],
    ['a  b\r\nc\t', 'a b\nc\t\t'],
    ['a、b', 'a；B'],
    ['one\nold\nthree', 'one\nnew\nthree']
  ]) roundTrip(original, result)
})

test('deletions retain original ranges and result anchors after earlier insertions', () => {
  const segments = [
    { type: 'equal', text: 'A😀' }, { type: 'insert', text: '当前' },
    { type: 'equal', text: 'B' }, { type: 'delete', text: '旧内容' },
    { type: 'equal', text: 'C' }, { type: 'delete', text: '尾' }, { type: 'insert', text: '结束' }
  ]
  assert.deepEqual(segmentsToHunks(segments), [
    { add: { start: 3, end: 5 }, rem: null },
    { add: null, rem: { start: 4, end: 7 }, resultAnchor: 6 },
    { add: { start: 7, end: 9 }, rem: { start: 8, end: 9 }, resultAnchor: 7 }
  ])
})

test('statistics describe retained and changed UTF-16 text', () => {
  assert.deepEqual(computeTextDiff('帮我检查代码', '帮我检查当前代码').stats, {
    equalChars: 6, insertedChars: 2, deletedChars: 0, changeRatio: 2 / 14
  })
  assert.deepEqual(computeTextDiff('cat', 'cut').stats, {
    equalChars: 2, insertedChars: 1, deletedChars: 1, changeRatio: 1 / 3
  })
})

test('large prompt expansions collapse into one full replacement', () => {
  const original = '解释一下这个函数'
  const result = '分析当前函数的职责、输入输出、关键执行路径和边界行为，并结合现有实现说明各个关键部分的作用。'
  const diff = roundTrip(original, result)
  assert.equal(diff.mode, 'block-replace')
  assert.deepEqual(diff.segments, [{ type: 'delete', text: original }, { type: 'insert', text: result }])
  assert.deepEqual(diffHunks(original, result).hunks, [
    { add: { start: 0, end: result.length }, rem: { start: 0, end: original.length }, resultAnchor: 0 }
  ])
})

test('expanding or trimming a retained sentence keeps shared wording', () => {
  // 保留原文主体的扩写应维持局部差异。
  const diff = roundTrip(expansion.original, expansion.result)
  assert.equal(diff.mode, 'inline')
  assert.ok(diff.segments.some(segment => segment.type === 'equal' && segment.text.includes(expansion.preserved)))
  const hunks = diffHunks(expansion.original, expansion.result).hunks
  assert.ok(hunks.every(hunk => hunk.add === null || hunk.add.start >= expansion.preserved.length))
  // 单侧增删细节时，不应将保留文字折叠为整块替换。
  const original = '检查当前函数的输入输出和异常处理。'
  const result = original + '补充说明相关调用路径、验证方式和结果。'.repeat(8)
  assert.ok(roundTrip(original, result).segments.every(segment => segment.type !== 'delete'))
  assert.ok(roundTrip(result, original).segments.every(segment => segment.type !== 'insert'))
})

test('length, library timeout and excessive fragmentation fall back to whole blocks', () => {
  for (const options of [{ maxLength: 2 }, { diffTimeoutMs: 0 }, { maxRanges: 0 }]) {
    const diff = roundTrip('one old text', 'one new text', options)
    assert.equal(diff.mode, 'block-replace')
    assert.equal(diff.reason, null)
  }
  const diff = roundTrip('a'.repeat(12001), 'b'.repeat(12001))
  assert.equal(diff.mode, 'block-replace')
})
