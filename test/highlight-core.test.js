import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as expansion from './fixtures/prompt-expansion.js'
import { introducedListItems } from '../lib/highlight-core.js'

// 使用实际分发的浏览器模块测试高亮渲染。
const source = readFileSync(new URL('../lib/client.bundle.js', import.meta.url), 'utf8')
let client
const context = vm.createContext({
  window: { __ModuleLoader__: { load: ({ factory }) => { client = factory(() => ({})) } } }
})
vm.runInContext(source, context)
const make = options => client.createHighlightCore(options)
const native = (value) => JSON.parse(JSON.stringify(value))

// Isolate rendering from diff discovery by injecting the source module's import in a VM.
// The production module exposes no test-only option or dependency hook.
function sourceCore(diffEngine, options = {}) {
  const renderer = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    .replace("import * as diffEngine from './highlight-core.js'", '')
    .replace("import { RefinementSession } from './refinement-session.js'", '')
  let loaded
  vm.runInNewContext(renderer, {
    diffEngine: { introducedListItems, ...diffEngine },
    window: { __ModuleLoader__: { load: ({ factory }) => { loaded = factory(() => ({})) } } }
  }, { filename: 'client.source.js' })
  return loaded.createHighlightCore(options)
}

// Verify ordered, bounded hunks encode the claimed edit, including equal gaps.
function stubWalk(original, result, hunks) {
  let oldAt = 0
  let newAt = 0
  for (const hunk of hunks) {
    const addAt = hunk.add?.start ?? hunk.resultAnchor
    const equalLength = addAt - newAt
    assert.ok(equalLength >= 0)
    assert.equal(original.slice(oldAt, oldAt + equalLength), result.slice(newAt, addAt))
    oldAt += equalLength
    newAt = addAt
    if (hunk.rem) {
      assert.equal(hunk.rem.start, oldAt)
      assert.ok(hunk.rem.end > oldAt && hunk.rem.end <= original.length)
      oldAt = hunk.rem.end
    }
    if (hunk.add) {
      assert.ok(hunk.add.end > newAt && hunk.add.end <= result.length)
      newAt = hunk.add.end
    }
  }
  assert.equal(original.slice(oldAt), result.slice(newAt))
  return { hunks, reason: null }
}

function dom(draft, chips = [], opts = {}) {
  function element(tag, attributes = {}, ...children) {
    const node = {
      nodeType: 1, tagName: tag.toUpperCase(), attrs: attributes, childNodes: children,
      getAttribute: (name) => Object.hasOwn(attributes, name) ? attributes[name] : null,
      remove() { node.removed = true }
    }
    return node
  }
  const text = (data) => ({ nodeType: 3, data })
  // 模拟宿主段落和原子引用节点。
  const lines = draft.split('\n')
  const para = []
  let global = 0
  for (const line of lines) {
    const nodes = []
    let pos = global
    for (const chip of chips.filter(c => c.offset >= global && c.offset + c.length <= global + line.length)) {
      if (chip.offset > pos) nodes.push(element('span', {}, text(draft.slice(pos, chip.offset))))
      nodes.push(element('span', { 'data-composer-chip': chip.source, contenteditable: 'false' },
        element('span', {}, text(chip.label))))
      pos = chip.offset + chip.length
    }
    if (pos < global + line.length) nodes.push(element('span', {}, text(draft.slice(pos, global + line.length))))
    if (!nodes.length) nodes.push(element('br', { 'data-lexical-managed-linebreak': 'true' }))
    para.push(element('p', {}, ...nodes))
    global += line.length + 1
  }
  const root = element('div', { 'data-composer-input': '' }, ...para)
  const highlights = new Map()
  const doc = {
    // 每种高亮颜色各插入一个样式节点。
    styles: [],
    head: { appendChild: (style) => { doc.styles.push(style); doc.style = style } },
    createElement: (tag) => element(tag),
    createRange: () => ({ setStart(node, offset) { this.start = [node, offset] }, setEnd(node, offset) { this.end = [node, offset] } }),
    defaultView: {
      CSS: { highlights },
      Highlight: class { constructor(...ranges) { this.ranges = ranges } },
      MutationObserver: class {
        constructor(cb) { this.cb = cb; doc.observer = this }
        observe() { this.active = true }
        disconnect() { this.active = false }
        notify() { if (this.active) this.cb() }
      }
    }
  }
  if (opts.unsupported) delete doc.defaultView.Highlight
  root.ownerDocument = doc
  return { root, doc, highlights, para }
}
const snapshot = (draft, occurrences = [], draftRev = 1) => ({ draft, occurrences, draftRev })
const occ = (offset, clipboardText = '@ref') => ({ offset, length: clipboardText.length, clipboardText, label: 'ref', source: 'files', ref: 'foo', occurrenceId: 1 })

