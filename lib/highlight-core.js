/*
 * Portions adapted from Visual Studio Code's diff heuristics.
 * Copyright (c) Microsoft Corporation. All rights reserved.
 *
 * MIT License
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { diffArrays } from 'diff'

/**
 * 与渲染器无关的差异片段，分别表示保留、新增和删除。
 * @typedef {{ type: 'equal' | 'insert' | 'delete', text: string }} DiffSegment
 */

// 词级分词只用于边界评分和整词扩展，不再作为 diff 的 token 粒度。
const wordSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh-Hans', { granularity: 'word' }) : null
// 差异以字符簇为最小单位：代理对、ZWJ 序列和 CRLF 不会被拆成半个。
const graphemeSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh-Hans', { granularity: 'grapheme' }) : null

function statistics(segments) {
  const stats = { equalChars: 0, insertedChars: 0, deletedChars: 0, changeRatio: 0 }
  for (const segment of segments) {
    const field = segment.type === 'equal' ? 'equalChars' : segment.type === 'insert' ? 'insertedChars' : 'deletedChars'
    stats[field] += segment.text.length
  }
  const changed = stats.insertedChars + stats.deletedChars
  // 保留文字在原文和结果中各计一次，增删文字分别计入变化量。
  stats.changeRatio = changed / (2 * stats.equalChars + changed || 1)
  return stats
}

export function classifyDiffMagnitude(stats, originalLength, resultLength) {
  if (!originalLength || !resultLength) return 'inline'
  // 扩写或缩写保留了较短文本的大部分内容时，仍显示局部差异。
  if (stats.equalChars / Math.min(originalLength, resultLength) >= 0.5) return 'inline'
  const longest = Math.max(originalLength, resultLength)
  const changed = stats.insertedChars + stats.deletedChars
  return longest >= 12 && (stats.equalChars / longest < 0.35 || changed > stats.equalChars * 3)
    ? 'block-replace' : 'inline'
}

function wholeBlock(original, result) {
  return [
    ...(original ? [{ type: 'delete', text: original }] : []),
    ...(result ? [{ type: 'insert', text: result }] : [])
  ]
}

// 新引入的带标签列表：标题是结构，而不是原文正文的匹配锚点。
// 已有列表的编辑仍使用普通字符 diff；代码围栏中的示例不参与识别。
export function introducedListItems(original, result) {
  if (typeof original !== 'string' || typeof result !== 'string') return []
  function scan(text) {
    let offset = 0
    let fence = null
    const items = []
    let hasList = false
    for (const line of text.split(/(?<=\n)/u)) {
      const content = line.replace(/[\r\n]+$/u, '')
      const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(content)
      if (marker) {
        if (!fence) fence = marker[1]
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^[ \t]*$/u.test(content.slice(marker[0].length))) fence = null
      } else if (!fence) {
        if (/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/u.test(content)) hasList = true
        const prefix = /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+\*\*[^*\r\n]+\*\*[：:][ \t]*/u.exec(content)
        if (prefix) items.push({ start: offset, bodyStart: offset + prefix[0].length, end: offset + content.length })
      }
      offset += line.length
    }
    return { items, hasList }
  }
  if (scan(original).hasList) return []
  const items = scan(result).items
  return items.length >= 2 ? items : []
}

// —— 差异引擎结构借鉴 VS Code（MIT）defaultLinesDiffComputer ——
// 源码：https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/diff/defaultLinesDiffComputer
// 差异单位从「行 → 行内字符」改为整段文本的「字符簇」；词级分词器
// 不再切分 diff token，而是为启发式提供词边界评分与整词扩展。

class OffsetRange {
  constructor(start, endExclusive) {
    this.start = start
    this.endExclusive = endExclusive
  }

  get length() { return this.endExclusive - this.start }
  get isEmpty() { return this.start === this.endExclusive }

  delta(offset) { return offset === 0 ? this : new OffsetRange(this.start + offset, this.endExclusive + offset) }
  deltaStart(offset) { return offset === 0 ? this : new OffsetRange(this.start + offset, this.endExclusive) }
  deltaEnd(offset) { return offset === 0 ? this : new OffsetRange(this.start, this.endExclusive + offset) }
  join(other) { return new OffsetRange(Math.min(this.start, other.start), Math.max(this.endExclusive, other.endExclusive)) }
  // 相接或被包含的空区间返回空区间，仅完全分离返回 undefined。
  intersect(other) {
    const start = Math.max(this.start, other.start)
    const endExclusive = Math.min(this.endExclusive, other.endExclusive)
    return start <= endExclusive ? new OffsetRange(start, endExclusive) : undefined
  }
  intersects(other) { return Math.max(this.start, other.start) < Math.min(this.endExclusive, other.endExclusive) }
}

