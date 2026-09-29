import { diffArrays, diffChars } from 'diff'

/**
 * 与渲染器无关的差异片段，分别表示保留、新增和删除。
 * @typedef {{ type: 'equal' | 'insert' | 'delete', text: string }} DiffSegment
 */

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh-Hans', { granularity: 'word' }) : null

function normalizeChanges(changes, join = value => value) {
  return changes.map(change => ({
    type: change.added ? 'insert' : change.removed ? 'delete' : 'equal',
    text: join(change.value)
  })).filter(segment => segment.text.length > 0)
}

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

function refineSmallReplacements(segments) {
  const refined = []
  for (let index = 0; index < segments.length; index++) {
    const removed = segments[index]
    const added = segments[index + 1]
    if (removed.type === 'delete' && added?.type === 'insert' &&
      Math.max(removed.text.length, added.text.length) <= 12 &&
      Math.max(removed.text.length, added.text.length) <= Math.min(removed.text.length, added.text.length) * 3) {
      const local = normalizeChanges(diffChars(removed.text, added.text))
      // 中文替换块仅保留少量共同汉字时，不拆成零碎的字符差异。
      const retained = statistics(local).equalChars
      const hasHan = /\p{Script=Han}/u.test(removed.text + added.text)
      const pureChange = !local.some(segment => segment.type === 'delete') || !local.some(segment => segment.type === 'insert')
      if (!hasHan || pureChange || retained / Math.max(removed.text.length, added.text.length) >= 0.5) refined.push(...local)
      else refined.push(removed, added)
      index++
    } else refined.push(removed)
  }
  // 局部细化后合并相邻的同类片段。
  const merged = []
  for (const segment of refined) {
    const last = merged.at(-1)
    if (last?.type === segment.type) last.text += segment.text
    else merged.push({ ...segment })
  }
  return merged
}

/** 以中文词级差异为主，仅细化短替换块；超限、超时或碎片过多时整块降级。 */
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
  if (Math.max(original.length, result.length) > (options.maxLength ?? 12000) || !segmenter) return block()
  if (!original || !result) {
    const segments = wholeBlock(original, result)
    return { segments, stats: statistics(segments), mode: 'inline', reason: null }
  }
  // 分词数组完整保留空格和换行，确保输入框的 UTF-16 坐标可准确累计。
  const tokenize = text => Array.from(segmenter.segment(text), item => item.segment)
  if ((options.diffTimeoutMs ?? 50) <= 0) return block()
  const changes = diffArrays(tokenize(original), tokenize(result), { timeout: options.diffTimeoutMs ?? 50 })
  if (!changes) return block()
  const segments = refineSmallReplacements(normalizeChanges(changes, value => value.join('')))
  const stats = statistics(segments)
  const mode = classifyDiffMagnitude(stats, original.length, result.length)
  const tooFragmented = segments.filter(segment => segment.type !== 'equal').length > (options.maxRanges ?? 40)
  // 展示降级时仍保留原始比较统计，用于说明实际改动幅度。
  return { segments: mode === 'block-replace' || tooFragmented ? wholeBlock(original, result) : segments,
    stats, mode: tooFragmented ? 'block-replace' : mode, reason: null }
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