test('diff returns bounded UTF-16 changed spans without splitting emoji', () => {
  const core = make()
  assert.deepEqual(native(core.diffRanges('cat', 'cut')), { ranges: [{ start: 1, end: 2 }], reason: null })
  assert.deepEqual(native(core.diffRanges('abcDEFghi', 'abcXDEFYghi')), { ranges: [{ start: 3, end: 4 }, { start: 7, end: 8 }], reason: null })
  assert.deepEqual(native(core.diffRanges('a', 'a🙂')), { ranges: [{ start: 1, end: 3 }], reason: null })
  assert.deepEqual(native(core.diffRanges('🙂', '🧑')), { ranges: [{ start: 0, end: 2 }], reason: null })
  assert.deepEqual(native(core.diffRanges('a b', 'a b')), { ranges: [], reason: 'unchanged' })
  assert.deepEqual(native(core.diffRanges('abc', 'ac')), { ranges: [], reason: 'no-visible-addition' })
  assert.deepEqual(native(core.diffRanges('a'.repeat(1000), 'b'.repeat(1000))), { ranges: [{ start: 0, end: 1000 }], reason: null })
  assert.deepEqual(native(make({ maxLength: 2 }).diffRanges('aaa', 'bbb')), { ranges: [{ start: 0, end: 3 }], reason: null })
})

const add = (start, end, rem = null) => ({ add: { start, end }, rem })
const deletion = (start, end, resultAnchor) => ({ add: null, rem: { start, end }, resultAnchor })

for (const [label, original, result, color, hunks] of [
  ['single retained letter', 'a', 'XaY', 'green', [add(0, 1), add(2, 3)]],
  ['retained letters with deletion', 'acb', 'XabY', 'green', [add(0, 1), deletion(1, 2, 2), add(3, 4)]],
  ['two replacements around retained letters', 'pabq', 'XabY', 'red', [add(0, 1, { start: 0, end: 1 }), add(3, 4, { start: 3, end: 4 })]],
  ['two replacements with deletion', 'pacbq', 'XabY', 'red', [add(0, 1, { start: 0, end: 1 }), deletion(2, 3, 2), add(3, 4, { start: 4, end: 5 })]],
  ['retained punctuation', ';;;', 'X;;;Y', 'green', [add(0, 1), add(4, 5)]],
  ['retained emoji', 'p🙂🙂q', 'X🙂🙂Y', 'red', [add(0, 1, { start: 0, end: 1 }), add(5, 6, { start: 5, end: 6 })]]
]) {
  for (const currentMode of [false, true]) test(`isolated renderer keeps ${label} unpainted (${currentMode ? 'current' : 'write'} mode)`, () => {
    const walk = stubWalk(original, result, hunks)
    const core = sourceCore({ diffHunks: (old, next) => {
      assert.equal(old, original)
      assert.equal(next, result)
      return walk
    } }, { name: 'isolated' })
    const { root, doc, highlights } = dom(result)
    const nodes = root.childNodes[0].childNodes
    const text = nodes[0].childNodes[0]
    const before = snapshot(original)
    const after = snapshot(result, [], 2)
    const saved = structuredClone({ before, after, walk })
    const shown = core.show({ root, before, snapshot: after, original, result, start: 0, currentMode })
    const key = color === 'green' ? 'isolated' : 'isolated-del'
    const opposite = color === 'green' ? 'isolated-del' : 'isolated'
    assert.equal(shown.kind, 'highlighted')
    assert.equal(shown.count, color === 'green' ? 2 : 0)
    assert.equal(shown.replaced, color === 'red' ? 2 : 0)
    assert.equal(shown.coverage, 2 / result.length)
    assert.deepEqual(highlights.get(key).ranges.map(r => [r.start[1], r.end[1]]), [[0, 1], [result.length - 1, result.length]])
    assert.equal(highlights.has(opposite), false)
    assert.equal(highlights.size, 1)
    assert.equal(doc.styles.length, 1)
    for (const range of highlights.get(key).ranges) {
      assert.equal(range.start[0], text)
      assert.equal(range.end[0], text)
    }
    assert.equal(root.childNodes[0].childNodes, nodes)
    assert.equal(nodes[0].childNodes[0], text)
    assert.equal(text.data, result)
    assert.deepEqual({ before, after, walk }, saved)
  })
}