class OffsetPair {
  static zero = new OffsetPair(0, 0)
  static max = new OffsetPair(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)

  constructor(offset1, offset2) {
    this.offset1 = offset1
    this.offset2 = offset2
  }

  delta(offset) { return offset === 0 ? this : new OffsetPair(this.offset1 + offset, this.offset2 + offset) }
  equals(other) { return this.offset1 === other.offset1 && this.offset2 === other.offset2 }
}

class SequenceDiff {
  static invert(sequenceDiffs, doc1Length) {
    const result = []
    forEachAdjacent(sequenceDiffs, (a, b) => {
      result.push(SequenceDiff.fromOffsetPairs(
        a ? a.getEndExclusives() : OffsetPair.zero,
        b ? b.getStarts() : new OffsetPair(doc1Length, (a ? a.seq2Range.endExclusive - a.seq1Range.endExclusive : 0) + doc1Length)
      ))
    })
    return result
  }

  static fromOffsetPairs(start, endExclusive) {
    return new SequenceDiff(
      new OffsetRange(start.offset1, endExclusive.offset1),
      new OffsetRange(start.offset2, endExclusive.offset2)
    )
  }

  constructor(seq1Range, seq2Range) {
    this.seq1Range = seq1Range
    this.seq2Range = seq2Range
  }

  swap() { return new SequenceDiff(this.seq2Range, this.seq1Range) }
  join(other) { return new SequenceDiff(this.seq1Range.join(other.seq1Range), this.seq2Range.join(other.seq2Range)) }
  delta(offset) { return offset === 0 ? this : new SequenceDiff(this.seq1Range.delta(offset), this.seq2Range.delta(offset)) }
  deltaStart(offset) { return offset === 0 ? this : new SequenceDiff(this.seq1Range.deltaStart(offset), this.seq2Range.deltaStart(offset)) }
  deltaEnd(offset) { return offset === 0 ? this : new SequenceDiff(this.seq1Range.deltaEnd(offset), this.seq2Range.deltaEnd(offset)) }
  intersect(other) {
    const seq1Range = this.seq1Range.intersect(other.seq1Range)
    const seq2Range = this.seq2Range.intersect(other.seq2Range)
    return seq1Range && seq2Range ? new SequenceDiff(seq1Range, seq2Range) : undefined
  }
  getStarts() { return new OffsetPair(this.seq1Range.start, this.seq2Range.start) }
  getEndExclusives() { return new OffsetPair(this.seq1Range.endExclusive, this.seq2Range.endExclusive) }
}

// 遍历相邻区间的空档，含首尾哨兵：n 个差异产生 n+1 个等值区。
function forEachAdjacent(items, callback) {
  for (let index = 0; index <= items.length; index++) callback(items[index - 1], items[index])
}

function forEachWithNeighbors(items, callback) {
  for (let index = 0; index < items.length; index++) callback(items[index - 1], items[index], items[index + 1])
}

// —— 字符簇序列：为启发式层提供元素相等、边界评分与词定位 ——

const WORD_LOWER = 0, WORD_UPPER = 1, WORD_NUMBER = 2, END = 3, OTHER = 4,
  SEPARATOR = 5, SPACE = 6, LINE_CR = 7, LINE_LF = 8, CJK = 9
const CATEGORY_SCORE = [0, 0, 0, 10, 2, 30, 3, 10, 10, 3]
// 与 VS Code 的差异：新增 CJK 类别，并在词级分词的词首处加分，
// 让字符簇 diff 的落点自然对齐到中文词边界，而非汉字中间。
const WORD_START_BONUS = 27
const SEPARATOR_CODES = new Set([
  0x21, 0x2c, 0x2e, 0x3a, 0x3b, 0x3f, 0xb7, 0x2026,
  0x3001, 0x3002, 0xff01, 0xff0c, 0xff0e, 0xff1a, 0xff1b, 0xff1f
])
const SPACE_CODES = new Set([0x09, 0x0b, 0x0c, 0x20, 0xa0, 0x2028, 0x2029, 0x3000])

function charCategory(code) {
  if (code === -1) return END
  if (code === 10) return LINE_LF
  if (code === 13) return LINE_CR
  if (SPACE_CODES.has(code)) return SPACE
  if (code >= 0x61 && code <= 0x7a) return WORD_LOWER
  if (code >= 0x41 && code <= 0x5a) return WORD_UPPER
  if (code >= 0x30 && code <= 0x39) return WORD_NUMBER
  if (SEPARATOR_CODES.has(code)) return SEPARATOR
  if (isCJKCode(code)) return CJK
  return OTHER
}

