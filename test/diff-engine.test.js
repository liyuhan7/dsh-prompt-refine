import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTextDiff, diffSegments, diffHunks, diffRanges, segmentsToHunks } from '../lib/highlight-core.js'
import * as expansion from './fixtures/prompt-expansion.js'
import { readFileSync } from 'node:fs'
import { diffArrays } from 'diff'
import { introducedListItems } from '../lib/highlight-core.js'

// 只在测试侧访问内部阶段，以固定合法映射验证阈值，不扩大生产导出接口。
const coreSource = readFileSync(new URL('../lib/highlight-core.js', import.meta.url), 'utf8')
const internals = new Function('diffArrays', coreSource
  .replace("import { diffArrays } from 'diff'", '')
  .replace(/^export /gm, '') + '\nreturn { ClusterSequence, OffsetRange, SequenceDiff, mergeShortEqualIslands, hasValidMapping, diffsToSegments }')(diffArrays)

test('list role detection ignores existing lists, inline examples, quotes and fenced code', () => {
  const listOriginal = '检查代码并执行测试。'
  const listResult = '- **检查**：检查代码。\n- **测试**：执行测试。\n- **说明**：说明修改。\n- **验证**：报告结果。'
  assert.equal(introducedListItems(listOriginal, listResult).length, 4)
  assert.deepEqual(introducedListItems('- **旧**：正文', listResult), [])
  for (const sample of ['example - **标签**：正文', '> - **标签**：正文\n> - **另一个**：正文',
    '```md\n- **标签**：正文\n- **另一个**：正文\n```', '~~~\n- **标签**：正文\n- **另一个**：正文\n~~~',
    '```md\n```not-a-close\n- **标签**：正文\n- **另一个**：正文\n```']) {
    assert.deepEqual(introducedListItems('原文', sample), [])
  }
  const crlf = listResult.replaceAll('\n', '\r\n')
  for (const item of introducedListItems(listOriginal, crlf)) assert.match(crlf.slice(item.start, item.bodyStart), /^- \*\*/u)
  roundTrip(listOriginal, crlf)
})

test('new list body retains real short words and Unicode boundaries', () => {
  const original = '查看代码有没有问题。执行测试。'
  const result = '- **检查**：检查当前代码是否存在问题。\n- **测试**：执行测试。😀'
  const diff = roundTrip(original, result)
  const equal = diff.segments.filter(s => s.type === 'equal').map(s => s.text).join('')
  assert.ok(equal.includes('代码'))
  assert.ok(equal.includes('问题'))
  assert.ok(equal.includes('执行测试'))
  for (const hunk of diffHunks(original, result).hunks) if (hunk.add) {
    assert.ok(!/[\uDC00-\uDFFF]/u.test(result[hunk.add.start] ?? ''))
    assert.ok(!/[\uDC00-\uDFFF]/u.test(result[hunk.add.end] ?? ''))
  }
})

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

test('replacements align to whole words instead of marking half words', () => {
  // 半词改动（利→使）会被整词扩展覆盖，词级显示保持一致。
  assert.deepEqual(diffSegments('利用效率', '使用效率'), [
    { type: 'delete', text: '利用' }, { type: 'insert', text: '使用' }, { type: 'equal', text: '效率' }
  ])
  // 大部分字符相同的词保持字符级精确插入，不整词标红。
  assert.deepEqual(diffSegments('the result', 'them result'), [
    { type: 'equal', text: 'the' }, { type: 'insert', text: 'm' }, { type: 'equal', text: ' result' }
  ])
})