for (const [original, color, hunks] of [
  ['cb', 'green', [add(0, 1), deletion(0, 1, 1), add(1, 2)]],
  ['pcqb', 'red', [add(0, 1, { start: 0, end: 1 }), deletion(1, 2, 1), add(1, 2, { start: 2, end: 3 })]]
]) test(`deletion-only hunk breaks even touching ${color} groups without creating a range`, () => {
  const result = 'XYb'
  const walk = stubWalk(original, result, hunks)
  const core = sourceCore({ diffHunks: () => walk }, { name: 'barrier' })
  const { root, highlights } = dom(result)
  const shown = core.show({ root, snapshot: snapshot(result), original, result, start: 0, currentMode: true })
  assert.equal(shown.kind, 'highlighted')
  const key = color === 'green' ? 'barrier' : 'barrier-del'
  assert.deepEqual(highlights.get(key).ranges.map(r => [r.start[1], r.end[1]]), [[0, 1], [1, 2]])
  assert.equal(shown.count, color === 'green' ? 2 : 0)
  assert.equal(shown.replaced, color === 'red' ? 2 : 0)
  assert.equal(shown.coverage, 2 / result.length)
  assert.equal(highlights.size, 1)
  assert.equal(root.childNodes[0].childNodes[0].childNodes[0].data, result)
})

test('show maps inserted changes to text nodes, without mutating editor or caret', () => {
  const core = make({ name: 'test' })
  const { root, doc, highlights } = dom('abc X\ndef')
  const old = snapshot('abc\ndef')
  const next = snapshot('abc X\ndef', [], 2)
  const out = core.show({ root, before: old, snapshot: next, original: 'abc\ndef', result: 'abc X\ndef', start: 0 })
  assert.equal(out.kind, 'highlighted')
  assert.equal(out.count, 1)
  assert.deepEqual([...highlights.keys()], ['test'])
  assert.equal(doc.styles.length, 1)
  const [r] = highlights.get('test').ranges
  assert.equal(r.start[0].data, 'abc X')
  // 高亮范围应去除新增词前的空格。
  assert.deepEqual([r.start[1], r.end[1]], [4, 5])
  assert.equal(doc.styles.some(style => style.textContent.includes('::highlight(test)')), true)
  assert.equal(next.draft, 'abc X\ndef')
  assert.equal(root.childNodes[0].childNodes[0].childNodes[0].data, 'abc X')
  assert.equal(core.check({ root, snapshot: next }).kind, 'highlighted')
  doc.observer.notify() // 后续编辑应清除失效范围。
  assert.equal(highlights.size, 0)
  assert.equal(doc.style.removed, true)
  assert.equal(core.status.kind, 'none')
})

test('paragraph gaps and explicit BR split ranges rather than fabricate DOM text', () => {
  const core = make({ name: 'across' })
  const { root, highlights } = dom('hello\nworld')
  const out = core.show({ root, before: snapshot(''), snapshot: snapshot('hello\nworld', [], 2), original: '', result: 'hello\nworld', start: 0 })
  assert.equal(out.kind, 'highlighted')
  assert.equal(out.count, 2)
  assert.deepEqual(highlights.get('across').ranges.map(r => [r.start[0].data, r.start[1], r.end[1]]),
    [['hello', 0, 5], ['world', 0, 5]])
})

test('chip offsets, metadata, and decorator text are checked before creating ranges', () => {
  const core = make({ name: 'chips' })
  const first = occ(0)
  const original = '@ref hello'
  const updated = '@ref HELLO'
  const { root, highlights } = dom(updated, [first])
  const out = core.show({ root, before: snapshot(original, [first]), snapshot: snapshot(updated, [first], 2),
    original: 'hello', result: 'HELLO', start: 2 })
  assert.equal(out.kind, 'highlighted')
  const [range] = highlights.get('chips-del').ranges
  assert.deepEqual([range.start[0].data, range.start[1], range.end[1]], [' HELLO', 1, 6])
  assert.equal(highlights.has('chips'), false)
  assert.equal(core.detectSlice(snapshot(original, [first]), { start: 2, end: 7 }), 'hello')
  assert.equal(core.detectSlice(snapshot(original, [first]), { start: 0, end: 7 }), null)
  core.clear()
  const mismatch = core.show({ root, before: snapshot(original, [first]),
    snapshot: snapshot(updated, [{ ...first, occurrenceId: 999 }], 2), original: 'hello', result: 'HELLO', start: 2 })
  assert.equal(mismatch.kind, 'fallback')
  assert.equal(mismatch.reason, 'draft-mismatch')
  assert.equal(mismatch.count, 0)
  assert.equal(highlights.size, 0)
})

