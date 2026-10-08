import * as diffEngine from './highlight-core.js'
import { RefinementSession } from './refinement-session.js'

/* DSH 浏览器客户端源码，由 build-client.js 生成延迟加载入口。 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-refine',
  factory: (require) => {
    const exports = {}
    const React = require('react')
    // 差异计算由 highlight-core.js 提供，此处负责高亮和输入框坐标映射。
    function createHighlightCore(options = {}) {
  const name = options.name && /^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(options.name)
    ? options.name : `dsh-prompt-refine-${Math.random().toString(36).slice(2)}`
  const diffHunks = (original, result) => diffEngine.diffHunks(original, result, options)
  const diffRanges = (original, result) => diffEngine.diffRanges(original, result, options)
  const diffSegments = (original, result) => diffEngine.diffSegments(original, result, options)
  let owner = null
  let status = { kind: 'none', reason: 'idle', count: 0 }

  /**
   * 仅合并重叠或首尾相接的范围，并剔除纯空白高亮。
   * 保留 mergeGap 参数兼容旧调用，但任何正长度间隔都不能着色。
   */
  function coalesceRanges(ranges, text, mergeGap = options.mergeGap ?? 2) {
    const merged = []
    for (const range of ranges) {
      const last = merged[merged.length - 1]
      if (last && range.start <= last.end) {
        last.end = Math.max(last.end, range.end)
        continue
      }
      merged.push({ start: range.start, end: range.end })
    }
    // 去除范围边缘的空白，避免下划线跨越段落边界。
    return merged
      .map(range => {
        let { start, end } = range
        while (start < end && /\s/u.test(text[start])) start++
        while (end > start && /\s/u.test(text[end - 1])) end--
        return { start, end }
      })
      .filter(range => range.end > range.start)
  }

  // 检测坐标中每个引用只占一位；草稿文本中保留引用的完整剪贴板表示。
  function snapshotLayout(snapshot) {
    if (!snapshot || typeof snapshot.draft !== 'string' || !Array.isArray(snapshot.occurrences)) return null
    const chips = []
    let detect = ''
    let pos = 0
    for (const occ of snapshot.occurrences) {
      if (!occ || !Number.isSafeInteger(occ.offset) || !Number.isSafeInteger(occ.length) ||
        occ.offset < pos || occ.length < 1 || occ.offset + occ.length > snapshot.draft.length) return null
      const text = snapshot.draft.slice(occ.offset, occ.offset + occ.length)
      if (typeof occ.clipboardText === 'string' && occ.clipboardText !== text) return null
      detect += snapshot.draft.slice(pos, occ.offset)
      chips.push({ occ, start: detect.length, text })
      detect += '\uFFFC'
      pos = occ.offset + occ.length
    }
    detect += snapshot.draft.slice(pos)
    return { chips, detect }
  }

  function clipboardOffset(at, chips) {
    return at + chips.reduce((extra, chip) => extra + (chip.start + 1 <= at ? chip.occ.length - 1 : 0), 0)
  }

  function sameOccurrence(before, after, offset) {
    if (after.offset !== offset || after.length !== before.length) return false
    for (const key of ['occurrenceId', 'source', 'ref', 'label', 'clipboardText', 'appearance', 'invalid']) {
      if (before[key] !== after[key]) return false
    }
    return true
  }

  function detectSlice(snapshot, span) {
    const layout = snapshotLayout(snapshot)
    if (!layout || !span || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) ||
      span.start < 0 || span.end < span.start || span.end > layout.detect.length ||
      layout.chips.some(chip => chip.start < span.end && chip.start + 1 > span.start)) return null
    const first = clipboardOffset(span.start, layout.chips)
    const last = clipboardOffset(span.end, layout.chips)
    return snapshot.draft.slice(first, last)
  }

  // 校验回填后的全文、版本和引用身份，确认范围映射仍与宿主一致。
  function expectedAfter(before, snapshot, replaced, result, start) {
    const previous = snapshotLayout(before)
    const current = snapshotLayout(snapshot)
    if (!previous || !current || !Number.isSafeInteger(start) || start < 0 ||
      start + replaced.length > previous.detect.length || result.includes('\uFFFC')) return null
    const end = start + replaced.length
    if (previous.chips.some(chip => chip.start < end && chip.start + 1 > start)) return null
    const first = clipboardOffset(start, previous.chips)
    const last = clipboardOffset(end, previous.chips)
    if (before.draft.slice(first, last) !== replaced || previous.detect.slice(start, end) !== replaced) return null
    if (snapshot.draft !== before.draft.slice(0, first) + result + before.draft.slice(last) ||
      current.detect !== previous.detect.slice(0, start) + result + previous.detect.slice(end) ||
      current.chips.length !== previous.chips.length) return null
    if (Number.isSafeInteger(before.draftRev) && Number.isSafeInteger(snapshot.draftRev) &&
      snapshot.draftRev < before.draftRev + (before.draft === snapshot.draft ? 0 : 1)) return null
    for (let k = 0; k < previous.chips.length; k++) {
      const old = previous.chips[k].occ
      const next = current.chips[k].occ
      const offset = old.offset + (old.offset >= last ? result.length - replaced.length : 0)
      if (!sameOccurrence(old, next, offset)) return null
    }
    return current
  }

  // 按 Lexical 的段落、文本和原子引用节点建立映射；遇到未知结构时放弃高亮。
  // 宿主管理的 BR/IMG 占位节点不计入正文，实际换行节点按换行符处理。
  function projectDom(root, layout) {
    if (!root || root.nodeType !== 1 || root.getAttribute?.('data-composer-input') === null) return null
    const paragraphs = Array.from(root.childNodes || [])
    if (!paragraphs.length || paragraphs.some(p => p.nodeType !== 1 || p.tagName?.toLowerCase() !== 'p')) return null
    let text = ''
    let clipboard = ''
    const runs = []
    let chipIndex = 0
    function walk(node) {
      if (node.nodeType === 3) {
        const value = node.data
        if (typeof value !== 'string') return false
        if (value.length) runs.push({ start: text.length, end: text.length + value.length, node })
        text += value
        clipboard += value
        return true
      }
      if (node.nodeType !== 1) return false
      const tag = node.tagName?.toLowerCase()
      if (node.getAttribute('data-composer-chip') !== null) {
        const chip = layout.chips[chipIndex++]
        if (!chip || node.getAttribute('contenteditable') !== 'false' ||
          node.getAttribute('data-composer-chip') !== chip.occ.source ||
          chip.start !== text.length) return false
        text += '\uFFFC'
        clipboard += chip.text
        return true
      }
      if ((tag === 'br' || tag === 'img') && node.getAttribute('data-lexical-managed-linebreak') === 'true') return true
      if (tag === 'br') { text += '\n'; clipboard += '\n'; return true }
      if (!['span', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'mark'].includes(tag)) return false
      for (const child of node.childNodes) if (!walk(child)) return false
      return true
    }
    for (let p = 0; p < paragraphs.length; p++) {
      if (p) { text += '\n'; clipboard += '\n' }
      for (const child of paragraphs[p].childNodes) if (!walk(child)) return null
    }
    return chipIndex === layout.chips.length && text === layout.detect && clipboard === layout.clipboard
      ? runs : null
  }

  function clear() {
    if (owner) {
      owner.observer?.disconnect()
      for (const key of owner.names) owner.css.highlights.delete(key)
      for (const style of owner.styles) style?.remove()
      owner = null
    }
    status = { kind: 'none', reason: 'cleared', count: 0, blocks: 0, replaced: 0, removed: 0 }
  }

  function fallback(reason) {
    clear()
    status = { kind: 'fallback', reason, count: 0, blocks: 0, replaced: 0, removed: 0 }
    return status
  }

  // 回填模式校验前后快照；实时模式只校验当前范围、快照与 DOM。
  function show({ root, before, snapshot, original, replaced = original, result, start, currentMode = false } = {}) {
    clear()
    // 纯删除没有可高亮的结果文字；蓝色标记表示替换后的文字。
    const walk = diffHunks(original, result)
    if (walk.reason === 'unchanged') return (status = { kind: 'none', reason: 'unchanged', count: 0, blocks: 0, replaced: 0, removed: 0 })
    if (walk.reason) return fallback(walk.reason)
    // 长度相近的就地替换标蓝；明显扩写按新增文字标绿。
    const colored = []
    const listItems = diffEngine.introducedListItems(original, result)
    let activeGroup = null
    const append = (color, range) => {
      if (activeGroup?.color === color) activeGroup.ranges.push(range)
      else {
        activeGroup = { color, ranges: [range] }
        colored.push(activeGroup)
      }
    }
    for (const hunk of walk.hunks) {
      // 纯删除没有结果范围，但必须切断同色组，不能跨过删除合并。
      if (hunk.add === null) { activeGroup = null; continue }
      const prefixes = listItems.map(item => ({ start: Math.max(hunk.add.start, item.start), end: Math.min(hunk.add.end, item.bodyStart) }))
        .filter(range => range.start < range.end)
      // 跨行引入新列表的块不是可确认的就地替换，保守显示为新增；
      // 同行正文仍按原长度规则判定，标签独立投影为绿色。
      const added = result.slice(hunk.add.start, hunk.add.end)
      const removed = hunk.rem === null ? '' : original.slice(hunk.rem.start, hunk.rem.end)
      const local = !prefixes.length || !/[\r\n]/u.test(added + removed)
      const swap = local && hunk.rem !== null && /\S/u.test(removed) &&
        added.length <= removed.length * (options.maxReplaceGrowth ?? 3) + (options.replaceSlack ?? 2)
      const color = swap ? 'red' : 'green'
      let position = hunk.add.start
      for (const prefix of prefixes) {
        if (position < prefix.start) append(color, { start: position, end: prefix.start })
        append('green', prefix)
        position = prefix.end
      }
      if (position < hunk.add.end) append(color, { start: position, end: hunk.add.end })
    }
    // 分别合并两种颜色的范围，避免跨色覆盖。
    const colorSpans = (color) => colored.filter(group => group.color === color)
      .flatMap(group => coalesceRanges(group.ranges, result))
    if (typeof original !== 'string' || typeof replaced !== 'string' || typeof result !== 'string' || !root || !snapshot ||
      snapshot.draft.length > (options.maxDraftLength ?? 200000)) return fallback('invalid-input')
    if (!currentMode && before?.draft === snapshot.draft && before?.draftRev === snapshot.draftRev && replaced === result) {
      return (status = { kind: 'none', reason: 'already-applied', count: 0, blocks: 0, replaced: 0 })
    }
    const layout = currentMode
      ? (detectSlice(snapshot, { start, end: start + result.length }) === result ? snapshotLayout(snapshot) : null)
      : expectedAfter(before, snapshot, replaced, result, start)
    if (!layout) return fallback('draft-mismatch')
    layout.clipboard = snapshot.draft
    const runs = projectDom(root, layout)
    if (!runs) return fallback('dom-mismatch')
    const doc = root.ownerDocument
    const view = doc?.defaultView
    const css = options.css ?? view?.CSS
    const HighlightCtor = options.Highlight ?? view?.Highlight
    if (!doc?.createRange || !doc?.createElement || !doc?.head?.appendChild ||
      !css?.highlights?.set || !css?.highlights?.delete || typeof HighlightCtor !== 'function') return fallback('unsupported')
    // 将结果坐标裁剪到真实文本节点，跨段落范围拆成多个 DOM Range。
    const toDomRanges = (spans) => {
      const built = []
      for (const span of spans) {
        const startAt = start + span.start
        const endAt = start + span.end
        for (const run of runs) {
          const left = Math.max(startAt, run.start)
          const right = Math.min(endAt, run.end)
          if (left >= right) continue
          try {
            const range = doc.createRange()
            range.setStart(run.node, left - run.start)
            range.setEnd(run.node, right - run.start)
            built.push(range)
          } catch { return null }
        }
      }
      return built
    }
    const greenSpans = colorSpans('green')
    const redSpans = colorSpans('red')
    const meaningful = (range) => /[\p{L}\p{N}]/u.test(result.slice(range.start, range.end))
    const hasMeaningful = [...greenSpans, ...redSpans].some(meaningful)
    const chosenGreen = hasMeaningful ? greenSpans.filter(meaningful) : greenSpans
    const chosenRed = hasMeaningful ? redSpans.filter(meaningful) : redSpans
    const wordRanges = toDomRanges(chosenGreen)
    const redRanges = toDomRanges(chosenRed)
    if (wordRanges === null || redRanges === null) return fallback('range-error')
    if (!wordRanges.length && !redRanges.length) return fallback('nontext-only')
    // CSS 高亮只装饰已有结果文字，不修改编辑器内容。
    const wordCss = options.wordCss ?? `::highlight(${name}) { background-color: rgba(61, 214, 140, 0.16); color: inherit; text-decoration: underline dashed #3DD68C; text-underline-offset: 2px; }`
    const redCss = options.redCss ?? `::highlight(${name}-del) { background-color: rgba(59, 130, 246, 0.16); color: inherit; text-decoration: underline dashed #3B82F6; text-underline-offset: 2px; }`
    const ownerState = { css, root, expectedDraft: snapshot.draft, expectedRev: snapshot.draftRev,
      observer: null, names: [], styles: [] }
    const paint = (key, cssText, ranges) => {
      const highlight = new HighlightCtor(...ranges)
      const style = doc.createElement('style')
      style.textContent = cssText
      doc.head.appendChild(style)
      css.highlights.set(key, highlight)
      ownerState.names.push(key)
      ownerState.styles.push(style)
    }
    try {
      if (wordRanges.length) paint(name, wordCss, wordRanges)
      if (redRanges.length) paint(`${name}-del`, redCss, redRanges)
      owner = ownerState
      const Observer = options.MutationObserver ?? view?.MutationObserver
      if (!options.managed && typeof Observer === 'function') {
        owner.observer = new Observer(() => {
          clear()
          options.onInvalidate?.()
        })
        owner.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
      }
    } catch {
      for (const key of ownerState.names) css.highlights.delete(key)
      for (const style of ownerState.styles) style?.remove()
      return fallback('highlight-error')
    }
    // 以整个结果草稿为分母计算高亮比例，供状态栏说明改动幅度。
    return (status = { kind: 'highlighted', reason: null, count: wordRanges.length, blocks: 0,
      replaced: redRanges.length, removed: walk.hunks.filter(hunk => hunk.rem !== null).length,
      coverage: [...chosenGreen, ...chosenRed].reduce((total, range) => total + (range.end - range.start), 0) / (snapshot.draft.length || 1) })
  }

  function check({ root, snapshot } = {}) {
    if (!owner) return status
    if (root !== owner.root || snapshot?.draft !== owner.expectedDraft ||
      snapshot?.draftRev !== owner.expectedRev) return fallback('draft-changed')
    const layout = snapshotLayout(snapshot)
    if (!projectDom(root, layout && { ...layout, clipboard: snapshot.draft })) return fallback('draft-changed')
    return status
  }

  return { diffRanges, diffHunks, diffSegments, coalesceRanges, detectSlice, show, clear, check, get status() { return status } }
}

    const inject = ['slots', 'commandUi', 'inputTriggers', 'sessions']
    const API = '/dsh-prompt-refine/api'
    const state = new Map()
    const mountedOverlays = new Map()
    const pendingUnmount = new Map()
    const pendingLaunch = new Map()
    let disposed = false
    const listeners = new Set()
    let generation = 0
    const emit = () => { for (const listener of listeners) listener() }
    const usePanel = (id) => React.useSyncExternalStore(
      (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
      () => state.get(id), () => undefined
    )
    const put = (id, patch) => { state.set(id, { ...state.get(id), ...patch }); emit() }
    const remove = (id) => {
      const panel = state.get(id)
      panel?.confirmation?.resolve(false)
      panel?.abort?.abort()
      panel?.unsubscribe?.()
      panel?.highlights?.clear()
      panel?.refinement?.clear()
      state.delete(id)
      emit()
    }
    // 草稿监听用于及时停止生成；实际写入仍由事务执行版本和内容校验。
    const draftSignature = (snapshot) => JSON.stringify({
      draft: snapshot?.draft, draftRev: snapshot?.draftRev, phase: snapshot?.phase,
      occurrences: snapshot?.occurrences ?? [], attachmentIds: snapshot?.attachmentIds ?? []
    })
    function chipRanges(occurrences) {
      let extra = 0
      return (occurrences ?? []).map((o) => {
        const start = o.offset - extra
        extra += o.length - 1
        return { start, end: start + 1, length: o.length }
      })
    }
    function clipboardAt(d, chips) {
      return d + chips.reduce((n, c) => n + (c.end <= d ? c.length - 1 : 0), 0)
    }
    function capture(input, actions, forceCommand = false) {
      if (!input || !actions || typeof input.draft !== 'string') throw Error('当前会话没有可用的输入框。')
      if (input.phase !== 'plain' && input.phase !== 'claimed') throw Error('输入框正在提交，请稍后重试。')
      const span = actions.captureInsertion()
      if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end)) throw Error('无法读取当前选区。')
      const chips = chipRanges(input.occurrences)
      const selected = span.start < span.end
      if (selected) {
        if (chips.some(c => c.start < span.end && c.end > span.start)) throw Error('选区包含引用，请重新选中纯文本段。')
        const text = input.draft.slice(clipboardAt(span.start, chips), clipboardAt(span.end, chips))
        if (!text.trim()) throw Error('没有可优化的文字。')
        return { original: text, span, mode: 'selection', draft: input.draft, draftRev: input.draftRev }
      }
      if (forceCommand) {
        const match = input.draft.match(/^\s*\/refine\s+([\s\S]+)$/u)
        if (!match || !match[1].trim() || chips.length) throw Error('请在 /refine 后输入正文；若含引用，请先选中纯文本段。')
        const start = input.draft.length - match[1].length
        return { original: match[1], span: { start, end: input.draft.length, draftRev: span.draftRev }, mode: 'selection', draft: input.draft, draftRev: input.draftRev }
      }
      // 命令裁决后才消费 token，因此空草稿和只有 /refine 的草稿需分别判断。
      if (!input.draft.trim()) throw Error('没有可优化的文字。请先输入内容，或选中一段文字。')
      if (/^\s*\/refine\s*$/u.test(input.draft)) throw Error('没有可优化的文字。请在 /refine 后输入要优化的内容，或选中一段文字。')
      if (chips.length || input.phase === 'claimed' || /^\s*\/\S/u.test(input.draft)) throw Error('草稿含引用或命令，请先选中纯文本段。')
      return { original: input.draft, mode: 'whole', draft: input.draft, draftRev: input.draftRev }
    }
    // 事务只拥有被替换范围；写入前校验版本，写入后核对全文和引用。
    // 后续回填和撤销都必须基于上一次已确认的快照。
    function draftTransaction(shell, source) {
      const snapshot = () => shell.state.getSnapshot()
      const record = (s) => ({
        draft: s?.draft, draftRev: s?.draftRev, phase: s?.phase,
        occurrences: JSON.stringify(s?.occurrences ?? []),
        attachmentIds: JSON.stringify(s?.attachmentIds ?? [])
      })
      const matches = (s, saved) => {
        const now = record(s)
        return Object.keys(saved).every(key => now[key] === saved[key])
      }
      let expected = record(snapshot())
      let span = source.span ? { ...source.span } : { start: 0, end: source.draft.length }
      if (expected.draftRev !== source.draftRev || expected.draft !== source.draft || !['plain', 'claimed'].includes(expected.phase)) throw Error('草稿已变化，请重新开始优化。')
      const initialChips = chipRanges(snapshot().occurrences)
      if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.start > span.end ||
          span.end > source.draft.length - initialChips.reduce((n, c) => n + c.length - 1, 0) ||
          initialChips.some(c => c.start < span.end && c.end > span.start) ||
          source.draft.slice(clipboardAt(span.start, initialChips), clipboardAt(span.end, initialChips)) !== source.original) {
        throw Error('选区已变化，请重新开始优化。')
      }
      let broken = false
      const reason = '草稿已被编辑或提交，已停止写入；没有覆盖你的修改。'
      function write(text) {
        if (broken) throw Error(reason)
        const current = snapshot()
        if (!matches(current, expected) || !['plain', 'claimed'].includes(current?.phase)) { broken = true; throw Error(reason) }
        // 宿主会过滤保留占位符，需在写入前拒绝，避免结果被静默截改。
        if (typeof text !== 'string' || /[\uE100-\uE11D\uFFFC]/u.test(text)) throw Error('结果含不支持的引用占位符。')
        const chips = chipRanges(current.occurrences)
        if (chips.some(c => c.start < span.end && c.end > span.start)) { broken = true; throw Error(reason) }
        const start = clipboardAt(span.start, chips)
        const end = clipboardAt(span.end, chips)
        const nextDraft = current.draft.slice(0, start) + text + current.draft.slice(end)
        const shift = text.length - (end - start)
        const nextChips = (current.occurrences ?? []).map(c => ({ ...c, offset: c.offset >= end ? c.offset + shift : c.offset }))
        const next = { ...expected, draft: nextDraft, draftRev: current.draftRev + Number(nextDraft !== current.draft), occurrences: JSON.stringify(nextChips) }
        let applied
        try { applied = shell.actions.insertText(text, { ...span, draftRev: current.draftRev }) }
        catch (error) { broken = true; throw error }
        if (!applied) { broken = true; throw Error('草稿已变化，已停止写入。') }
        if (!matches(snapshot(), next)) { broken = true; throw Error('回填结果与预期不符，已停止写入；请比较草稿并手动处理。') }
        expected = next
        span = { start: span.start, end: span.start + text.length }
      }
      return { write, undo: () => write(source.original), broken: () => broken, range: () => ({ ...span }) }
    }
    function shellFor(ctx, id) {
      const scope = ctx.sessions.scope(id)
      return scope?.get('conversation')?.input.for(scope)
    }
    function launch(ctx, id, command = false) {
      if (disposed) return
      clearTimeout(pendingLaunch.get(id))
      pendingLaunch.delete(id)
      const shell = shellFor(ctx, id)
      if (!shell) return
      const run = () => {
        pendingLaunch.delete(id)
        if (!disposed) openDraftTransaction(ctx, id, command)
      }
      // 斜杠命令在 Enter 裁决期间触发，等待输入状态稳定后捕获草稿。
      const settle = (tries) => {
        if (disposed) return
        const phase = shell.state.getSnapshot()?.phase
        if ((phase !== 'adjudicating' && phase !== 'submitting') || tries <= 0) return run()
        pendingLaunch.set(id, setTimeout(() => settle(tries - 1), 40))
      }
      settle(50)
    }
    // Composer is authoritative; session synchronizes text, rendering never writes editor content.
    function syncCurrent(id, panel, shell) {
      if (state.get(id)?.tx !== panel?.tx) return shell.state.getSnapshot()
      panel = state.get(id)
      const snapshot = shell.state.getSnapshot()
      if (panel.guard.writing || panel.guard.invalidated) return snapshot
      if (draftSignature(snapshot) === panel.guard.expected) return snapshot
      panel.abort?.abort()
      panel.guard.expected = draftSignature(snapshot)
      if ((panel.source.mode === 'selection') ||
          (panel.source.mode === 'whole' && (snapshot.occurrences ?? []).length)) {
        panel.guard.invalidated = true
        panel.highlights.clear()
        put(id, { busy: false, abort: null, preview: '', token: ++generation, highlightKind: 'none',
          error: '无法可靠追踪当前优化范围，已停止写入；请完成后重新开始。' })
        return snapshot
      }
      if (panel.source.mode === 'whole') panel.refinement.updateCurrent(snapshot.draft)
      put(id, { busy: false, abort: null, preview: '', token: ++generation, resultUnchanged: false,
        error: panel.abort ? '草稿已修改，已停止本次生成；你的修改已保留。' : '' })
      return snapshot
    }
    function currentTransaction(panel, shell) {
      if (panel.source.mode !== 'whole') return panel.tx
      const snapshot = shell.state.getSnapshot()
      return draftTransaction(shell, { original: snapshot.draft, mode: 'whole',
        draft: snapshot.draft, draftRev: snapshot.draftRev })
    }
    function refreshDiff(id, panel) {
      if (state.get(id)?.tx !== panel.tx || panel.guard.invalidated || panel.guard.composing || !panel.refinement.hasResult) return
      const shell = shellFor(panel.ctx, id)
      if (!shell) return
      const snapshot = shell.state.getSnapshot()
      const range = panel.source.mode === 'whole' ? { start: 0 } : panel.tx.range()
      try {
        const shown = panel.highlights.show({ root: shell.editor?.getRootElement?.(), snapshot,
          original: panel.refinement.original, result: panel.refinement.current, start: range.start, currentMode: true })
        put(id, { highlightKind: shown.kind, highlightCoverage: shown.coverage ?? 0 })
      } catch {
        try { panel.highlights.clear() } catch {}
        put(id, { highlightKind: 'fallback', highlightCoverage: 0 })
      }
    }
    function openDraftTransaction(ctx, id, command = false) {
      const shell = shellFor(ctx, id)
      if (!shell) return
      try {
        if (state.get(id)?.open) return
        const source = capture(shell.state.getSnapshot(), shell.actions, command)
        const tx = draftTransaction(shell, source)
        const highlights = createHighlightCore({ managed: true })
        const refinement = new RefinementSession()
        refinement.begin(source.original)
        const guard = { expected: draftSignature(shell.state.getSnapshot()),
          writing: false, invalidated: false, composing: false }
        put(id, { open: true, source, refinement, note: '', error: '', busy: false, abort: null,
          token: ++generation, tx, highlights, guard, ctx, highlightKind: 'none' })
        const panel = state.get(id)
        let timer = null
        let root = null
        let observer = null
        const schedule = () => {
          clearTimeout(timer)
          if (guard.composing) return
          timer = setTimeout(() => {
            timer = null
            if (state.get(id)?.tx !== tx) return
            bindRoot()
            syncCurrent(id, state.get(id), shell)
            refreshDiff(id, panel)
          }, 200)
        }
        const onCompositionStart = () => {
          guard.composing = true
          clearTimeout(timer)
          highlights.clear()
          state.get(id)?.abort?.abort()
          put(id, { busy: false, abort: null, preview: '', token: ++generation, highlightKind: 'none' })
        }
        const onCompositionEnd = () => {
          guard.composing = false
          if (state.get(id)?.tx !== tx) return
          syncCurrent(id, state.get(id), shell)
          schedule()
        }
        const bindRoot = () => {
          const next = shell.editor?.getRootElement?.()
          if (root === next) return
          guard.composing = false
          highlights.clear()
          observer?.disconnect()
          root?.removeEventListener?.('compositionstart', onCompositionStart)
          root?.removeEventListener?.('compositionend', onCompositionEnd)
          root = next
          const Observer = root?.ownerDocument?.defaultView?.MutationObserver
          observer = typeof Observer === 'function' ? new Observer(() => {
            if (state.get(id)?.tx !== tx) return
            highlights.clear()
            put(id, { highlightKind: 'none' })
            syncCurrent(id, state.get(id), shell)
            schedule()
          }) : null
          observer?.observe(root, { subtree: true, childList: true, characterData: true })
          root?.addEventListener?.('compositionstart', onCompositionStart)
          root?.addEventListener?.('compositionend', onCompositionEnd)
          return true
        }
        bindRoot()
        const unsubscribeRefinement = refinement.subscribe(() => {
          put(id, { refinementSnapshot: refinement.getSnapshot() })
          schedule()
        })
        const unsubscribeRoot = shell.editor?.registerRootListener?.(() => {
          if (state.get(id)?.tx === tx && bindRoot()) {
            put(id, { highlightKind: 'none' })
            schedule()
          }
        })
        const session = ctx.sessions.binding?.(id)?.session
        const pendingSubmissions = () => session?.getSnapshot?.()?.pendingSubmissions ?? []
        const existingSubmissions = new Set(pendingSubmissions().map(item => item.requestId))
        const closeForSubmission = () => {
          if (state.get(id)?.tx !== tx) return false
          // 普通发送保持 plain，通过 Session 新增提交标识判断；命令进入 submitting。
          // 只比较提交标识，不读取或发送提交正文。
          if (!pendingSubmissions().some(item => item.requestId && !existingSubmissions.has(item.requestId))) return false
          remove(id)
          return true
        }
        const unsubscribeInput = shell.state.subscribe?.(() => {
          if (state.get(id)?.tx !== tx) return
          const snapshot = shell.state.getSnapshot()
          // 提交检查先于失效检查，确保手动编辑后的面板也能在发送时关闭。
          if (snapshot?.phase === 'submitting') { remove(id); return }
          if (closeForSubmission()) return
          if (guard.writing || guard.invalidated) return
          if (bindRoot()) schedule()
          if (draftSignature(snapshot) !== guard.expected) {
            highlights.clear()
            put(id, { highlightKind: 'none' })
            syncCurrent(id, state.get(id), shell)
            schedule()
          }
        })
        const unsubscribeSession = session?.subscribe?.(closeForSubmission)
        panel.unsubscribe = () => {
          unsubscribeInput?.(); unsubscribeSession?.(); unsubscribeRefinement(); unsubscribeRoot?.()
          clearTimeout(timer)
          observer?.disconnect()
          root?.removeEventListener?.('compositionstart', onCompositionStart)
          root?.removeEventListener?.('compositionend', onCompositionEnd)
        }
        void generate(id, panel)
      } catch (error) {
        shell.notify('error', error.message)
      }
    }
    function confirmOverwrite(id, panel, message, resolve) {
      if (state.get(id)?.tx !== panel.tx || state.get(id)?.confirmation) { resolve(false); return }
      put(id, { confirmation: { message, resolve } })
    }
    function answerConfirmation(id, panel, accepted) {
      const live = state.get(id)
      if (live?.tx !== panel.tx || !live.confirmation) return
      const confirmation = live.confirmation
      put(id, { confirmation: null })
      confirmation.resolve(accepted)
    }
    async function generate(id, panel) {
      if (state.get(id)?.tx !== panel.tx || panel.guard.invalidated || panel.guard.composing) return
      const shell = shellFor(panel.ctx, id)
      if (!shell) return
      panel = state.get(id)
      syncCurrent(id, panel, shell)
      panel = state.get(id)
      if (!panel || panel.guard.invalidated) return
      const requestSignature = draftSignature(shell.state.getSnapshot())
      if (panel.refinement.dirty && !await new Promise(resolve => confirmOverwrite(id, panel,
        '当前内容已经修改，重新生成会覆盖你的修改。是否继续？', resolve))) return
      // A confirmation is not permission to overwrite a later revision.
      if (state.get(id)?.tx !== panel.tx || panel.guard.invalidated || panel.guard.composing ||
        draftSignature(shell.state.getSnapshot()) !== requestSignature) return
      panel.abort?.abort()
      const writeTx = currentTransaction(panel, shell)
      const controller = new AbortController()
      const token = ++generation
      const requestNote = panel.note
      // 增量仅作预览；失败或停止不写草稿，重新生成期间保留上次成功结果。
      put(id, { preview: '', error: '', busy: true, abort: controller, token, resultUnchanged: false })
      try {
        const response = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id, text: panel.refinement.original, note: requestNote }), signal: controller.signal })
        if (!response.ok) {
          let message = `请求失败 (${response.status})`
          try { message = (await response.json()).error ?? message } catch {}
          throw Error(message)
        }
        if (!response.body) throw Error('服务器未返回流。')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let preview = ''
        let finalText = null
        function consume(message) {
          const line = message.split('\n').find(s => s.startsWith('data: '))
          const type = message.split('\n').find(s => s.startsWith('event: '))?.slice(7)
          if (controller.signal.aborted || state.get(id)?.token !== token) return
          if (finalText !== null && message.trim()) throw Error('模型完成后仍返回数据，未回填草稿。')
          if (!line || !type) return
          const data = JSON.parse(line.slice(6))
          if (type === 'delta') {
            if (typeof data.text !== 'string') throw Error('模型返回了无效的结果。')
            preview += data.text
            put(id, { preview })
          }
          if (type === 'done') {
            if (typeof data.text !== 'string' || !data.text || /[\uE100-\uE11D\uFFFC]/u.test(data.text)) throw Error('模型返回了无效的结果。')
            finalText = data.text
          }
          if (type === 'failure') throw Error(data.error)
        }
        while (true) {
          const { done, value } = await reader.read()
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
          let index
          while ((index = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 2) }
          if (done) break
        }
        if (!controller.signal.aborted && state.get(id)?.token === token && !panel.guard.composing) {
          if (buffer.trim()) throw Error('模型返回了不完整的数据，未回填草稿。')
          if (finalText === null) throw Error('模型未完成响应，请重试。')
          // Commit only a normally completed response against the request's unchanged draft.
          if (draftSignature(shell.state.getSnapshot()) !== requestSignature) throw Error('草稿已变化，已停止写入；没有覆盖你的修改。')
          panel.guard.writing = true
          try { writeTx.write(finalText) }
          finally { panel.guard.writing = false }
          if (state.get(id)?.tx !== panel.tx || panel.guard.invalidated || panel.guard.composing ||
            state.get(id)?.token !== token) return
          const snapshot = shell.state.getSnapshot()
          panel.guard.expected = draftSignature(snapshot)
          const unchanged = panel.refinement.hasResult && finalText === panel.refinement.optimized
          panel.refinement.applyGeneration(finalText)
          refreshDiff(id, panel)
          put(id, { preview: '', resultUnchanged: unchanged })
        }
      } catch (error) {
        if (state.get(id)?.token === token && !controller.signal.aborted) put(id, { error: error.message })
        controller.abort()
      } finally {
        if (state.get(id)?.token === token) put(id, { busy: false, abort: null, preview: '' })
      }
    }
    // 按钮背景和选中态由样式表控制，避免行内背景压过悬停规则。
    const base = { font: 'inherit', fontSize: 14, lineHeight: '20px', padding: '4px 8px', borderRadius: 6,
      cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid transparent',
      color: 'var(--dsw-alias-label-secondary, #6E7681)' }
    // 完成按钮使用固定蓝底白字，避免宿主主题变量导致文字与背景对比不足。
    const btn = { ...base, fontWeight: 500 }
    const primary = { ...base, color: '#fff' }
    const triggerCss = '.dsh-prompt-refine-trigger { background: transparent !important; }' +
      '.dsh-prompt-refine-trigger:hover { background: var(--dsw-alias-fill-secondary, #F0F1F3) !important; color: var(--dsw-alias-label-primary, #E7E9EE); }' +
      '.dsh-prompt-refine-trigger[data-active="true"] { background: var(--dsw-alias-bg-module-platform, #ffffff1a) !important; }' +
      '.dsh-prompt-refine-trigger:disabled:hover { background: transparent !important; color: var(--dsw-alias-label-secondary, #6E7681); }' +
      '.dsh-prompt-refine-primary { background: #3157D5 !important; color: #fff !important; -webkit-text-fill-color: #fff !important; }' +
      '.dsh-prompt-refine-primary:hover { background: #2544AE !important; color: #fff !important; }' +
      '.dsh-prompt-refine-primary:active { background: #203B97 !important; color: #fff !important; }'
    const stripStyle = { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1, boxSizing: 'border-box',
      padding: '6px 10px', maxHeight: 'min(60vh, 340px)', overflowY: 'auto',
      borderTopLeftRadius: 'var(--dsh-prompt-refine-top-left-radius, 0px)',
      borderTopRightRadius: 'var(--dsh-prompt-refine-top-right-radius, 0px)',
      borderBottom: '1px solid var(--dsw-alias-border-l2, #ffffff1a)',
      background: 'var(--dsw-specific-input-major, #24282F)',
      color: 'var(--dsw-alias-label-primary, #E7E9EE)' }
    const rowStyle = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }
    // 状态徽标使用成对的文字和背景颜色，保证两种主题下可读。
    const statusStyle = { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto',
      minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 500 }
    const statusBadgeStyle = { display: 'inline-block', padding: '4px 8px', borderRadius: 6,
      fontSize: 14, fontWeight: 600, flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }
    const statusColors = {
      success: { background: '#E7F4EC', color: '#167044' },
      busy: { background: '#EDF1FF', color: '#3157D5' },
      neutral: { background: '#F0F1F4', color: '#353944' },
      stopped: { background: '#FFF3DC', color: '#895B0E' }
    }
    const groupStyle = { display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }
    const dividerStyle = { width: 1, height: 16, background: 'var(--dsw-alias-border-l2, #ffffff1f)', flex: '0 0 auto' }
    const fieldStyle = { width: '100%', marginTop: 6, boxSizing: 'border-box', font: 'inherit', fontSize: 14,
      fontWeight: 500, padding: '6px 8px', borderRadius: 6, border: '1px solid #C9CED6',
      background: '#F1F2F4', color: '#1E2430' }
    const fieldCss = '.dsh-prompt-refine-field::placeholder { color: #6B7280; opacity: 1; }'
    const errorStyle = { font: 'inherit', fontSize: 13, fontWeight: 500, lineHeight: '20px',
      color: '#ff9b9b', marginTop: 6, overflowWrap: 'anywhere' }
    const hintStyle = { display: 'block', marginTop: 4, fontSize: 11, opacity: 0.55 }
    function Button(props) {
      const panel = usePanel(props.sessionId)
      const selected = !!panel?.open
      return React.createElement('button', { type: 'button', className: 'dsh-prompt-refine-trigger', style: btn, disabled: selected, onClick: () => launch(props.refineContext, props.sessionId) }, '优化提示词')
    }
    // 浮层锚点不占高度，仅在所属输入卡片内预留空间，避免遮挡正文。
    const reserveCss = '[data-composer-card][data-dsh-prompt-refine-reserve] { padding-top: calc(var(--dsh-prompt-refine-base-padding, 8px) + var(--dsh-prompt-refine-panel-height, 0px)); }'
    function Overlay(props) {
      const id = props.sessionId
      const panel = usePanel(id)
      const wrapper = React.useRef(null)
      React.useLayoutEffect(() => {
        if (!panel?.open) return
        const element = wrapper.current
        const card = element?.closest('[data-composer-card]')
        if (!card) return
        const originalAttribute = card.getAttribute('data-dsh-prompt-refine-reserve')
        const originalBase = [card.style.getPropertyValue('--dsh-prompt-refine-base-padding'), card.style.getPropertyPriority('--dsh-prompt-refine-base-padding')]
        const originalHeight = [card.style.getPropertyValue('--dsh-prompt-refine-panel-height'), card.style.getPropertyPriority('--dsh-prompt-refine-panel-height')]
        const view = element.ownerDocument?.defaultView
        const basePadding = view?.getComputedStyle?.(card)?.paddingTop || '8px'
        card.style.setProperty('--dsh-prompt-refine-base-padding', basePadding)
        card.setAttribute('data-dsh-prompt-refine-reserve', '')
        let live = true
        const measure = () => {
          if (!live) return
          // 浮层与卡片不是同一节点，需分别读取并复制两个顶部圆角。
          const cardStyle = view?.getComputedStyle?.(card)
          element.style.setProperty('--dsh-prompt-refine-top-left-radius', cardStyle?.borderTopLeftRadius || '0px')
          element.style.setProperty('--dsh-prompt-refine-top-right-radius', cardStyle?.borderTopRightRadius || '0px')
          card.style.setProperty('--dsh-prompt-refine-panel-height', `${Math.ceil(element.getBoundingClientRect().height) + 8}px`)
        }
        measure()
        const Observer = view?.ResizeObserver ?? (typeof ResizeObserver === 'function' ? ResizeObserver : null)
        const observer = Observer ? new Observer(measure) : null
        observer?.observe(element)
        if (!observer) view?.addEventListener?.('resize', measure)
        return () => {
          live = false
          observer?.disconnect()
          if (!observer) view?.removeEventListener?.('resize', measure)
          if (originalAttribute === null) card.removeAttribute('data-dsh-prompt-refine-reserve')
          else card.setAttribute('data-dsh-prompt-refine-reserve', originalAttribute)
          for (const [name, [value, priority]] of [
            ['--dsh-prompt-refine-base-padding', originalBase],
            ['--dsh-prompt-refine-panel-height', originalHeight]
          ]) {
            if (value) card.style.setProperty(name, value, priority)
            else card.style.removeProperty(name)
          }
        }
      }, [id, !!panel?.open])
      React.useLayoutEffect(() => {
        const pending = pendingUnmount.get(id)
        if (pending !== undefined) { clearTimeout(pending); pendingUnmount.delete(id) }
        mountedOverlays.set(id, (mountedOverlays.get(id) ?? 0) + 1)
        return () => {
          const remaining = (mountedOverlays.get(id) ?? 1) - 1
          if (remaining > 0) { mountedOverlays.set(id, remaining); return }
          mountedOverlays.delete(id)
          // 延迟一轮清理，允许 React 严格模式或输入框切换时的立即重挂载取消清理。
          // 真正卸载后释放当前会话的请求、高亮和订阅。
          if (pendingUnmount.has(id)) return
          pendingUnmount.set(id, setTimeout(() => { pendingUnmount.delete(id); remove(id) }, 0))
        }
      }, [id])
      if (!panel?.open) return null
      const h = React.createElement
      const stop = () => {
        const live = state.get(id)
        if (live?.tx !== panel.tx) return
        live.abort?.abort()
        put(id, { busy: false, abort: null, token: ++generation })
      }
      const finish = () => { if (state.get(id)?.tx !== panel.tx) return; stop(); remove(id) }
      const undo = () => {
        if (state.get(id)?.tx !== panel.tx) return
        const shell = shellFor(panel.ctx, id)
        if (!shell) return
        syncCurrent(id, state.get(id), shell)
        if (panel.guard.invalidated || panel.guard.composing) return
        const expected = draftSignature(shell.state.getSnapshot())
        const restore = accepted => {
          if (!accepted || state.get(id)?.tx !== panel.tx || panel.guard.invalidated || panel.guard.composing ||
            draftSignature(shell.state.getSnapshot()) !== expected) return
          stop()
          try {
            const tx = currentTransaction(panel, shell)
            panel.guard.writing = true
            tx.write(panel.refinement.original)
            remove(id)
          } catch (error) {
            if (state.get(id)?.tx === panel.tx) put(id, { error: error.message + ' 可展开原文查看。' })
          }
          finally { panel.guard.writing = false }
        }
        if (panel.refinement.dirty) confirmOverwrite(id, panel,
          '当前内容已经修改，撤销会覆盖你的修改。是否继续？', restore)
        else restore(true)
      }
      const button = (text, onClick, disabled = false, style = btn, dataActive) =>
        h('button', { type: 'button', className: 'dsh-prompt-refine-trigger', 'data-active': dataActive ? 'true' : undefined, style, disabled, onClick }, text)
      const toggle = (text, key) => button(text, () => {
        const live = state.get(id)
        if (live?.tx === panel.tx) put(id, { [key]: !live[key] })
      }, false, btn, !!panel[key])
      const statusText = panel.busy ? '正在优化草稿…'
        : panel.guard?.invalidated ? '优化范围已变化，已停止写入'
          : panel.refinement.dirty ? '正在编辑 · 差异实时更新'
          : panel.refinement.hasResult
            ? (panel.resultUnchanged ? '已重新生成 · 结果与上次相同'
              : panel.highlightKind === 'highlighted'
              ? (panel.highlightCoverage >= 0.6 ? '已优化 · 改动较大' : '已优化 · 改动已标出')
              : '已优化')
            : '优化草稿'
      const [statusLabel] = statusText.split(' · ')
      const statusTone = panel.busy ? 'busy' : panel.guard?.invalidated ? 'stopped'
        : panel.refinement.hasResult && !panel.resultUnchanged ? 'success' : 'neutral'
      return h('section', { ref: wrapper, 'aria-label': '提示词优化操作条', style: stripStyle },
        h('style', null, `${reserveCss} ${fieldCss}`),
        h('div', { style: rowStyle },
          h('span', { style: statusStyle, title: statusText, role: 'status', 'aria-live': 'polite', 'aria-label': statusText },
            h('span', { className: 'dsh-prompt-refine-status-badge', style: { ...statusBadgeStyle, ...statusColors[statusTone] } }, statusLabel)),
          h('div', { style: groupStyle },
            toggle('原文', 'showOriginal'),
            toggle('补充要求', 'showNote'),
            h('span', { style: dividerStyle }),
            panel.busy ? button('停止生成', stop) : button('重新生成', () => generate(id, panel), !!panel.guard?.invalidated || panel.guard.composing),
            button('撤销优化', undo, !!panel.guard?.invalidated || panel.guard.composing || !panel.refinement.hasResult),
            h('button', { type: 'button', className: 'dsh-prompt-refine-primary', style: primary, onClick: finish }, '完成'))),
        panel.showOriginal && h('textarea', { className: 'dsh-prompt-refine-field', 'aria-label': '优化前原文', readOnly: true, value: panel.refinement.original, style: { ...fieldStyle, minHeight: 56, maxHeight: 140, resize: 'vertical' } }),
        panel.showNote && h('input', { className: 'dsh-prompt-refine-field', 'aria-label': '本次补充要求', placeholder: '补充要求（重新生成时生效）', value: panel.note, maxLength: 2000, onChange: e => { if (state.get(id)?.tx === panel.tx) put(id, { note: e.target.value }) }, style: fieldStyle }),
        panel.confirmation && h('div', { role: 'alert', style: rowStyle },
          h('span', { style: { flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' } }, panel.confirmation.message),
          h('div', { style: { ...groupStyle, marginLeft: 'auto' } },
            button('确认覆盖', () => answerConfirmation(id, panel, true)),
            button('取消', () => answerConfirmation(id, panel, false)))),
        panel.error && h('div', { role: 'alert', className: 'dsh-prompt-refine-error', style: errorStyle }, panel.error),
        !panel.refinement.hasResult && !panel.busy && h('small', { style: hintStyle }, '生成完成后才写入输入框，不会自动发送。'))
    }
    function apply(ctx) {
      disposed = false
      ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'dsh-prompt-refine-overlay', order: 100, inject: (sessionId) => ({ sessionId }) }, Overlay))
      ctx.effect(() => () => {
        disposed = true
        for (const timer of pendingLaunch.values()) clearTimeout(timer)
        pendingLaunch.clear()
        for (const timer of pendingUnmount.values()) clearTimeout(timer)
        pendingUnmount.clear()
        mountedOverlays.clear()
        for (const id of [...state.keys()]) remove(id)
      }, 'prompt-refine: cleanup')
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-prompt-refine-button', order: 35, inject: (sessionId) => ({ sessionId, refineContext: ctx }) }, Button))
      // 触发按钮在面板关闭时仍可见，样式生命周期绑定插件而非单次浮层。
      ctx.effect(() => {
        const style = globalThis.document?.createElement?.('style')
        if (!style) return
        style.textContent = triggerCss
        globalThis.document.head.appendChild(style)
        return () => style.remove()
      }, 'prompt-refine: trigger hover style')
      ctx.effect(() => ctx.commandUi.register({ name: 'refine', label: () => '优化提示词', available: () => true, ui: { kind: 'action', run: (session) => launch(ctx, session.sessionId) } }), 'prompt-refine: command menu')
      ctx.effect(() => ctx.inputTriggers.registerSource({ trigger: '/', name: 'prompt-refine-enter', candidates: async () => [], onPick: () => undefined,
        matchEnter: (session, line) => {
          // 只有 /refine 时交由宿主菜单处理；携带正文时直接优化正文。
          if (!/^\/refine\s+[\s\S]+$/u.test(line)) return
          launch(ctx, session.sessionId, true)
          return 'handled'
        }
      }), 'prompt-refine: typed command')
    }
    exports.apply = apply
    exports.createHighlightCore = createHighlightCore
    exports.inject = inject
    exports.draftTransaction = draftTransaction
    exports.capture = capture
    exports.chipRanges = chipRanges
    exports.clipboardAt = clipboardAt
    exports.triggerCss = triggerCss
    return exports
  }
})
