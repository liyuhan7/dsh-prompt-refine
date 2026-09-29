import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * 按宿主加载方式在隔离环境中执行分发模块，测试其公开行为。
 */
function loadClient() {
  const source = readFileSync(new URL('../lib/client.bundle.js', import.meta.url), 'utf8')
  let exports
  const sandbox = {
    window: { __ModuleLoader__: { load: ({ factory }) => { exports = factory((id) => (id === 'react' ? { createElement: () => null, Fragment: null, memo: (c) => c, useSyncExternalStore: () => undefined, useRef: () => ({}), useCallback: (f) => f, useEffect: () => {}, useState: (v) => [v, () => {}] } : {})) } } },
    console, setTimeout, clearTimeout, fetch: () => Promise.reject(new Error('no network in tests')), TextDecoder, AbortController, Error, JSON, Number, Map, Set, RegExp, URL
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  return exports
}
const client = loadClient()
/** 模拟输入快照和公开编辑操作。 */
function input(overrides) {
  const calls = []
  const state = { draft: 'AAA BBB CCC', draftRev: 7, phase: 'plain', occurrences: [], ...overrides }
  const actions = {
    captureInsertion: () => ({ start: 4, end: 7, draftRev: state.draftRev, ...(overrides.span ?? {}) }),
    insertText: (text, span) => { calls.push(['insertText', text, span]); return overrides.insertApplies ?? true },
    setDraft: (text) => calls.push(['setDraft', text])
  }
  return { state, actions, calls }
}
const capture = client.capture

test('selection next to a reference chip is read in clipboard coordinates', () => {
  const { state, actions } = input({ draft: '@admin-done.txt AAA BBB CCC', phase: 'claimed', occurrences: [{ offset: 0, length: 15, label: 'admin-done.txt', clipboardText: '@admin-done.txt' }], span: { start: 6, end: 9 } })
  const source = capture(state, actions)
  assert.equal(source.original, 'BBB')
  assert.deepEqual(source.span, { start: 6, end: 9, draftRev: 7 })
  assert.equal(source.mode, 'selection')
})
test('a selection touching a reference chip is refused', () => {
  const { state, actions } = input({ draft: '@admin-done.txt AAA BBB', occurrences: [{ offset: 0, length: 15 }], span: { start: 0, end: 13 } })
  assert.throws(() => capture(state, actions), /引用/)
})
test('whole draft is only accepted without chips or a claimed command', () => {
  const clean = input({ span: { start: 0, end: 0 } })
  assert.equal(capture(clean.state, clean.actions).mode, 'whole')
  const chip = input({ draft: '@a.txt hi', occurrences: [{ offset: 0, length: 7 }], span: { start: 0, end: 0 } })
  assert.throws(() => capture(chip.state, chip.actions), /引用或命令/)
  const command = input({ draft: '/plan do it', phase: 'claimed', span: { start: 0, end: 0 } })
  assert.throws(() => capture(command.state, command.actions), /引用或命令/)
})
test('typed /refine takes the body as the span and keeps the command prefix', () => {
  const { state, actions } = input({ draft: '/refine make it sharper', span: { start: 0, end: 0 } })
  const source = capture(state, actions, true)
  assert.equal(source.original, 'make it sharper')
  assert.equal(source.span.start, 8)
  assert.equal(source.span.end, 23)
  assert.equal(source.span.draftRev, 7)
  assert.throws(() => capture(input({ draft: '/refine ', span: { start: 0, end: 0 } }).state, actions, true), /正文/)
})
test('a draft with nothing to refine reports that instead of calling a model', () => {
  // 覆盖纯空白、尚未消费的命令 token，以及消费后清空的草稿。
  for (const draft of ['   ', '/refine', '']) {
    const { state, actions } = input({ draft, span: { start: 0, end: 0 } })
    assert.throws(() => capture(state, actions), /没有可优化的文字/)
  }
})
test('chip geometry round-trips detect and clipboard coordinates', () => {
  const ranges = client.chipRanges([{ offset: 0, length: 15 }, { offset: 20, length: 5 }])
  assert.deepEqual(ranges.map(r => [r.start, r.end]), [[0, 1], [6, 7]])
  assert.equal(client.clipboardAt(0, ranges), 0)
  assert.equal(client.clipboardAt(1, ranges), 15)
  assert.equal(client.clipboardAt(7, ranges), 25)
  assert.equal(client.clipboardAt(6, ranges), 20)
})

/** 模拟会话输入接口，提供可更新快照和纯文本插入操作。 */
function fakeShell(initial) {
  const snap = { draft: 'AAA BBB CCC', draftRev: 7, phase: 'plain', ...initial }
  const calls = []
  return {
    snap,
    calls,
    state: { getSnapshot: () => snap },
    actions: {
      insertText: (text, span) => {
        calls.push([text, { ...span }])
        const nextDraft = snap.draft.slice(0, span.start) + text + snap.draft.slice(span.end)
        snap.draftRev += Number(nextDraft !== snap.draft)
        snap.draft = nextDraft
        return true
      }
    }
  }
}
const txOf = (shell, source) => client.draftTransaction(shell, source)

test('streaming writes land in the owned range and undo restores the original', () => {
  const shell = fakeShell()
  const source = { original: 'BBB', span: { start: 4, end: 7, draftRev: 7 }, mode: 'selection', draft: 'AAA BBB CCC', draftRev: 7 }
  const tx = txOf(shell, source)
  tx.write('X')
  assert.equal(shell.snap.draft, 'AAA X CCC')
  tx.write('XY')
  assert.equal(shell.snap.draft, 'AAA XY CCC')
  // 每次回填只替换上次结果范围，范围外文字保持原样。
  assert.deepEqual(shell.calls.map(([t, s]) => [t, s.start, s.end]), [['X', 4, 7], ['XY', 4, 5]])
  tx.undo()
  assert.equal(shell.snap.draft, 'AAA BBB CCC')
})

test('the transaction refuses to write after a manual edit or a phase change', () => {
  for (const change of [
    shell => { shell.snap.draft = 'AAA X CCC 手动'; shell.snap.draftRev += 1 },
    shell => { shell.snap.phase = 'submitting' }
  ]) {
    const shell = fakeShell()
    const tx = txOf(shell, { original: 'BBB', span: { start: 4, end: 7, draftRev: 7 }, mode: 'selection', draft: 'AAA BBB CCC', draftRev: 7 })
    tx.write('X')
    change(shell)
    const stopped = shell.snap.draft
    assert.throws(() => tx.write('XY'), /已停止写入/)
    // 撤销与回填采用同样的草稿保护。
    assert.throws(() => tx.undo(), /已停止写入/)
    assert.equal(shell.snap.draft, stopped)
  }
})

test('result text containing a reference placeholder is refused', () => {
  const shell = fakeShell()
  const source = { original: 'BBB', span: { start: 4, end: 7, draftRev: 7 }, mode: 'selection', draft: 'AAA BBB CCC', draftRev: 7 }
  const tx = txOf(shell, source)
  assert.throws(() => tx.write('a\uFFFCb'), /引用占位符/)
  assert.equal(shell.snap.draft, 'AAA BBB CCC')
})

test('a stale source (draft changed before the panel opened) refuses to start', () => {
  const shell = fakeShell({ draft: 'AAA ZZZ CCC', draftRev: 8 })
  const source = { original: 'BBB', span: { start: 4, end: 7, draftRev: 7 }, mode: 'selection', draft: 'AAA BBB CCC', draftRev: 7 }
  assert.throws(() => txOf(shell, source), /重新开始优化/)
})

/** 模拟宿主对保留占位符的过滤行为。 */
function chipShell(overrides = {}) {
  const snap = {
    draft: '@a.txt AAA BBB @b.txt CCC', draftRev: 7, phase: 'plain',
    attachmentIds: ['attachment-1'], occurrences: [
      { offset: 0, length: 6, occurrenceId: 1, clipboardText: '@a.txt', label: 'a.txt' },
      { offset: 15, length: 6, occurrenceId: 2, clipboardText: '@b.txt', label: 'b.txt' }
    ], ...overrides
  }
  const calls = []
  return {
    snap, calls, state: { getSnapshot: () => snap },
    actions: {
      insertText: (text, span) => {
        calls.push([text, { ...span }])
        if (span.draftRev !== snap.draftRev) return false
        const chips = client.chipRanges(snap.occurrences)
        const start = client.clipboardAt(span.start, chips)
        const end = client.clipboardAt(span.end, chips)
        const clean = text.replace(/[\uE100-\uE11D\uFFFC]/gu, '')
        const before = snap.draft
        snap.draft = before.slice(0, start) + clean + before.slice(end)
        const shift = clean.length - (end - start)
        snap.occurrences = snap.occurrences.map(chip => ({ ...chip, offset: chip.offset >= end ? chip.offset + shift : chip.offset }))
        if (snap.draft !== before) snap.draftRev++
        return true
      }
    }
  }
}
const chipSource = () => ({ original: 'BBB', span: { start: 6, end: 9, draftRev: 7 }, mode: 'selection', draft: '@a.txt AAA BBB @b.txt CCC', draftRev: 7 })

test('only the selected text changes and adjacent chips retain identity across write and undo', () => {
  const shell = chipShell()
  const before = structuredClone(shell.snap.occurrences)
  const tx = txOf(shell, chipSource())
  tx.write('XY')
  assert.equal(shell.snap.draft, '@a.txt AAA XY @b.txt CCC')
  assert.deepEqual(shell.snap.occurrences, [before[0], { ...before[1], offset: 14 }])
  assert.deepEqual([tx.range().start, tx.range().end], [6, 8])
  tx.undo()
  assert.equal(shell.snap.draft, chipSource().draft)
  assert.deepEqual(shell.snap.occurrences, before)
  assert.deepEqual(shell.calls.map(([text, span]) => [text, span.start, span.end, span.draftRev]), [
    ['XY', 6, 9, 7], ['BBB', 6, 8, 8]
  ])
})

test('all host-stripped placeholder characters are rejected before any editor action', () => {
  for (const reserved of ['\uE100', '\uE10A', '\uE11D', '\uFFFC']) {
    const shell = chipShell()
    const tx = txOf(shell, chipSource())
    assert.throws(() => tx.write(`foo${reserved}bar`), /引用占位符/)
    assert.equal(shell.calls.length, 0)
    assert.equal(shell.snap.draft, chipSource().draft)
  }
})

test('a sanitizing or unexpectedly destructive editor response breaks the transaction', () => {
  const shell = chipShell()
  const insert = shell.actions.insertText
  shell.actions.insertText = (text, span) => insert(text.replace('Y', '\uE100'), span)
  const tx = txOf(shell, chipSource())
  assert.throws(() => tx.write('XY'), /回填结果与预期不符/)
  assert.equal(shell.snap.draft, '@a.txt AAA X @b.txt CCC')
  assert.equal(tx.broken(), true)
  assert.throws(() => tx.undo(), /已停止写入/)
  assert.equal(shell.calls.length, 1)
})

test('chip metadata, whole draft, revision and phase are checked before each new write', () => {
  for (const change of [
    s => { s.occurrences[0] = { ...s.occurrences[0], label: 'different' } },
    s => { s.draft = `${s.draft}!` },
    s => { s.draftRev++ },
    s => { s.phase = 'submitting' },
    s => { s.attachmentIds.push('new-attachment') }
  ]) {
    const shell = chipShell()
    const tx = txOf(shell, chipSource())
    tx.write('XY')
    change(shell.snap)
    assert.throws(() => tx.write('Z'), /已停止写入/)
    assert.throws(() => tx.undo(), /已停止写入/)
    assert.equal(shell.calls.length, 1)
  }
})

test('a stale or chip-crossing selection cannot form a write transaction', () => {
  assert.throws(() => txOf(chipShell(), { ...chipSource(), original: 'AAA' }), /选区已变化/)
  assert.throws(() => txOf(chipShell(), { ...chipSource(), span: { start: 6, end: 11 } }), /选区已变化/)
})

test('overlay reserves measured space on its own card and restores it on unmount', () => {
  // 卸载时应原样恢复卡片原有的行内样式。
  const styleValues = new Map([['--dsh-prompt-refine-base-padding', '1px']])
  const style = {
    getPropertyValue: key => styleValues.get(key) ?? '',
    getPropertyPriority: () => '',
    setProperty: (key, value) => styleValues.set(key, value),
    removeProperty: key => styleValues.delete(key)
  }
  let height = 79.2
  let topLeftRadius = '24px'
  let topRightRadius = '20px 28px'
  const overlayStyleValues = new Map()
  let observer
  const layoutEffects = []
  const card = {
    style, attributes: new Map(),
    getAttribute(key) { return this.attributes.get(key) ?? null },
    setAttribute(key, value) { this.attributes.set(key, value) },
    removeAttribute(key) { this.attributes.delete(key) }
  }
  const element = {
    style: { setProperty: (key, value) => overlayStyleValues.set(key, value) },
    closest: key => key === '[data-composer-card]' ? card : null,
    getBoundingClientRect: () => ({ height }),
    ownerDocument: { defaultView: {
      getComputedStyle: () => ({ paddingTop: '8px', borderTopLeftRadius: topLeftRadius, borderTopRightRadius: topRightRadius }),
      ResizeObserver: class {
        constructor(callback) { this.callback = callback; observer = this }
        observe(target) { this.target = target }
        disconnect() { this.disconnected = true }
      }
    } }
  }
  const React = {
    createElement: (type, props, ...children) => {
      if (type === 'section') props.ref.current = element
      return { type, props, children }
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useRef: () => ({ current: null }),
    useLayoutEffect: fn => { layoutEffects.push(fn) }
  }
  let ui
  const sandbox = {
    window: { __ModuleLoader__: { load: ({ factory }) => { ui = factory(id => id === 'react' ? React : {}) } } },
    console, setTimeout, clearTimeout, fetch: () => Promise.reject(Error('no network in tests')),
    TextDecoder, AbortController, Error, JSON, Number, Map, Set, RegExp, URL
  }
  vm.createContext(sandbox)
  vm.runInContext(readFileSync(new URL('../lib/client.bundle.js', import.meta.url), 'utf8'), sandbox, { filename: 'client.js' })
  const registered = new Map()
  const shell = {
    state: { getSnapshot: () => ({ draft: 'hello', draftRev: 1, phase: 'plain', occurrences: [] }) },
    actions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }) },
    notify: () => { throw Error('unexpected notification') }
  }
  const ctx = {
    slots: {
      register: (options, component) => { registered.set(options.name, { options, component }) },
      inject: (_name, register) => register()
    },
    effect: () => {},
    sessions: { scope: () => ({ get: () => ({ input: { for: () => shell } }) }) }
  }
  ui.apply(ctx)
  assert.equal(registered.has('conversation.input.dock'), false)
  const entry = registered.get('conversation.input.overlay')
  assert.equal(entry.options.inject('session-A').sessionId, 'session-A')
  registered.get('conversation.input.right').component({ sessionId: 'session-A', refineContext: ctx }).props.onClick()
  const panel = entry.component({ sessionId: 'session-A' })
  assert.equal(panel.props.style.position, 'absolute')
  assert.equal(panel.props.style.top, 0)
  // 浮层通过局部变量使用所属卡片的圆角。
  assert.equal(panel.props.style.borderTopLeftRadius, 'var(--dsh-prompt-refine-top-left-radius, 0px)')
  assert.equal(panel.props.style.borderTopRightRadius, 'var(--dsh-prompt-refine-top-right-radius, 0px)')
  assert.match(panel.children[0].children[0], /\[data-composer-card\].*padding-top/)
  const cleanup = layoutEffects[0]()
  const unmount = layoutEffects[1]()
  assert.equal(card.attributes.has('data-dsh-prompt-refine-reserve'), true)
  assert.equal(styleValues.get('--dsh-prompt-refine-base-padding'), '8px')
  assert.equal(styleValues.get('--dsh-prompt-refine-panel-height'), '88px')
  assert.equal(overlayStyleValues.get('--dsh-prompt-refine-top-right-radius'), '20px 28px')
  height = 108.4
  topLeftRadius = '32px'
  topRightRadius = '36px'
  observer.callback()
  assert.equal(styleValues.get('--dsh-prompt-refine-panel-height'), '117px')
  assert.equal(overlayStyleValues.get('--dsh-prompt-refine-top-left-radius'), '32px')
  assert.equal(overlayStyleValues.get('--dsh-prompt-refine-top-right-radius'), '36px')
  cleanup()
  assert.equal(observer.disconnected, true)
  assert.equal(card.attributes.has('data-dsh-prompt-refine-reserve'), false)
  assert.equal(styleValues.get('--dsh-prompt-refine-base-padding'), '1px')
  assert.equal(styleValues.has('--dsh-prompt-refine-panel-height'), false)
  observer.callback()
  assert.equal(styleValues.has('--dsh-prompt-refine-panel-height'), false)
  unmount()
})