test('chip after replacement moves by output delta without range entering chip', () => {
  const core = make({ name: 'shift-chip' })
  const oldChip = occ(2)
  const movedChip = { ...oldChip, offset: 5 }
  const { root, highlights } = dom('LONG @ref', [movedChip])
  const out = core.show({ root, before: snapshot('X @ref', [oldChip]),
    snapshot: snapshot('LONG @ref', [movedChip], 2), original: 'X', result: 'LONG', start: 0 })
  assert.equal(out.kind, 'highlighted')
  assert.equal(highlights.get('shift-chip-del').ranges[0].end[0].data, 'LONG ')
  assert.equal(highlights.get('shift-chip-del').ranges[0].end[1], 4)
})

test('explicit linebreak BR maps after-LF text safely to a different node', () => {
  const core = make({ name: 'linebreak' })
  const { root, highlights } = dom('aY\nb')
  // 区分宿主布局占位节点和实际的 Lexical 换行节点。
  const para = root.childNodes[0]
  const first = { nodeType: 3, data: 'aY' }
  const second = { nodeType: 3, data: 'b' }
  const br = { nodeType: 1, tagName: 'BR', getAttribute: () => null, childNodes: [] }
  para.childNodes = [first, br, second]
  root.childNodes = [para]
  const out = core.show({ root, before: snapshot('a\nb'),
    snapshot: snapshot('aY\nb', [], 2), original: 'a\nb', result: 'aY\nb', start: 0 })
  assert.equal(out.kind, 'highlighted')
  assert.deepEqual(highlights.get('linebreak').ranges.map(r => [r.start[0].data, r.start[1], r.end[1]]), [['aY', 1, 2]])
})

test('re-generation compares old original with new result while replacing previous result', () => {
  const core = make({ name: 'regen' })
  const { root, highlights } = dom('Q R')
  const before = snapshot('Q', [], 9)
  const after = snapshot('Q R', [], 10)
  const out = core.show({ root, before, snapshot: after, original: 'q', replaced: 'Q', result: 'Q R', start: 0 })
  assert.equal(out.kind, 'highlighted')
  assert.deepEqual(highlights.get('regen-del').ranges.map(r => [r.start[1], r.end[1]]), [[0, 3]])
  assert.equal(highlights.has('regen'), false)
})

test('pure deletion has no renderable result span', () => {
  const core = make({ name: 'pure-delete' })
  const { root, highlights } = dom('ac')
  const out = core.show({ root, before: snapshot('abc'), snapshot: snapshot('ac', [], 2),
    original: 'abc', result: 'ac', start: 0 })
  assert.equal(out.kind, 'fallback')
  assert.equal(out.reason, 'nontext-only')
  assert.equal(highlights.size, 0)
  assert.equal(root.childNodes[0].childNodes[0].childNodes[0].data, 'ac')
})