function isCJKCode(code) {
  return (code >= 0x1100 && code <= 0x11ff) || (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
}

function isAsciiWordCluster(cluster) {
  return cluster.length === 1 && ((cluster >= '0' && cluster <= '9') ||
    (cluster >= 'A' && cluster <= 'Z') || (cluster >= 'a' && cluster <= 'z'))
}

class ClusterSequence {
  constructor(text) {
    this.text = text
    this.clusters = []
    if (graphemeSegmenter) {
      for (const part of graphemeSegmenter.segment(text)) this.clusters.push(part.segment)
    } else this.clusters.push(...Array.from(text))
    // 相同簇映射到相同整数，供启发式做元素相等比较。
    const ids = new Map()
    this.ids = this.clusters.map(cluster => {
      let id = ids.get(cluster)
      if (id === undefined) { id = ids.size; ids.set(cluster, id) }
      return id
    })
    this.clusterByUtf16 = new Map()
    let utf16 = 0
    for (let index = 0; index < this.clusters.length; index++) {
      this.clusterByUtf16.set(utf16, index)
      utf16 += this.clusters[index].length
    }
    this.clusterByUtf16.set(utf16, this.clusters.length)
    this.wordSegments = []
    this.wordIndex = new Array(this.clusters.length).fill(-1)
    this.wordStarts = new Set()
    this.lineStarts = [0]
    for (let index = 0; index < this.clusters.length; index++) {
      if (/[\r\n]/.test(this.clusters[index])) this.lineStarts.push(index + 1)
    }
    if (wordSegmenter) {
      for (const part of wordSegmenter.segment(text)) {
        const start = this.clusterByUtf16.get(part.index)
        const end = this.clusterByUtf16.get(part.index + part.segment.length)
        if (start === undefined || end === undefined) continue
        this.wordSegments.push({ start, end, isWordLike: part.isWordLike === true })
        for (let index = start; index < end; index++) this.wordIndex[index] = this.wordSegments.length - 1
        if (part.isWordLike === true) this.wordStarts.add(start)
      }
    }
  }

  getElement(offset) { return this.ids[offset] }
  get length() { return this.ids.length }
  isStronglyEqual(offset1, offset2) { return this.ids[offset1] === this.ids[offset2] }
  getText(range) { return this.clusters.slice(range.start, range.endExclusive).join('') }

  getBoundaryScore(offset) {
    const before = offset > 0 ? this.clusters[offset - 1].charCodeAt(this.clusters[offset - 1].length - 1) : -1
    const after = offset < this.length ? this.clusters[offset].charCodeAt(0) : -1
    const prevCategory = charCategory(before)
    const nextCategory = charCategory(after)
    if (prevCategory === LINE_CR && nextCategory === LINE_LF) return 0
    if (prevCategory === LINE_LF) return 150
    let score = 0
    if (prevCategory !== nextCategory) {
      score += 10
      if (prevCategory === WORD_LOWER && nextCategory === WORD_UPPER) score += 1
    }
    score += CATEGORY_SCORE[prevCategory] + CATEGORY_SCORE[nextCategory]
    if (this.wordStarts.has(offset)) score += WORD_START_BONUS
    return score
  }

  findWordContaining(offset) {
    if (offset < 0 || offset >= this.length) return undefined
    if (isAsciiWordCluster(this.clusters[offset])) {
      let start = offset
      while (start > 0 && isAsciiWordCluster(this.clusters[start - 1])) start--
      let end = offset
      while (end < this.length && isAsciiWordCluster(this.clusters[end])) end++
      return new OffsetRange(start, end)
    }
    const index = this.wordIndex[offset]
    if (index >= 0 && this.wordSegments[index].isWordLike) {
      const word = this.wordSegments[index]
      return new OffsetRange(word.start, word.end)
    }
    return undefined
  }

  countLinesIn(range) {
    let lines = 0
    for (let index = range.start; index < range.endExclusive; index++) {
      if (/[\r\n]/.test(this.clusters[index])) lines++
    }
    return lines
  }

  extendToFullLines(range) {
    let start = 0
    for (const lineStart of this.lineStarts) {
      if (lineStart <= range.start) start = lineStart
      else break
    }
    let end = this.length
    for (const lineStart of this.lineStarts) {
      if (lineStart >= range.endExclusive) { end = lineStart; break }
    }
    return new OffsetRange(start, end)
  }
}

// —— 启发式序列优化（移植自 VS Code heuristicSequenceOptimizations.ts）——
// https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/diff/defaultLinesDiffComputer/heuristicSequenceOptimizations.ts

function joinSequenceDiffsByShifting(sequence1, sequence2, sequenceDiffs) {
  if (sequenceDiffs.length === 0) return sequenceDiffs
  const result = []
  result.push(sequenceDiffs[0])
  // 先尽量左移并合并相邻差异。
  for (let i = 1; i < sequenceDiffs.length; i++) {
    const prevResult = result[result.length - 1]
    let cur = sequenceDiffs[i]
    if (cur.seq1Range.isEmpty || cur.seq2Range.isEmpty) {
      const length = cur.seq1Range.start - prevResult.seq1Range.endExclusive
      let d
      for (d = 1; d <= length; d++) {
        if (sequence1.getElement(cur.seq1Range.start - d) !== sequence1.getElement(cur.seq1Range.endExclusive - d) ||
          sequence2.getElement(cur.seq2Range.start - d) !== sequence2.getElement(cur.seq2Range.endExclusive - d)) break
      }
      d--
      if (d === length) {
        result[result.length - 1] = new SequenceDiff(
          new OffsetRange(prevResult.seq1Range.start, cur.seq1Range.endExclusive - length),
          new OffsetRange(prevResult.seq2Range.start, cur.seq2Range.endExclusive - length)
        )
        continue
      }
      cur = cur.delta(-d)
    }
    result.push(cur)
  }
  // 再尽量右移并合并一次。
  const result2 = []
  for (let i = 0; i < result.length - 1; i++) {
    const nextResult = result[i + 1]
    let cur = result[i]
    if (cur.seq1Range.isEmpty || cur.seq2Range.isEmpty) {
      const length = nextResult.seq1Range.start - cur.seq1Range.endExclusive
      let d
      for (d = 0; d < length; d++) {
        if (!sequence1.isStronglyEqual(cur.seq1Range.start + d, cur.seq1Range.endExclusive + d) ||
          !sequence2.isStronglyEqual(cur.seq2Range.start + d, cur.seq2Range.endExclusive + d)) break
      }
      if (d === length) {
        result[i + 1] = new SequenceDiff(
          new OffsetRange(cur.seq1Range.start + length, nextResult.seq1Range.endExclusive),
          new OffsetRange(cur.seq2Range.start + length, nextResult.seq2Range.endExclusive)
        )
        continue
      }
      if (d > 0) cur = cur.delta(d)
    }
    result2.push(cur)
  }
  if (result.length > 0) result2.push(result[result.length - 1])
  return result2
}

function shiftSequenceDiffs(sequence1, sequence2, sequenceDiffs) {
  if (!sequence1.getBoundaryScore || !sequence2.getBoundaryScore) return sequenceDiffs
  for (let i = 0; i < sequenceDiffs.length; i++) {
    const prevDiff = (i > 0 ? sequenceDiffs[i - 1] : undefined)
    const diff = sequenceDiffs[i]
    const nextDiff = (i + 1 < sequenceDiffs.length ? sequenceDiffs[i + 1] : undefined)
    const seq1ValidRange = new OffsetRange(prevDiff ? prevDiff.seq1Range.endExclusive + 1 : 0, nextDiff ? nextDiff.seq1Range.start - 1 : sequence1.length)
    const seq2ValidRange = new OffsetRange(prevDiff ? prevDiff.seq2Range.endExclusive + 1 : 0, nextDiff ? nextDiff.seq2Range.start - 1 : sequence2.length)
    if (diff.seq1Range.isEmpty) {
      sequenceDiffs[i] = shiftDiffToBetterPosition(diff, sequence1, sequence2, seq1ValidRange, seq2ValidRange)
    } else if (diff.seq2Range.isEmpty) {
      sequenceDiffs[i] = shiftDiffToBetterPosition(diff.swap(), sequence2, sequence1, seq2ValidRange, seq1ValidRange).swap()
    }
  }
  return sequenceDiffs
}

function shiftDiffToBetterPosition(diff, sequence1, sequence2, seq1ValidRange, seq2ValidRange) {
  const maxShiftLimit = 100
  let deltaBefore = 1
  while (
    diff.seq1Range.start - deltaBefore >= seq1ValidRange.start &&
    diff.seq2Range.start - deltaBefore >= seq2ValidRange.start &&
    sequence2.isStronglyEqual(diff.seq2Range.start - deltaBefore, diff.seq2Range.endExclusive - deltaBefore) && deltaBefore < maxShiftLimit
  ) deltaBefore++
  deltaBefore--
  let deltaAfter = 0
  while (
    diff.seq1Range.start + deltaAfter < seq1ValidRange.endExclusive &&
    diff.seq2Range.endExclusive + deltaAfter < seq2ValidRange.endExclusive &&
    sequence2.isStronglyEqual(diff.seq2Range.start + deltaAfter, diff.seq2Range.endExclusive + deltaAfter) && deltaAfter < maxShiftLimit
  ) deltaAfter++
  if (deltaBefore === 0 && deltaAfter === 0) return diff
  let bestDelta = 0
  let bestScore = -1
  for (let delta = -deltaBefore; delta <= deltaAfter; delta++) {
    const seq1Offset = diff.seq1Range.start + delta
    const seq2OffsetStart = diff.seq2Range.start + delta
    const seq2OffsetEndExclusive = diff.seq2Range.endExclusive + delta
    const score = sequence1.getBoundaryScore(seq1Offset) + sequence2.getBoundaryScore(seq2OffsetStart) + sequence2.getBoundaryScore(seq2OffsetEndExclusive)
    if (score > bestScore) { bestScore = score; bestDelta = delta }
  }
  return diff.delta(bestDelta)
}

function extendDiffsToEntireWordIfAppropriate(sequence1, sequence2, sequenceDiffs, findParent) {
  const equalMappings = SequenceDiff.invert(sequenceDiffs, sequence1.length)
  const additional = []
  let lastPoint = new OffsetPair(0, 0)
  function scanWord(pair, equalMapping) {
    if (pair.offset1 < lastPoint.offset1 || pair.offset2 < lastPoint.offset2) return
    const w1 = findParent(sequence1, pair.offset1)
    const w2 = findParent(sequence2, pair.offset2)
    if (!w1 || !w2) return
    let w = new SequenceDiff(w1, w2)
    const equalPart = w.intersect(equalMapping)
    let equalChars1 = equalPart ? equalPart.seq1Range.length : 0
    let equalChars2 = equalPart ? equalPart.seq2Range.length : 0
    // 词不会触碰已处理过的等值区，但可能延伸进后续等值区。
    while (equalMappings.length > 0) {
      const next = equalMappings[0]
      const intersects = next.seq1Range.intersects(w.seq1Range) || next.seq2Range.intersects(w.seq2Range)
      if (!intersects) break
      const v1 = findParent(sequence1, next.seq1Range.start)
      const v2 = findParent(sequence2, next.seq2Range.start)
      if (!v1 || !v2) break
      const v = new SequenceDiff(v1, v2)
      const part = v.intersect(next)
      equalChars1 += part ? part.seq1Range.length : 0
      equalChars2 += part ? part.seq2Range.length : 0
      w = w.join(v)
      if (w.seq1Range.endExclusive >= next.seq1Range.endExclusive) equalMappings.shift()
      else break
    }
    // 等值字符不足全词三分之二时整词标为改动，避免显示半个词。
    if (equalChars1 + equalChars2 < (w.seq1Range.length + w.seq2Range.length) * 2 / 3) additional.push(w)
    lastPoint = w.getEndExclusives()
  }
  while (equalMappings.length > 0) {
    const next = equalMappings.shift()
    if (next.seq1Range.isEmpty) continue
    scanWord(next.getStarts(), next)
    scanWord(next.getEndExclusives().delta(-1), next)
  }
  return mergeSequenceDiffs(sequenceDiffs, additional)
}

function mergeSequenceDiffs(sequenceDiffs1, sequenceDiffs2) {
  const result = []
  while (sequenceDiffs1.length > 0 || sequenceDiffs2.length > 0) {
    const sd1 = sequenceDiffs1[0]
    const sd2 = sequenceDiffs2[0]
    let next
    if (sd1 && (!sd2 || sd1.seq1Range.start < sd2.seq1Range.start)) next = sequenceDiffs1.shift()
    else next = sequenceDiffs2.shift()
    if (result.length > 0 && result[result.length - 1].seq1Range.endExclusive >= next.seq1Range.start) {
      result[result.length - 1] = result[result.length - 1].join(next)
    } else result.push(next)
  }
  return result
}

// 两个大改动之间只夹少量等值文字时合并成一处，避免出现虚假的稳定片段。
// 与 VS Code 的差异：不移植 removeShortMatches（≤2 个等值元素即合并），
// 因为中文的一两个汉字常是完整保留的词，按数量合并会吞掉真实保留内容。
function removeVeryShortMatchingTextBetweenLongDiffs(sequence1, sequence2, sequenceDiffs) {
  let diffs = sequenceDiffs
  if (diffs.length === 0) return diffs
  let counter = 0
  let shouldRepeat
  do {
    shouldRepeat = false
    const result = [diffs[0]]
    for (let i = 1; i < diffs.length; i++) {
      const cur = diffs[i]
      const lastResult = result[result.length - 1]
      const shouldJoinDiffs = (before, after) => {
        const unchangedRange = new OffsetRange(lastResult.seq1Range.endExclusive, cur.seq1Range.start)
        const unchangedLineCount = sequence1.countLinesIn(unchangedRange)
        if (unchangedLineCount > 5 || unchangedRange.length > 500) return false
        const unchangedText = sequence1.getText(unchangedRange).trim()
        if (unchangedText.length > 20 || unchangedText.split(/\r\n|\r|\n/).length > 1) return false
        const beforeLineCount1 = sequence1.countLinesIn(before.seq1Range)
        const beforeSeq1Length = before.seq1Range.length
        const beforeLineCount2 = sequence2.countLinesIn(before.seq2Range)
        const beforeSeq2Length = before.seq2Range.length
        const afterLineCount1 = sequence1.countLinesIn(after.seq1Range)
        const afterSeq1Length = after.seq1Range.length
        const afterLineCount2 = sequence2.countLinesIn(after.seq2Range)
        const afterSeq2Length = after.seq2Range.length
        const max = 2 * 40 + 50
        const cap = value => Math.min(value, max)
        return Math.pow(Math.pow(cap(beforeLineCount1 * 40 + beforeSeq1Length), 1.5) + Math.pow(cap(beforeLineCount2 * 40 + beforeSeq2Length), 1.5), 1.5)
          + Math.pow(Math.pow(cap(afterLineCount1 * 40 + afterSeq1Length), 1.5) + Math.pow(cap(afterLineCount2 * 40 + afterSeq2Length), 1.5), 1.5)
          > ((max ** 1.5) ** 1.5) * 1.3
      }
      if (shouldJoinDiffs(lastResult, cur)) {
        shouldRepeat = true
        result[result.length - 1] = result[result.length - 1].join(cur)
      } else result.push(cur)
    }
    diffs = result
  } while (counter++ < 10 && shouldRepeat)
  const newDiffs = []
  forEachWithNeighbors(diffs, (prev, cur, next) => {
    let newDiff = cur
    const shouldMarkAsChanged = text => text.length > 0 && text.trim().length <= 3 && cur.seq1Range.length + cur.seq2Range.length > 100
    const fullRange1 = sequence1.extendToFullLines(cur.seq1Range)
    const prefix = sequence1.getText(new OffsetRange(fullRange1.start, cur.seq1Range.start))
    if (shouldMarkAsChanged(prefix)) newDiff = newDiff.deltaStart(fullRange1.start - cur.seq1Range.start)
    const suffix = sequence1.getText(new OffsetRange(cur.seq1Range.endExclusive, fullRange1.endExclusive))
    if (shouldMarkAsChanged(suffix)) newDiff = newDiff.deltaEnd(fullRange1.endExclusive - cur.seq1Range.endExclusive)
    const availableSpace = SequenceDiff.fromOffsetPairs(
      prev ? prev.getEndExclusives() : OffsetPair.zero,
      next ? next.getStarts() : new OffsetPair(sequence1.length, sequence2.length)
    )
    const result = newDiff.intersect(availableSpace)
    if (newDiffs.length > 0 && result.getStarts().equals(newDiffs[newDiffs.length - 1].getEndExclusives())) {
      newDiffs[newDiffs.length - 1] = newDiffs[newDiffs.length - 1].join(result)
    } else newDiffs.push(result)
  })
  return newDiffs
}

// 中文短词可能是有意义的保留内容，不能无条件照搬 removeShortMatches。
// 仅在含多个替换、且已有较大改动的连续组内吸收极短等值岛。
const SHORT_EQUAL_ISLAND_MAX_CLUSTERS = 2
const SHORT_EQUAL_ISLAND_MIN_CHANGE_CLUSTERS = 25

function mergeShortEqualIslands(sequence1, sequence2, diffs) {
  const result = []
  for (let start = 0; start < diffs.length;) {
    let end = start + 1
    while (end < diffs.length) {
      const before = diffs[end - 1]
      const after = diffs[end]
      const gap1 = new OffsetRange(before.seq1Range.endExclusive, after.seq1Range.start)
      const gap2 = new OffsetRange(before.seq2Range.endExclusive, after.seq2Range.start)
      if (gap1.length < 0 || gap1.length > SHORT_EQUAL_ISLAND_MAX_CLUSTERS || gap1.length !== gap2.length) break
      const text = sequence1.getText(gap1)
      if (/[\r\n]/u.test(text) || text !== sequence2.getText(gap2)) break
      end++
    }
    // 资格只依赖输入块，不让本阶段的合并结果级联扩大后续合并资格。
    let replacements = 0
    let hasLargeChange = false
    for (let index = start; index < end; index++) {
      const diff = diffs[index]
      if (!diff.seq1Range.isEmpty && !diff.seq2Range.isEmpty) replacements++
      if (diff.seq1Range.length + diff.seq2Range.length >= SHORT_EQUAL_ISLAND_MIN_CHANGE_CLUSTERS) hasLargeChange = true
    }
    if (end - start > 1 && replacements >= 2 && hasLargeChange) {
      result.push(diffs[start].join(diffs[end - 1]))
    } else {
      for (let index = start; index < end; index++) result.push(diffs[index])
    }
    start = end
  }
  return result
}

function listClusterRanges(sequence, items) {
  return items.map(item => ({
    start: sequence.clusterByUtf16.get(item.start),
    bodyStart: sequence.clusterByUtf16.get(item.bodyStart),
    end: sequence.clusterByUtf16.get(item.end)
  })).filter(item => item.start !== undefined && item.bodyStart !== undefined && item.end !== undefined)
}

function retainsListHeading(diffs, sequence1, sequence2, items) {
  let position2 = 0
  for (const diff of diffs) {
    if (diff.seq2Range.start > position2 && items.some(item => position2 < item.bodyStart && diff.seq2Range.start > item.start)) return true
    position2 = diff.seq2Range.endExclusive
  }
  return items.some(item => position2 < item.bodyStart && sequence2.length > item.start)
}

function alignIntroducedListWords(sequence1, sequence2, diffs, items) {
  const result = []
  const partial = (sequence, range) => {
    const first = sequence.findWordContaining(range.start)
    const last = sequence.findWordContaining(range.endExclusive - 1)
    return (first && first.start < range.start) || (last && last.endExclusive > range.endExclusive)
  }
  for (const diff of diffs) {
    const previous = result[result.length - 1]
    if (previous) {
      const gap1 = new OffsetRange(previous.seq1Range.endExclusive, diff.seq1Range.start)
      const gap2 = new OffsetRange(previous.seq2Range.endExclusive, diff.seq2Range.start)
      if (gap2.length > 0 && gap2.length <= 2 &&
        items.some(item => gap2.start >= item.bodyStart && gap2.endExclusive <= item.end) &&
        /^[\p{Script=Han}]+$/u.test(sequence2.getText(gap2)) &&
        (partial(sequence1, gap1) || partial(sequence2, gap2))) {
        result[result.length - 1] = previous.join(diff)
        continue
      }
    }
    result.push(diff)
  }
  return result
}

// 启发式只能改变显示边界，不能改变文本映射。两侧分词可能不对称，
// 因此每一步都验证等值区和坐标；无效优化保留上一步的精确差异。
function hasValidMapping(diffs, sequence1, sequence2) {
  let position1 = 0
  let position2 = 0
  for (const diff of diffs) {
    const a = diff.seq1Range
    const b = diff.seq2Range
    if (a.start < position1 || b.start < position2 || a.endExclusive < a.start || b.endExclusive < b.start ||
      a.endExclusive > sequence1.length || b.endExclusive > sequence2.length) return false
    if (a.start - position1 !== b.start - position2 ||
      sequence1.getText(new OffsetRange(position1, a.start)) !== sequence2.getText(new OffsetRange(position2, b.start))) return false
    position1 = a.endExclusive
    position2 = b.endExclusive
  }
  return sequence1.length - position1 === sequence2.length - position2 &&
    sequence1.getText(new OffsetRange(position1, sequence1.length)) === sequence2.getText(new OffsetRange(position2, sequence2.length))
}

// —— jsdiff 变更序列 → SequenceDiff：相邻删除段与插入段配成替换 ——

function changesToDiffs(changes) {
  const diffs = []
  let offset1 = 0
  let offset2 = 0
  let deleted = null
  let inserted = null
  const flush = () => {
    if (deleted || inserted) {
      diffs.push(new SequenceDiff(
        deleted ?? new OffsetRange(offset1, offset1),
        inserted ?? new OffsetRange(offset2, offset2)
      ))
      deleted = null
      inserted = null
    }
  }
  for (const change of changes) {
    const count = change.value.length
    if (change.added) {
      inserted = inserted
        ? new OffsetRange(inserted.start, offset2 + count)
        : new OffsetRange(offset2, offset2 + count)
      offset2 += count
    } else if (change.removed) {
      deleted = deleted
        ? new OffsetRange(deleted.start, offset1 + count)
        : new OffsetRange(offset1, offset1 + count)
      offset1 += count
    } else {
      flush()
      offset1 += count
      offset2 += count
    }
  }
  flush()
  return diffs
}

function diffsToSegments(diffs, sequence1, sequence2) {
  const segments = []
  let position1 = 0
  let position2 = 0
  for (const diff of diffs) {
    if (diff.seq1Range.start > position1 || diff.seq2Range.start > position2) {
      segments.push({ type: 'equal', text: sequence1.getText(new OffsetRange(position1, diff.seq1Range.start)) })
    }
    if (diff.seq1Range.length) segments.push({ type: 'delete', text: sequence1.getText(diff.seq1Range) })
    if (diff.seq2Range.length) segments.push({ type: 'insert', text: sequence2.getText(diff.seq2Range) })
    position1 = diff.seq1Range.endExclusive
    position2 = diff.seq2Range.endExclusive
  }
  if (position1 < sequence1.length || position2 < sequence2.length) {
    segments.push({ type: 'equal', text: sequence1.getText(new OffsetRange(position1, sequence1.length)) })
  }
  return segments.filter(segment => segment.text.length > 0)
}

/** 以字符簇为单位的差异计算；超限或超时整块降级，其余改动保持词级对齐的局部差异。 */
export function computeTextDiff(original, result, options = {}) {
  if (typeof original !== 'string' || typeof result !== 'string') {
    return { segments: [], stats: statistics([]), mode: 'inline', reason: 'invalid-text' }
  }
  if (original === result) {
    const segments = original ? [{ type: 'equal', text: original }] : []
    return { segments, stats: statistics(segments), mode: 'inline', reason: 'unchanged' }
  }
  const block = () => {
    const segments = wholeBlock(original, result)
    return { segments, stats: statistics(segments), mode: 'block-replace', reason: null }
  }
  if (Math.max(original.length, result.length) > (options.maxLength ?? 12000)) return block()
  if ((options.diffTimeoutMs ?? 50) <= 0) return block()
  const sequence1 = new ClusterSequence(original)
  const sequence2 = new ClusterSequence(result)
  const listItems = listClusterRanges(sequence2, introducedListItems(original, result))
  const resultTokens = [...sequence2.clusters]
  for (const item of listItems) {
    for (let index = item.start; index < item.bodyStart; index++) resultTokens[index] = Symbol('new-list-heading')
  }
  // jsdiff 在超时的同步调用中返回 undefined，此时整块降级。
  const changes = diffArrays(sequence1.clusters, resultTokens, { timeout: options.diffTimeoutMs ?? 50 })
  if (!changes) return block()
  let diffs = changesToDiffs(changes)
  const optimize = transform => {
    // 部分移植函数会修改数组，传入副本以保留可回退的上一阶段。
    const candidate = transform([...diffs])
    if (hasValidMapping(candidate, sequence1, sequence2) &&
      !retainsListHeading(candidate, sequence1, sequence2, listItems)) diffs = candidate
  }
  optimize(value => joinSequenceDiffsByShifting(sequence1, sequence2, value))
  optimize(value => joinSequenceDiffsByShifting(sequence1, sequence2, value))
  optimize(value => shiftSequenceDiffs(sequence1, sequence2, value))
  optimize(value => extendDiffsToEntireWordIfAppropriate(sequence1, sequence2, value,
    (sequence, offset) => sequence.findWordContaining(offset)))
  optimize(value => removeVeryShortMatchingTextBetweenLongDiffs(sequence1, sequence2, value))
  optimize(value => mergeShortEqualIslands(sequence1, sequence2, value))
  optimize(value => alignIntroducedListWords(sequence1, sequence2, value, listItems))
  // 默认不按碎片数量吞掉保留内容；显式指定的旧保护上限仍生效。
  if (options.maxRanges !== undefined && diffs.length > options.maxRanges) return block()
  const segments = diffsToSegments(diffs, sequence1, sequence2)
  return { segments, stats: statistics(segments), mode: 'inline', reason: null }
}

export function diffSegments(original, result, options = {}) {
  return computeTextDiff(original, result, options).segments
}

/** 将差异片段映射为原文和结果的 UTF-16 范围，供高亮渲染使用。 */
export function segmentsToHunks(segments) {
  const hunks = []
  let originalOffset = 0
  let resultOffset = 0
  let current = null
  const flush = () => { if (current) hunks.push(current); current = null }
  for (const segment of segments) {
    if (segment.type === 'equal') {
      flush()
      originalOffset += segment.text.length
      resultOffset += segment.text.length
      continue
    }
    current ??= { add: null, rem: null }
    if (segment.type === 'delete') {
      current.rem ??= { start: originalOffset, end: originalOffset }
      // 删除只推进原文坐标；锚点表示删除内容在结果中的对应插入位置。
      current.resultAnchor ??= current.add?.start ?? resultOffset
      originalOffset += segment.text.length
      current.rem.end = originalOffset
    } else {
      current.add ??= { start: resultOffset, end: resultOffset }
      resultOffset += segment.text.length
      current.add.end = resultOffset
    }
  }
  flush()
  return hunks
}

export function diffHunks(original, result, options = {}) {
  const diff = computeTextDiff(original, result, options)
  return { hunks: segmentsToHunks(diff.segments), reason: diff.reason, mode: diff.mode, stats: diff.stats }
}

export function diffRanges(original, result, options = {}) {
  const diff = diffHunks(original, result, options)
  if (diff.reason) return { ranges: [], reason: diff.reason }
  const ranges = diff.hunks.filter(hunk => hunk.add !== null).map(hunk => hunk.add)
  return { ranges, reason: ranges.length ? null : 'no-visible-addition' }
}