function deferredSse() {
  const items = []
  let waiting
  const push = (text, done = false) => {
    const item = { done, value: new TextEncoder().encode(text) }
    if (waiting) { const resolve = waiting; waiting = undefined; resolve(item) }
    else items.push(item)
  }
  return {
    body: { getReader: () => ({ read: () => items.length ? Promise.resolve(items.shift()) : new Promise(resolve => { waiting = resolve }) }) },
    event: (name, data) => push(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`),
    end: () => push('', true)
  }
}

/** 通过公开按钮启动，渲染真实注册的操作浮层。 */
function sseHarness({ withEditor = false, autostart = true } = {}) {
  const streams = []
  const shell = fakeShell({ occurrences: [], attachmentIds: [] })
  const listeners = new Set()
  shell.state.subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
  const publish = () => { for (const fn of [...listeners]) fn() }
  const sessionListeners = new Set()
  let sessionSnapshot = { pendingSubmissions: [] }
  const session = {
    getSnapshot: () => sessionSnapshot,
    subscribe: fn => { sessionListeners.add(fn); return () => sessionListeners.delete(fn) }
  }
  const publishSession = (patch, { notify = true } = {}) => {
    sessionSnapshot = { ...sessionSnapshot, ...patch }
    if (notify) for (const fn of [...sessionListeners]) fn()
  }
  let dom
  if (withEditor) {
    // 宿主快照不可变，DOM 和事务测试应读取独立的时点副本。
    shell.state.getSnapshot = () => JSON.parse(JSON.stringify(shell.snap))
    const text = { nodeType: 3, data: shell.snap.draft }
    const span = { nodeType: 1, tagName: 'SPAN', childNodes: [text], getAttribute: () => null }
    const paragraph = { nodeType: 1, tagName: 'P', childNodes: [span] }
    const highlights = new Map()
    const doc = {
      styles: [],
      createRange: () => ({ setStart(node, offset) { this.start = [node, offset] }, setEnd(node, offset) { this.end = [node, offset] } }),
      createElement: () => ({ remove() { this.removed = true }, textContent: '' }),
      head: { appendChild: style => { doc.styles.push(style) } },
      defaultView: { CSS: { highlights }, Highlight: class { constructor(...ranges) { this.ranges = ranges } },
        MutationObserver: class { constructor(callback) { this.callback = callback; doc.observer = this } observe() {} disconnect() {} notify() { this.callback() } } }
    }
    const root = { nodeType: 1, tagName: 'DIV', childNodes: [paragraph], ownerDocument: doc,
      getAttribute: key => key === 'data-composer-input' ? '' : null }
    shell.editor = { getRootElement: () => root }
    const insert = shell.actions.insertText
    shell.actions.insertText = (value, range) => {
      const applied = insert(value, range)
      if (applied) { text.data = shell.snap.draft; publish() }
      return applied
    }
    dom = { root, text, highlights, doc }
  }
  shell.actions.captureInsertion = () => ({ start: 4, end: 7, draftRev: shell.snap.draftRev })
  shell.notify = (_level, message) => { throw Error(`unexpected notification: ${message}`) }
  const layoutEffects = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useRef: () => ({ current: null }),
    useLayoutEffect: fn => { layoutEffects.push(fn) }
  }
  let plugin
  const sandbox = {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(id => id === 'react' ? React : {}) } } },
    console, setTimeout, clearTimeout,
    fetch: (_url, options) => {
      const stream = deferredSse()
      streams.push({ ...stream, options })
      return Promise.resolve({ ok: true, body: stream.body })
    },
    TextDecoder, AbortController, Error, JSON, Number, Map, Set, RegExp, URL
  }
  vm.createContext(sandbox)
  vm.runInContext(readFileSync(new URL('../lib/client.bundle.js', import.meta.url), 'utf8'), sandbox, { filename: 'client.bundle.js' })
  const slots = new Map()
  const effects = []
  const ctx = {
    sessions: {
      scope: () => ({ get: () => ({ input: { for: () => shell } }) }),
      binding: () => ({ session })
    },
    slots: { inject: (_name, register) => register(), register: (config, component) => { slots.set(config.name, { config, component }) } },
    effect: (register, label) => { if (label === 'prompt-refine: cleanup') effects.push(register) }
  }
  plugin.apply(ctx)
  const overlay = () => slots.get('conversation.input.overlay').component({ sessionId: 'session-1' })
  const button = (label) => {
    const descend = (node) => {
      if (!node || typeof node !== 'object') return null
      if (Array.isArray(node)) return node.map(descend).find(Boolean) ?? null
      if (node.type === 'button' && node.children[0] === label) return node
      return descend(node.children)
    }
    return descend(overlay())
  }
  if (autostart) slots.get('conversation.input.right').component({ sessionId: 'session-1', refineContext: ctx }).props.onClick()
  return { shell, streams, overlay, button, publish, dom, listeners, session, sessionListeners, publishSession,
    status: () => overlay().children[1].children[0],
    right: () => slots.get('conversation.input.right').component({ sessionId: 'session-1', refineContext: ctx }),
    mount: () => { layoutEffects.length = 0; overlay(); return layoutEffects.at(-1)?.() },
    dispose: () => { for (const register of effects) { const teardown = register(); teardown?.() } } }
}
const sse = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
const flushSse = () => new Promise(resolve => setImmediate(resolve))
/** 等待浮层的延迟卸载清理执行。 */
const tick = () => new Promise(resolve => setTimeout(resolve, 5))

test('SSE deltas and a failed stream never write partial text to the composer', async () => {
  const h = sseHarness()
  await flushSse()
  assert.equal(h.streams.length, 1)
  h.streams[0].event('delta', { text: 'draft-part' })
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BBB CCC')
  assert.equal(h.shell.calls.length, 0)
  assert.equal(h.button('复制结果'), null)
  h.streams[0].event('failure', { error: 'failed upstream' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BBB CCC')
  assert.equal(h.shell.calls.length, 0)
  assert.equal(h.button('重新生成').type, 'button')
  const alert = h.overlay().children.find(node => node?.props?.role === 'alert')
  assert.deepEqual(alert.children, ['failed upstream'])
  assert.equal(alert.props.className, 'dsh-prompt-refine-error')
  assert.equal(alert.props.style.font, 'inherit')
  assert.equal(alert.props.style.fontSize, 13)
  assert.equal(alert.props.style.fontWeight, h.button('重新生成').props.style.fontWeight)
  assert.equal(alert.props.style.lineHeight, '20px')
})

test('done buffers until normal EOF, then commits exactly once', async () => {
  const h = sseHarness()
  await flushSse()
  h.streams[0].event('delta', { text: 'preliminary' })
  h.streams[0].event('done', { text: 'final text' })
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BBB CCC')
  assert.equal(h.shell.calls.length, 0)
  h.streams[0].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA final text CCC')
  assert.deepEqual(h.shell.calls.map(([text, span]) => [text, span.start, span.end, span.draftRev]), [['final text', 4, 7, 7]])
})

test('failure after done or abort before EOF leaves the draft unchanged', async () => {
  for (const ending of ['failure', 'abort']) {
    const h = sseHarness()
    await flushSse()
    h.streams[0].event('done', { text: 'must not land' })
    await flushSse()
    assert.equal(h.shell.calls.length, 0)
    if (ending === 'failure') h.streams[0].event('failure', { error: 'late failure' })
    else h.button('停止生成').props.onClick()
    h.streams[0].end()
    await flushSse()
    assert.equal(h.shell.snap.draft, 'AAA BBB CCC')
    assert.equal(h.shell.calls.length, 0)
  }
})

test('manual edit during regeneration stops the final CAS but preserves the prior result', async () => {
  const h = sseHarness()
  await flushSse()
  h.streams[0].event('done', { text: 'first result' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA first result CCC')
  h.button('重新生成').props.onClick()
  await flushSse()
  assert.equal(h.streams.length, 2)
  assert.equal(JSON.parse(h.streams[1].options.body).text, 'BBB')
  h.shell.snap.draft += ' 手动'
  h.shell.snap.draftRev++
  h.streams[1].event('delta', { text: 'replacement' })
  h.streams[1].event('done', { text: 'second result' })
  h.streams[1].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA first result CCC 手动')
  assert.equal(h.shell.calls.length, 1)
  assert.equal(h.button('撤销优化').type, 'button')
})

test('button backgrounds live in the stylesheet so hover can win', async () => {
  // 行内背景会覆盖悬停规则，按钮背景应由样式表提供。
  assert.match(client.triggerCss, /\.dsh-prompt-refine-trigger \{[^}]*background: transparent !important/)
  assert.match(client.triggerCss, /\.dsh-prompt-refine-primary \{[^}]*background: #3157D5 !important; color: #fff !important/)
  const h = sseHarness()
  await flushSse()
  assert.equal(h.button('原文').props.style.background, undefined)
  assert.equal(h.right().props.style.background, undefined)
  assert.equal(descendButton(h.overlay(), '完成').props.style.background, undefined)
  assert.equal(descendButton(h.overlay(), '完成').props.style.color, '#fff')
})

function descendButton(root, label) {
  if (!root || typeof root !== 'object') return null
  if (Array.isArray(root)) return root.map(child => descendButton(child, label)).find(Boolean) ?? null
  if (root.type === 'button' && root.children[0] === label) return root
  return descendButton(root.children, label)
}

test('expanded 原文 and 补充要求 fields render with the original text', async () => {
  const h = sseHarness()
  await flushSse()
  assert.equal(h.button('复制结果'), null)
  h.button('原文').props.onClick()
  const descend = (node, type) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map(child => descend(child, type)).find(Boolean) ?? null
    return node.type === type ? node : descend(node.children, type)
  }
  const textarea = descend(h.overlay(), 'textarea')
  assert.equal(textarea.props['aria-label'], '优化前原文')
  assert.equal(textarea.props.value, 'BBB')
  h.button('补充要求').props.onClick()
  const input = descend(h.overlay(), 'input')
  assert.equal(input.props.className, 'dsh-prompt-refine-field')
  assert.equal(h.status().props['aria-label'], '正在优化草稿…')
})

test('the trigger is disabled while its panel is open', async () => {
  const closed = sseHarness({ autostart: false })
  const idle = closed.right()
  assert.equal(idle.children[0], '优化提示词')
  assert.equal(idle.props.disabled, false)
  const h = sseHarness()
  await flushSse()
  assert.equal(h.right().props.disabled, true)
  assert.equal(h.button('原文').props['data-active'], undefined)
  h.button('原文').props.onClick()
  assert.equal(h.button('原文').props['data-active'], 'true')
})

test('browser entry highlights only the rewritten text after its single confirmed write', async () => {
  const h = sseHarness({ withEditor: true })
  await flushSse()
  h.streams[0].event('done', { text: 'BETTER' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BETTER CCC')
  assert.equal(h.dom.text.data, h.shell.snap.draft)
  assert.equal(h.dom.highlights.size, 1)
  const [range] = [...h.dom.highlights.values()][0].ranges
  assert.deepEqual([range.start[1], range.end[1]], [5, 10])
  const redStyle = h.dom.doc.styles.map(style => style.textContent).find(css => css.includes('-del) {'))
  assert.match(redStyle, /rgba\(224, 82, 74, 0\.16\)/)
  assert.match(redStyle, /underline dashed #E0524A/)
  assert.equal(h.status().props['aria-label'], '已优化 · 改动已标出')
  assert.deepEqual(h.status().children[0].children, ['已优化'])
  assert.equal(h.status().children[0].props.style.background, '#E7F4EC')
  assert.equal(h.status().children[0].props.style.color, '#167044')
  assert.deepEqual(h.status().children[1].children, ['改动已标出'])
  assert.equal(h.status().children[1].props.style.fontSize, 13)
  h.button('完成').props.onClick()
  assert.equal(h.dom.highlights.size, 0)
  assert.equal(h.listeners.size, 0)
  assert.equal(h.sessionListeners.size, 0)
})

test('browser entry paints a pure insertion green without a red layer', async () => {
  const h = sseHarness({ withEditor: true })
  await flushSse()
  h.streams[0].event('done', { text: 'BBBsure' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BBBsure CCC')
  assert.equal(h.dom.highlights.size, 1)
  const [range] = [...h.dom.highlights.values()][0].ranges
  assert.deepEqual([range.start[1], range.end[1]], [7, 11])
  const wordStyle = h.dom.doc.styles.map(style => style.textContent).find(css => /::highlight\(dsh-prompt-refine-[^)]+\) \{/.test(css) && !css.includes('-del)'))
  assert.match(wordStyle, /rgba\(61, 214, 140, 0\.16\)/)
  assert.match(wordStyle, /underline dashed #3DD68C/)
  assert.equal(h.status().props['aria-label'], '已优化 · 改动已标出')
  h.button('完成').props.onClick()
  assert.equal(h.dom.highlights.size, 0)
})

test('each regeneration submits the original prompt and the latest note without the previous result', async () => {
  const h = sseHarness()
  await flushSse()
  const request = index => JSON.parse(h.streams[index].options.body)
  assert.deepEqual(request(0), { sessionId: 'session-1', text: 'BBB', note: '' })
  h.streams[0].event('done', { text: 'first result' })
  h.streams[0].end()
  await flushSse()
  h.button('补充要求').props.onClick()
  const noteInput = () => h.overlay().children.find(node => node?.props?.['aria-label'] === '本次补充要求')
  for (const [index, note, result] of [[1, '重点测试异常路径', 'second result'], [2, '更简洁', 'third result']]) {
    noteInput().props.onChange({ target: { value: note } })
    h.button('重新生成').props.onClick()
    assert.equal(h.status().props['aria-label'], '正在优化草稿…')
    assert.ok(h.button('停止生成'))
    await flushSse()
    assert.equal(h.streams.length, index + 1)
    assert.deepEqual(request(index), { sessionId: 'session-1', text: 'BBB', note })
    h.streams[index].event('done', { text: result })
    h.streams[index].end()
    await flushSse()
    assert.equal(h.shell.snap.draft, `AAA ${result} CCC`)
  }
  h.button('撤销优化').props.onClick()
  assert.equal(h.shell.snap.draft, 'AAA BBB CCC')
})

test('an identical regenerated result reports completion rather than silently showing the old status', async () => {
  const h = sseHarness({ withEditor: true })
  await flushSse()
  h.streams[0].event('done', { text: 'BETTER' })
  h.streams[0].end()
  await flushSse()
  const previousRevision = h.shell.snap.draftRev
  h.button('重新生成').props.onClick()
  await flushSse()
  assert.equal(h.streams.length, 2)
  assert.equal(h.status().props['aria-label'], '正在优化草稿…')
  h.streams[1].event('done', { text: 'BETTER' })
  h.streams[1].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BETTER CCC')
  assert.equal(h.shell.snap.draftRev, previousRevision)
  assert.equal(h.status().props['aria-label'], '已重新生成 · 结果与上次相同')
  assert.ok(h.button('重新生成'))
  assert.equal(h.button('撤销优化').props.disabled, false)
  h.button('重新生成').props.onClick()
  await flushSse()
  assert.equal(h.status().props['aria-label'], '正在优化草稿…')
  h.streams[2].event('done', { text: 'BEST' })
  h.streams[2].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BEST CCC')
  assert.doesNotMatch(h.status().props['aria-label'], /结果与上次相同/u)
  h.button('撤销优化').props.onClick()
  assert.equal(h.shell.snap.draft, 'AAA BBB CCC')
})

test('regeneration replaces its prior result and clears the old highlight before new done', async () => {
  const h = sseHarness({ withEditor: true })
  await flushSse()
  h.streams[0].event('done', { text: 'BETTER' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.dom.highlights.size, 1)
  h.button('重新生成').props.onClick()
  assert.equal(h.dom.highlights.size, 0)
  await flushSse()
  h.streams[1].event('done', { text: 'BEST' })
  h.streams[1].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BEST CCC')
  const [range] = [...h.dom.highlights.values()][0].ranges
  assert.deepEqual([range.start[1], range.end[1]], [5, 8])
  h.button('撤销优化').props.onClick()
  assert.equal(h.shell.snap.draft, 'AAA BBB CCC')
  assert.equal(h.dom.highlights.size, 0)
  assert.equal(h.listeners.size, 0)
})

test('failed regeneration leaves the successful draft but never claims cleared highlights', async () => {
  const h = sseHarness({ withEditor: true })
  await flushSse()
  h.streams[0].event('done', { text: 'BETTER' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.dom.highlights.size, 1)
  h.button('重新生成').props.onClick()
  assert.equal(h.dom.highlights.size, 0)
  await flushSse()
  h.streams[1].event('failure', { error: 'temporarily unavailable' })
  h.streams[1].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BETTER CCC')
  assert.equal(h.status().props['aria-label'], '已优化')
  h.button('完成').props.onClick()
})

test('composer unmount aborts its active request and releases its shell subscription', async () => {
  const h = sseHarness({ withEditor: true })
  const unmount = h.mount()
  await flushSse()
  assert.equal(h.listeners.size, 1)
  unmount()
  await tick()
  assert.equal(h.streams[0].options.signal.aborted, true)
  assert.equal(h.listeners.size, 0)
  assert.equal(h.overlay(), null)
  h.streams[0].event('done', { text: 'too late' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.shell.calls.length, 0)
})

test('an immediate remount reuses the panel instead of tearing down a live request', async () => {
  const h = sseHarness({ withEditor: true })
  const unmount = h.mount()
  await flushSse()
  assert.equal(h.listeners.size, 1)
  // 模拟 React 严格模式：同一轮内卸载并立即重挂载。
  unmount()
  const remount = h.mount()
  await tick()
  assert.equal(h.streams[0].options.signal.aborted, false)
  assert.equal(h.listeners.size, 1)
  h.streams[0].event('done', { text: 'BETTER' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BETTER CCC')
  assert.equal(h.dom.highlights.size, 1)
  remount?.()
  await tick()
  assert.equal(h.listeners.size, 0)
  assert.equal(h.dom.highlights.size, 0)
})

test('DOM-only mutation clears live highlight and updates the operation strip', async () => {
  const h = sseHarness({ withEditor: true })
  await flushSse()
  h.streams[0].event('done', { text: 'BETTER' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.dom.highlights.size, 1)
  h.dom.doc.observer.notify()
  assert.equal(h.dom.highlights.size, 0)
  assert.equal(h.status().props['aria-label'], '已优化')
  h.dispose()
  assert.equal(h.listeners.size, 0)
})

test('submitting a refined prompt closes the panel and clears highlights without changing the submitted draft', async () => {
  const h = sseHarness({ withEditor: true })
  await flushSse()
  h.streams[0].event('done', { text: 'BETTER' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.dom.highlights.size, 1)
  h.shell.snap.phase = 'submitting'
  h.publish()
  assert.equal(h.overlay(), null)
  assert.equal(h.dom.highlights.size, 0)
  assert.equal(h.listeners.size, 0)
  assert.equal(h.shell.snap.draft, 'AAA BETTER CCC')
  assert.equal(h.shell.calls.length, 1)
  assert.equal(h.right().props.disabled, false)
})

test('ordinary sends close the panel when the session publishes a submission while the input stays plain', async () => {
  // 普通发送先发布提交记录再清空草稿，输入状态保持 plain。
  for (const placement of ['transcript', 'queued', 'steering']) for (const notify of [true, false]) {
    const h = sseHarness({ withEditor: true })
    await flushSse()
    h.streams[0].event('done', { text: 'BETTER' })
    h.streams[0].end()
    await flushSse()
    const submittedDraft = h.shell.snap.draft
    // Session 通知可能延迟到微任务，但快照已更新；覆盖两种通知顺序。
    h.publishSession({ pendingSubmissions: [{ requestId: 'send-1', text: submittedDraft, placement }] }, { notify })
    // 清空由宿主完成，插件不能撤销或再次写入。
    h.shell.snap.draft = ''
    h.shell.snap.draftRev++
    h.dom.text.data = ''
    h.publish()
    assert.equal(h.shell.snap.phase, 'plain')
    assert.equal(h.overlay(), null)
    assert.equal(h.dom.highlights.size, 0)
    assert.equal(h.shell.snap.draft, '')
    assert.equal(h.shell.calls.length, 1)
    assert.equal(h.listeners.size, 0)
    assert.equal(h.sessionListeners.size, 0)
  }
})

test('ordinary submission closes a review already invalidated by manual editing', async () => {
  const h = sseHarness({ withEditor: true })
  await flushSse()
  h.streams[0].event('done', { text: 'BETTER' })
  h.streams[0].end()
  await flushSse()
  h.shell.snap.draft += ' edited'
  h.shell.snap.draftRev++
  h.dom.text.data = h.shell.snap.draft
  h.publish()
  assert.ok(h.overlay())
  const draft = h.shell.snap.draft
  h.publishSession({ pendingSubmissions: [{ requestId: 'send-edited', text: draft, placement: 'transcript' }] })
  assert.equal(h.overlay(), null)
  assert.equal(h.shell.snap.draft, draft)
  assert.equal(h.shell.calls.length, 1)
  assert.equal(h.listeners.size, 0)
  assert.equal(h.sessionListeners.size, 0)
})

test('ordinary submission aborts optimization and a failed send restoration cannot reopen it', async () => {
  const h = sseHarness({ withEditor: true })
  await flushSse()
  h.publishSession({ pendingSubmissions: [{ requestId: 'send-pending', placement: 'transcript' }] })
  assert.equal(h.streams[0].options.signal.aborted, true)
  assert.equal(h.overlay(), null)
  // 发送失败时由宿主恢复草稿，插件不重新打开面板。
  h.shell.snap.draft = ''
  h.shell.snap.draftRev++
  h.publish()
  h.publishSession({ pendingSubmissions: [], promptError: 'send failed' })
  h.shell.snap.draft = 'AAA BBB CCC'
  h.shell.snap.draftRev++
  h.publish()
  h.streams[0].event('done', { text: 'too late' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.overlay(), null)
  assert.equal(h.shell.snap.draft, 'AAA BBB CCC')
  assert.equal(h.shell.calls.length, 0)
  assert.equal(h.listeners.size, 0)
  assert.equal(h.sessionListeners.size, 0)
})

test('existing submissions and ordinary session updates do not close a newly opened review', async () => {
  const h = sseHarness({ autostart: false })
  h.publishSession({ pendingSubmissions: [{ requestId: 'previous-send', placement: 'queued' }] })
  h.right().props.onClick()
  await flushSse()
  h.publishSession({ running: true })
  assert.ok(h.overlay())
  h.publishSession({ pendingSubmissions: [] })
  assert.ok(h.overlay())
  h.shell.snap.draft += ' edited'
  h.shell.snap.draftRev++
  h.publish()
  assert.ok(h.overlay())
  h.button('完成').props.onClick()
  assert.equal(h.overlay(), null)
  assert.equal(h.listeners.size, 0)
  assert.equal(h.sessionListeners.size, 0)
})

test('submission still closes a panel invalidated by editing or Enter adjudication', async () => {
  for (const previousChange of ['manual-edit', 'adjudicating']) {
    const h = sseHarness({ withEditor: true })
    await flushSse()
    h.streams[0].event('done', { text: 'BETTER' })
    h.streams[0].end()
    await flushSse()
    if (previousChange === 'manual-edit') {
      h.shell.snap.draft += ' 手动'
      h.shell.snap.draftRev++
      h.dom.text.data = h.shell.snap.draft
    } else h.shell.snap.phase = 'adjudicating'
    h.publish()
    assert.notEqual(h.overlay(), null)
    const submittedDraft = h.shell.snap.draft
    h.shell.snap.phase = 'submitting'
    h.publish()
    assert.equal(h.overlay(), null)
    assert.equal(h.dom.highlights.size, 0)
    assert.equal(h.listeners.size, 0)
    assert.equal(h.shell.snap.draft, submittedDraft)
    assert.equal(h.shell.calls.length, 1)
  }
})

test('submission aborts an in-flight generation and late events cannot write or reopen the panel', async () => {
  const h = sseHarness({ withEditor: true })
  await flushSse()
  h.streams[0].event('delta', { text: 'preview only' })
  await flushSse()
  h.shell.snap.phase = 'submitting'
  h.publish()
  assert.equal(h.streams[0].options.signal.aborted, true)
  assert.equal(h.overlay(), null)
  assert.equal(h.listeners.size, 0)
  h.streams[0].event('done', { text: 'too late' })
  h.streams[0].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BBB CCC')
  assert.equal(h.shell.calls.length, 0)
  assert.equal(h.overlay(), null)
})

test('manual edit immediately aborts generation, removes highlights and disables unsafe undo', async () => {
  const h = sseHarness({ withEditor: true })
  await flushSse()
  h.streams[0].event('done', { text: 'BETTER' })
  h.streams[0].end()
  await flushSse()
  h.button('重新生成').props.onClick()
  await flushSse()
  h.shell.snap.draft += ' 手动'
  h.shell.snap.draftRev++
  h.dom.text.data = h.shell.snap.draft
  h.publish()
  assert.equal(h.streams[1].options.signal.aborted, true)
  assert.equal(h.button('撤销优化').props.disabled, true)
  assert.equal(h.button('重新生成').props.disabled, true)
  const alert = h.overlay().children.find(node => node?.props?.role === 'alert')
  assert.deepEqual(alert.children, ['草稿已被编辑或提交，已停止优化；请完成后重新开始。'])
  assert.equal(alert.props.style.font, 'inherit')
  assert.equal(alert.props.style.fontSize, 13)
  assert.equal(alert.props.style.fontWeight, 500)
  h.streams[1].event('done', { text: 'never write' })
  h.streams[1].end()
  await flushSse()
  assert.equal(h.shell.snap.draft, 'AAA BETTER CCC 手动')
  assert.equal(h.shell.calls.length, 1)
  h.button('完成').props.onClick()
  assert.equal(h.listeners.size, 0)
})