for (const currentMode of [false, true]) {
  test(`replacement uses blue styling without deletion decoration (${currentMode ? 'current' : 'write'})`, () => {
    const core = make({ name: 'blue-style' })
    const { root, doc, highlights } = dom('AXB')
    const shown = core.show({ root, before: snapshot('A🙂B'), snapshot: snapshot('AXB', [], 2),
      original: 'A🙂B', result: 'AXB', start: 0, currentMode })
    assert.equal(shown.replaced, 1)
    assert.deepEqual(highlights.get('blue-style-del').ranges.map(r => [r.start[1], r.end[1]]), [[1, 2]])
    const css = doc.styles.map(style => style.textContent).join('\n')
    assert.match(css, /background-color: rgba\(59, 130, 246, 0\.16\)/)
    assert.match(css, /text-decoration: underline dashed #3B82F6/)
    assert.match(css, /color: inherit/)
    assert.doesNotMatch(css, /224, 82, 74|E0524A|line-through|\bred\b/i)
    assert.equal(root.childNodes[0].childNodes[0].childNodes[0].data, 'AXB')
  })
}

test('replacement marks only actual result text blue', () => {
  const core = make({ name: 'replace-red' })
  const { root, highlights } = dom('AXB')
  const shown = core.show({ root, before: snapshot('A🙂B'), snapshot: snapshot('AXB', [], 2),
    original: 'A🙂B', result: 'AXB', start: 0 })
  assert.equal(shown.kind, 'highlighted')
  assert.equal(shown.count, 0)
  assert.equal(shown.replaced, 1)
  assert.equal(shown.removed, 1)
  assert.deepEqual(highlights.get('replace-red-del').ranges.map(r => [r.start[1], r.end[1]]), [[1, 2]])
  assert.equal(highlights.has('replace-red'), false)
  assert.equal(root.childNodes[0].childNodes[0].childNodes[0].data, 'AXB')
  core.clear()
  assert.equal(highlights.size, 0)
})

test('a few deleted characters inside a large rewrite stay green, not red', () => {
  const core = make({ name: 'rewrite-green' })
  // 明显扩写使用新增高亮，不应标成就地换词。
  const long = 'y'.repeat(30)
  const { root, highlights } = dom(`a${long}b`)
  const out = core.show({ root, before: snapshot('axb'), snapshot: snapshot(`a${long}b`, [], 2),
    original: 'axb', result: `a${long}b`, start: 0 })
  assert.equal(out.kind, 'highlighted')
  assert.equal(out.replaced, 0)
  assert.equal(out.removed, 1)
  assert.equal(highlights.has('rewrite-green-del'), false)
  assert.equal(highlights.has('rewrite-green'), true)
})

test('browser highlighting leaves the retained sentence unpainted in an expanded prompt', () => {
  const core = make({ name: 'retained-expansion' })
  const { root, highlights } = dom(expansion.result)
  const shown = core.show({ root, before: snapshot(expansion.original), snapshot: snapshot(expansion.result, [], 2),
    original: expansion.original, result: expansion.result, start: 0 })
  assert.equal(shown.kind, 'highlighted')
  const wordLayers = [...highlights.entries()]
  assert.ok(wordLayers.length > 0)
  for (const [, layer] of wordLayers) {
    for (const range of layer.ranges) assert.ok(range.start[1] >= expansion.preserved.length,
      'the retained first sentence must not be marked as changed')
  }
})

test('green insertions and red replacements stay in separate non-overlapping layers', () => {
  const core = make({ name: 'mixed-colors' })
  const { root, highlights } = dom('aXc q')
  const out = core.show({ root, before: snapshot('abc '), snapshot: snapshot('aXc q', [], 2),
    original: 'abc ', result: 'aXc q', start: 0 })
  assert.equal(out.kind, 'highlighted')
  assert.equal(out.count, 1)
  assert.equal(out.replaced, 1)
  assert.deepEqual(highlights.get('mixed-colors-del').ranges.map(r => [r.start[1], r.end[1]]), [[1, 2]])
  assert.deepEqual(highlights.get('mixed-colors').ranges.map(r => [r.start[1], r.end[1]]), [[4, 5]])
})

test('clear tears down every painted layer, not just the last one', () => {
  const core = make({ name: 'all-layers' })
  // 仅标记首行的替换和新增文字，保留文字及第二行不着色。
  const { root, doc, highlights } = dom('aXc qq\nkeep')
  const out = core.show({ root, before: snapshot('abc \nkeep'), snapshot: snapshot('aXc qq\nkeep', [], 2),
    original: 'abc \nkeep', result: 'aXc qq\nkeep', start: 0 })
  assert.equal(out.kind, 'highlighted')
  assert.equal(out.replaced, 1)
  assert.equal(highlights.size, 2)
  assert.deepEqual([...highlights.keys()].sort(), ['all-layers', 'all-layers-del'])
  assert.equal(doc.styles.length, 2)
  core.clear()
  assert.equal(highlights.size, 0)
  assert.equal(doc.styles.every(style => style.removed), true)
  assert.equal(doc.observer.active, false)
})

test('a successful no-op result does not retain a stale highlight', () => {
  const core = make({ name: 'noop' })
  const { root, highlights } = dom('new')
  assert.equal(core.show({ root, before: snapshot('new', [], 7), snapshot: snapshot('new', [], 7),
    original: 'old', replaced: 'new', result: 'new', start: 0 }).reason, 'already-applied')
  assert.equal(highlights.size, 0)
})

test('unsupported CSS, wrong snapshot, or DOM mismatch falls back without stale highlight', () => {
  const core = make({ name: 'fallback' })
  let setup = dom('new')
  let args = { root: setup.root, before: snapshot('old'), snapshot: snapshot('new', [], 2), original: 'old', result: 'new', start: 0 }
  assert.equal(core.show(args).kind, 'highlighted')
  assert.equal(setup.highlights.size, 1)
  assert.equal(core.show({ ...args, snapshot: snapshot('other', [], 2) }).reason, 'draft-mismatch')
  assert.equal(setup.highlights.size, 0)
  setup = dom('new', [], { unsupported: true })
  assert.equal(core.show({ ...args, root: setup.root }).reason, 'unsupported')
  setup = dom('not-new')
  assert.equal(core.show({ ...args, root: setup.root }).reason, 'dom-mismatch')
  assert.equal(setup.highlights.size, 0)
})

test('check removes stale ranges on rev change and repeated clear is harmless', () => {
  const core = make({ name: 'cleanup' })
  const { root, doc, highlights } = dom('new')
  core.show({ root, before: snapshot('old'), snapshot: snapshot('new', [], 2), original: 'old', result: 'new', start: 0 })
  assert.equal(core.check({ root, snapshot: snapshot('new', [], 3) }).reason, 'draft-changed')
  assert.equal(highlights.size, 0)
  assert.equal(doc.observer.active, false)
  core.clear(); core.clear()
  assert.equal(core.status.kind, 'none')
})

test('check parses matching snapshot layout once and preserves stale revision cleanup', () => {
  const core = make({ name: 'layout-check' })
  const { root, highlights } = dom('new')
  const current = snapshot('new', [], 2)
  const show = () => core.show({ root, before: snapshot('old'), snapshot: current, original: 'old', result: 'new', start: 0 })
  show()
  let reads = 0
  const checked = { ...current, get occurrences() { reads++; return [] } }
  assert.equal(core.check({ root, snapshot: checked }).kind, 'highlighted')
  assert.equal(reads, 2) // Array validation and iteration belong to one layout parse.
  assert.equal(highlights.size, 1)
  assert.equal(core.check({ root, snapshot: { ...current, draftRev: 3 } }).reason, 'draft-changed')
  assert.equal(highlights.size, 0)
})

test('coalesceRanges never covers positive gaps, including letters, punctuation, whitespace and emoji', () => {
  for (const gap of ['a', 'ab', ';;;', ' ', '\t', '\n', '🙂🙂']) {
    const text = `X${gap}Y`
    const ranges = [{ start: 0, end: 1 }, { start: text.length - 1, end: text.length }]
    for (const core of [make(), make({ mergeGap: 100 })]) {
      assert.deepEqual(native(core.coalesceRanges(ranges, text)), ranges, `default gap: ${JSON.stringify(gap)}`)
      assert.deepEqual(native(core.coalesceRanges(ranges, text, 100)), ranges, `explicit gap: ${JSON.stringify(gap)}`)
    }
    assert.deepEqual(ranges, [{ start: 0, end: 1 }, { start: text.length - 1, end: text.length }])
  }
  const core = make()
  const text = 'alpha：beta；gamma delta'
  assert.deepEqual(native(core.coalesceRanges([{ start: 0, end: 5 }, { start: 6, end: 10 }, { start: 11, end: 16 }], text)),
    [{ start: 0, end: 5 }, { start: 6, end: 10 }, { start: 11, end: 16 }])
  assert.deepEqual(native(core.coalesceRanges([{ start: 0, end: 5 }, { start: 6, end: 7 }], text)),
    [{ start: 0, end: 5 }, { start: 6, end: 7 }])
})

test('coalesceRanges merges touching and overlapping intervals without mutating input', () => {
  const core = make()
  for (const ranges of [
    [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }],
    [{ start: 0, end: 3 }, { start: 2, end: 5 }, { start: 4, end: 6 }],
    [{ start: 0, end: 6 }, { start: 1, end: 2 }]
  ]) {
    const before = structuredClone(ranges)
    assert.deepEqual(native(core.coalesceRanges(ranges, 'abcdef', -1)), [{ start: 0, end: 6 }])
    assert.deepEqual(ranges, before)
  }
})