test('boundary scoring aligns insertions to word starts over trailing spaces', () => {
  const { ranges, reason } = diffRanges('AAAA BBBB', 'AAAA X BBBB')
  assert.equal(reason, null)
  assert.deepEqual(ranges, [{ start: 5, end: 7 }])
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

test('Chinese rewrites keep word-level local diffs instead of scattering or collapsing', () => {
  const diff = roundTrip('查看代码有没有问题', '检查当前代码是否存在问题')
  assert.equal(diff.mode, 'inline')
  assert.deepEqual(diff.segments, [
    { type: 'delete', text: '查看' }, { type: 'insert', text: '检查当前' },
    { type: 'equal', text: '代码' },
    { type: 'delete', text: '有没有' }, { type: 'insert', text: '是否存在' },
    { type: 'equal', text: '问题' }
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

test('large prompt expansions keep retained wording and insert locally', () => {
  const original = '解释一下这个函数'
  const result = '分析当前函数的职责、输入输出、关键执行路径和边界行为，并结合现有实现说明各个关键部分的作用。'
  const diff = roundTrip(original, result)
  assert.equal(diff.mode, 'inline')
  assert.deepEqual(diff.segments, [
    { type: 'delete', text: '解释一下这个' }, { type: 'insert', text: '分析当前' },
    { type: 'equal', text: '函数' },
    { type: 'insert', text: result.slice(6) }
  ])
  assert.deepEqual(diffHunks(original, result).hunks, [
    { add: { start: 0, end: 4 }, rem: { start: 0, end: 6 }, resultAnchor: 0 },
    { add: { start: 6, end: result.length }, rem: null }
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

test('final Chinese words are included in word expansion', () => {
  assert.deepEqual(diffSegments('利用', '使用'), [
    { type: 'delete', text: '利用' }, { type: 'insert', text: '使用' }
  ])
})

test('long replacements with grapheme prefixes and CRLF preserve both texts', () => {
  for (const prefix of ['😀', 'e\u0301', '👨‍💻', '\r\n😀']) {
    roundTrip(prefix + 'a'.repeat(120) + '😀\r\nend', prefix + 'b'.repeat(130) + '😀\r\nend')
  }
})

test('seeded mixed-text edits reconstruct exactly and keep grapheme boundaries', () => {
  let seed = 0x12345678
  const random = n => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % n
  }
  const alphabet = ['a', 'B', ' ', '代码', '使用', '😀', '👨‍💻', 'e\u0301', '\r\n', '\n', '。', '\t']
  const segmenter = new Intl.Segmenter('zh-Hans', { granularity: 'grapheme' })
  const boundaries = text => new Set([text.length, ...Array.from(segmenter.segment(text), part => part.index)])
  for (let iteration = 0; iteration < 1000; iteration++) {
    const tokens = Array.from({ length: random(40) }, () => alphabet[random(alphabet.length)])
    const edited = [...tokens]
    for (let edit = 0; edit < 1 + random(5); edit++) {
      edited.splice(random(edited.length + 1), random(4), ...Array.from({ length: random(4) }, () => alphabet[random(alphabet.length)]))
    }
    const original = tokens.join('')
    const result = edited.join('')
    const diff = roundTrip(original, result)
    const originalBoundaries = boundaries(original)
    const resultBoundaries = boundaries(result)
    let offset1 = 0
    let offset2 = 0
    for (const segment of diff.segments) {
      if (segment.type !== 'insert') offset1 += segment.text.length
      if (segment.type !== 'delete') offset2 += segment.text.length
      assert.ok(originalBoundaries.has(offset1), `original boundary at iteration ${iteration}`)
      assert.ok(resultBoundaries.has(offset2), `result boundary at iteration ${iteration}`)
    }
  }
})

test('short island phase has explicit gap, growth and replacement guards', () => {
  const { ClusterSequence, OffsetRange, SequenceDiff, mergeShortEqualIslands, hasValidMapping, diffsToSegments } = internals
  function check({ gap = '相同', firstLength = 25, secondReplacement = true, firstReplacement = true, merge = true }) {
    const original = (firstReplacement ? '甲' : '') + gap + (secondReplacement ? '乙' : '')
    const result = '丙'.repeat(firstLength - (firstReplacement ? 1 : 0)) + gap + '丁'
    const a = new ClusterSequence(original)
    const b = new ClusterSequence(result)
    const gapLength = new ClusterSequence(gap).length
    const first = new SequenceDiff(new OffsetRange(0, firstReplacement ? 1 : 0), new OffsetRange(0, firstLength - (firstReplacement ? 1 : 0)))
    const second = new SequenceDiff(new OffsetRange(first.seq1Range.endExclusive + gapLength, a.length), new OffsetRange(first.seq2Range.endExclusive + gapLength, b.length))
    const input = [first, second]
    const coordinates = value => value.map(d => [d.seq1Range.start, d.seq1Range.endExclusive, d.seq2Range.start, d.seq2Range.endExclusive])
    const before = coordinates(input)
    const output = mergeShortEqualIslands(a, b, input)
    assert.equal(output.length, merge ? 1 : 2)
    assert.ok(hasValidMapping(output, a, b))
    const segments = diffsToSegments(output, a, b)
    assert.equal(segments.filter(s => s.type !== 'insert').map(s => s.text).join(''), original)
    assert.equal(segments.filter(s => s.type !== 'delete').map(s => s.text).join(''), result)
    assert.deepEqual(coordinates(input), before, 'phase must not mutate its input ranges')
  }
  check({})
  check({ firstLength: 24, merge: false })
  check({ gap: '相同字', merge: false })
  check({ gap: '' })
  check({ gap: '相' })
  check({ gap: '\r', merge: false })
  check({ gap: '\r\n', merge: false })
  check({ gap: '\n', merge: false })
  check({ gap: '👨‍👩‍👧‍👦e\u0301' })
  check({ secondReplacement: false, merge: false })
  check({ firstReplacement: false, merge: false })
  check({ firstReplacement: false, secondReplacement: false, merge: false })
})

test('guard eligibility uses original input blocks rather than cascading joined growth', () => {
  const { ClusterSequence, OffsetRange, SequenceDiff, mergeShortEqualIslands } = internals
  const a = new ClusterSequence('甲相乙同丙')
  const b = new ClusterSequence('丁'.repeat(11) + '相' + '戊'.repeat(11) + '同' + '己'.repeat(11))
  const input = [
    new SequenceDiff(new OffsetRange(0, 1), new OffsetRange(0, 11)),
    new SequenceDiff(new OffsetRange(2, 3), new OffsetRange(12, 23)),
    new SequenceDiff(new OffsetRange(4, 5), new OffsetRange(24, 35))
  ]
  assert.deepEqual(mergeShortEqualIslands(a, b, input), input)
})

test('island runs include deletions and continue after newline or an ineligible run', () => {
  const { ClusterSequence, OffsetRange, SequenceDiff, mergeShortEqualIslands, hasValidMapping } = internals
  const cases = [
    // 大纯删除 + 一个替换不足以触发；两个真正替换则足够。
    { parts: [['甲'.repeat(25), ''], ['相', '相'], ['乙', '丁']], count: 2 },
    { parts: [['甲'.repeat(25), ''], ['相', '相'], ['乙', '丁'], ['同', '同'], ['丙', '戊']], count: 1 },
    // 两侧偏移不同，较大块位于组末端；等值 CRLF 后的新组仍可合并。
    { parts: [['前言', '前言'], ['', '新'.repeat(4)], ['保留主体', '保留主体'], ['甲', '丁'], ['相', '相'], ['乙', '戊'.repeat(24)]], count: 2 },
    { parts: [['甲', '丁'], ['\r\n', '\r\n'], ['乙', '戊'.repeat(24)], ['相', '相'], ['丙', '己']], count: 2 },
    { parts: [['甲', '丁'], ['相', '相'], ['乙', '戊'], ['保留主体', '保留主体'], ['丙', '己'.repeat(24)], ['同', '同'], ['丁', '庚']], count: 3 }
  ]
  for (const { parts, count } of cases) {
    let position1 = 0
    let position2 = 0
    const input = []
    for (const [before, after] of parts) {
      const length1 = new ClusterSequence(before).length
      const length2 = new ClusterSequence(after).length
      if (before !== after) input.push(new SequenceDiff(new OffsetRange(position1, position1 + length1), new OffsetRange(position2, position2 + length2)))
      position1 += length1
      position2 += length2
    }
    const a = new ClusterSequence(parts.map(part => part[0]).join(''))
    const b = new ClusterSequence(parts.map(part => part[1]).join(''))
    assert.ok(hasValidMapping(input, a, b))
    const output = mergeShortEqualIslands(a, b, input)
    assert.equal(output.length, count)
    assert.ok(hasValidMapping(output, a, b))
  }
})

test('island phase does not merge inconsistent gaps and validation rejects invalid mappings', () => {
  const { ClusterSequence, OffsetRange, SequenceDiff, mergeShortEqualIslands, hasValidMapping } = internals
  const first = new SequenceDiff(new OffsetRange(0, 1), new OffsetRange(0, 24))
  const a = new ClusterSequence('甲相乙')
  for (const [text, start] of [['丁'.repeat(24) + '相同戊', 26], ['丁'.repeat(24) + '异戊', 25]]) {
    const b = new ClusterSequence(text)
    const second = new SequenceDiff(new OffsetRange(2, 3), new OffsetRange(start, b.length))
    const input = [first, second]
    assert.deepEqual(mergeShortEqualIslands(a, b, input), input)
    assert.equal(hasValidMapping(input, a, b), false)
  }
  const b = new ClusterSequence('丁'.repeat(24) + '相戊')
  const second = new SequenceDiff(new OffsetRange(2, 3), new OffsetRange(25, 26))
  for (const input of [
    [second, first],
    [new SequenceDiff(new OffsetRange(-1, 1), new OffsetRange(0, 24)), second],
    [first, new SequenceDiff(new OffsetRange(2, 4), new OffsetRange(25, 26))]
  ]) assert.equal(hasValidMapping(input, a, b), false)
  assert.deepEqual(mergeShortEqualIslands(a, b, []), [])
})

test('dense replacements round trip through guarded merging and grapheme offsets', () => {
  for (let index = 0; index < 120; index++) {
    const original = `甲${'相'.repeat(index % 4)}乙👨‍👩‍👧‍👦丙e\u0301丁\r\n保留${index}`
    const result = `戊${'改'.repeat(20 + index % 10)}${'相'.repeat(index % 4)}己👨‍👩‍👧‍👦庚e\u0301辛\r\n保留${index}`
    const diff = roundTrip(original, result)
    const boundaries = text => new Set([0, ...Array.from(new Intl.Segmenter('zh-Hans', { granularity: 'grapheme' }).segment(text), part => part.index + part.segment.length)])
    const a = boundaries(original)
    const b = boundaries(result)
    let p1 = 0
    let p2 = 0
    for (const segment of diff.segments) {
      if (segment.type !== 'insert') p1 += segment.text.length
      if (segment.type !== 'delete') p2 += segment.text.length
      assert.ok(a.has(p1))
      assert.ok(b.has(p2))
    }
  }
})

test('length and library timeout fall back to whole blocks', () => {
  for (const options of [{ maxLength: 2 }, { diffTimeoutMs: 0 }, { maxRanges: 0 }]) {
    const diff = roundTrip('one old text', 'one new text', options)
    assert.equal(diff.mode, 'block-replace')
    assert.equal(diff.reason, null)
  }
  const diff = roundTrip('a'.repeat(12001), 'b'.repeat(12001))
  assert.equal(diff.mode, 'block-replace')
})