test('coalesceRanges retains whitespace edge trimming and empty-range filtering', () => {
  const core = make()
  assert.deepEqual(native(core.coalesceRanges([{ start: 0, end: 7 }], ' \tfoo\n ')), [{ start: 2, end: 5 }])
  assert.deepEqual(native(core.coalesceRanges([{ start: 0, end: 3 }], ' \t\n')), [])
  assert.deepEqual(native(core.coalesceRanges([{ start: 1, end: 1 }], 'abc')), [])
  assert.deepEqual(native(core.coalesceRanges([], 'abc')), [])
  // 段落分隔符不应进入高亮范围。
  assert.deepEqual(native(core.coalesceRanges([{ start: 3, end: 8 }], 'abc\ndefg')), [{ start: 4, end: 8 }])
})

test('multiline results highlight inserted words without washing changed lines', () => {
  const core = make({ name: 'words-only' })
  const original = 'one\ntwo\nthree\nfour'
  const result = 'one X\ntwo\nthree Y\nfour'
  const { root, doc, highlights } = dom(result)
  const shown = core.show({ root, before: snapshot(original), snapshot: snapshot(result, [], 2), original, result, start: 0 })
  assert.equal(shown.kind, 'highlighted')
  assert.deepEqual([...highlights.keys()], ['words-only'])
  assert.deepEqual(highlights.get('words-only').ranges.map(range => [range.start[0].data, range.start[1], range.end[1]]),
    [['one X', 4, 5], ['three Y', 6, 7]])
  assert.equal(doc.styles.length, 1)
})

test('a full-draft rewrite highlights only the replacement text', () => {
  const core = make({ name: 'wash' })
  const { root, highlights } = dom('HELLO')
  const out = core.show({ root, before: snapshot('hello'), snapshot: snapshot('HELLO', [], 2),
    original: 'hello', result: 'HELLO', start: 0 })
  assert.equal(out.kind, 'highlighted')
  assert.equal(out.count, 0)
  assert.equal(out.replaced, 1)
  assert.equal(highlights.has('wash'), false)
  assert.equal(highlights.has('wash-del'), true)
})

test('punctuation-only changes are dropped unless nothing else changed', () => {
  const core = make({ name: 'punct' })
  // 若唯一改动是标点，仍需保留该标记。
  const only = dom('a；b')
  const out = core.show({ root: only.root, before: snapshot('a、b'), snapshot: snapshot('a；b', [], 2),
    original: 'a、b', result: 'a；b', start: 0 })
  assert.equal(out.kind, 'highlighted')
  assert.equal(out.count, 0)
  assert.equal(out.replaced, 1)
  assert.deepEqual(only.highlights.get('punct-del').ranges.map(r => [r.start[1], r.end[1]]), [[1, 2]])
  const mixed = dom('a；B')
  const mixedOut = core.show({ root: mixed.root, before: snapshot('a、b'), snapshot: snapshot('a；B', [], 2),
    original: 'a、b', result: 'a；B', start: 0 })
  assert.equal(mixedOut.kind, 'highlighted')
  assert.equal(mixedOut.replaced, 1)
  assert.deepEqual(mixed.highlights.get('punct-del').ranges.map(r => [r.start[1], r.end[1]]), [[1, 3]])
})

test('hunks classify pure insertions, pure deletions and substitutions', () => {
  const core = make()
  const hunks = native(core.diffHunks('a b c', 'a XY c')).hunks
  assert.equal(hunks.length, 1)
  assert.deepEqual(hunks[0].add, { start: 2, end: 4 })
  assert.deepEqual(hunks[0].rem, { start: 2, end: 3 })
  assert.equal(hunks[0].resultAnchor, 2)
  const onlyAdd = native(core.diffHunks('ab', 'a b')).hunks
  assert.equal(onlyAdd.length, 1)
  assert.deepEqual(onlyAdd[0].add, { start: 1, end: 2 })
  assert.equal(onlyAdd[0].rem, null)
  // 分离的删除和新增必须保持各自范围。
  const both = native(core.diffHunks('abc', 'acx')).hunks
  assert.equal(both.length, 2)
  assert.equal(both[0].add, null)
  assert.deepEqual(both[0].rem, { start: 1, end: 2 })
  assert.equal(both[0].resultAnchor, 1)
  assert.deepEqual(both[1].add, { start: 2, end: 3 })
  assert.equal(both[1].rem, null)
})

test('diff segments preserve deletion text, UTF-16 anchors, and insertion order', () => {
  const core = make()
  assert.deepEqual(native(core.diffSegments('A🙂B', 'AXB')), [
    { type: 'equal', text: 'A' }, { type: 'delete', text: '🙂' },
    { type: 'insert', text: 'X' }, { type: 'equal', text: 'B' }
  ])
  assert.deepEqual(native(core.diffHunks('ab🙂', 'ab')).hunks, [
    { add: null, rem: { start: 2, end: 4 }, resultAnchor: 2 }
  ])
  assert.deepEqual(native(core.diffHunks('ab', 'a🙂b')).hunks, [
    { add: { start: 1, end: 3 }, rem: null }
  ])
  assert.deepEqual(native(core.diffSegments('same', 'same')), [{ type: 'equal', text: 'same' }])
})

test('highlight styles retain the green palette and underline without a line background', () => {
  const core = make({ name: 'palette' })
  const { root, doc, highlights } = dom('abc X\ndef')
  core.show({ root, before: snapshot('abc\ndef'), snapshot: snapshot('abc X\ndef', [], 2),
    original: 'abc\ndef', result: 'abc X\ndef', start: 0 })
  const styles = doc.styles.map(style => style.textContent)
  assert.equal(styles.length, 1)
  const word = styles.find(css => css.includes('::highlight(palette) {'))
  assert.match(word, /rgba\(61, 214, 140, 0\.16\)/)
  assert.match(word, /underline dashed #3DD68C/)
  assert.equal(highlights.size, 1)
  core.clear()
  assert.equal(highlights.size, 0)
  assert.equal(doc.styles.every(style => style.removed), true)
})

test('current-model rendering needs no write snapshot and still validates DOM and scope', () => {
  const core = make({ name: 'current', managed: true })
  const { root, doc, highlights } = dom('a EDIT b')
  assert.equal(core.show({ root, snapshot: snapshot('a EDIT b', [], 9),
    original: 'a b', result: 'a EDIT b', start: 0, currentMode: true }).kind, 'highlighted')
  assert.equal(highlights.size, 1)
  assert.equal(doc.observer, undefined, 'session controller owns observation')
  assert.equal(core.show({ root, snapshot: snapshot('a EDIT b', [], 9),
    original: 'a b', result: 'wrong', start: 0, currentMode: true }).reason, 'draft-mismatch')
  assert.equal(highlights.size, 0)
  root.childNodes[0].childNodes[0].childNodes[0].data = 'stale DOM'
  assert.equal(core.show({ root, snapshot: snapshot('a EDIT b', [], 9),
    original: 'a b', result: 'a EDIT b', start: 0, currentMode: true }).reason, 'dom-mismatch')
})

test('current-model scope must not cover reference chips', () => {
  const core = make({ managed: true })
  const chip = occ(0)
  const { root, highlights } = dom('@ref hi', [chip])
  assert.equal(core.show({ root, snapshot: snapshot('@ref hi', [chip]),
    original: 'hi', result: '@ref hi', start: 0, currentMode: true }).reason, 'draft-mismatch')
  assert.equal(highlights.size, 0)
  assert.equal(core.show({ root, snapshot: snapshot('@ref hi', [chip]),
    original: 'hello', result: 'hi', start: 2, currentMode: true }).kind, 'highlighted')
})

test('unrelated multiline substitution keeps red despite introduced lists later', () => {
  const original = '甲乙\n丙丁。保留。执行。'
  const result = '戊己庚辛。保留。\n- **一**：执行。\n- **二**：补充。'
  const setup = dom(result)
  const core = make({ name: 'intro-red' })
  assert.equal(core.show({ root: setup.root, snapshot: snapshot(result), original, result, start: 0, currentMode: true }).kind, 'highlighted')
  assert.ok(fixtureLayerRanges(setup, 'intro-red-del').some(([start, end]) => start === 0 && end === 4))
})

test('existing labelled list heading substitutions still use red replacement coloring', () => {
  const original = '- **涉及范围**：修改文件。\n- **测试**：执行测试。'
  const result = '- **修改范围**：修改文件。\n- **测试**：执行测试。'
  const core = make({ name: 'existing-list' })
  const setup = dom(result)
  assert.equal(core.show({ root: setup.root, snapshot: snapshot(result), original, result, start: 0, currentMode: true }).kind, 'highlighted')
  assert.deepEqual(fixtureLayerRanges(setup, 'existing-list-del'), [[4, 6]])
  assert.deepEqual(fixtureLayerRanges(setup, 'existing-list'), [])
})

function fixtureLayerRanges(setup, key) {
  const offsets = new Map()
  let at = 0
  for (const paragraph of setup.para) {
    const visit = node => {
      if (node.nodeType === 3) { offsets.set(node, at); at += node.data.length }
      else for (const child of node.childNodes) visit(child)
    }
    visit(paragraph)
    at++
  }
  return (setup.highlights.get(key)?.ranges ?? []).map(range => [
    offsets.get(range.start[0]) + range.start[1], offsets.get(range.end[0]) + range.end[1]
  ])
}

test('coverage is measured against the whole draft, not the replaced text', () => {
  const core = make({ name: 'coverage' })
  // 选区完全改写仍可能是局部修改；高亮比例以整个草稿为分母。
  const { root } = dom('AAA BETTER CCC')
  const out = core.show({ root, before: snapshot('AAA BBB CCC'), snapshot: snapshot('AAA BETTER CCC', [], 2),
    original: 'BBB', replaced: 'BBB', result: 'BETTER', start: 4 })
  assert.equal(out.kind, 'highlighted')
  assert.equal(Math.round(out.coverage * 100), 43)
})
