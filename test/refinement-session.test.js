import test from 'node:test'
import assert from 'node:assert/strict'
import { RefinementSession } from '../lib/refinement-session.js'

function assertGettersMatchSnapshot(session) {
  const snapshot = session.getSnapshot()
  for (const key of ['original', 'optimized', 'current', 'status', 'revision', 'generations', 'hasResult', 'dirty']) {
    assert.strictEqual(session[key], snapshot[key])
  }
}

test('constructor starts empty and idle with a stable snapshot', () => {
  const session = new RefinementSession()
  assert.deepEqual(session.getSnapshot(), {
    original: '', optimized: '', current: '', status: 'idle', revision: 0,
    generations: [], hasResult: false, dirty: false
  })
  assert.strictEqual(session.getSnapshot(), session.getSnapshot())
  assertGettersMatchSnapshot(session)
})

test('begin fixes the original and initializes the editable text', () => {
  const session = new RefinementSession()
  session.begin('  original\n')
  assert.equal(session.original, '  original\n')
  assert.equal(session.current, session.original)
  assert.equal(session.optimized, '')
  assert.equal(session.hasResult, false)
  assert.equal(session.dirty, false)
  assert.equal(session.revision, 1)
  session.updateCurrent('edited before generation')
  assert.equal(session.original, '  original\n')
  assert.equal(session.current, 'edited before generation')
  assert.equal(session.status, 'editing')
  assert.equal(session.dirty, false)
  assertGettersMatchSnapshot(session)
})

test('applyGeneration records a successful result and enters reviewing', () => {
  const session = new RefinementSession()
  session.begin('original')
  session.applyGeneration('optimized')
  assert.equal(session.original, 'original')
  assert.equal(session.optimized, 'optimized')
  assert.equal(session.current, 'optimized')
  assert.equal(session.hasResult, true)
  assert.equal(session.status, 'reviewing')
  assert.equal(session.dirty, false)
  assert.equal(session.revision, 2)
  assert.deepEqual(session.generations, [{ id: 1, text: 'optimized' }])
  assertGettersMatchSnapshot(session)
})

test('user edits preserve original and optimized; restoring optimized resumes reviewing', () => {
  const session = new RefinementSession()
  session.begin('original')
  session.applyGeneration('optimized')
  session.updateCurrent('user edit')
  assert.equal(session.original, 'original')
  assert.equal(session.optimized, 'optimized')
  assert.equal(session.current, 'user edit')
  assert.equal(session.status, 'editing')
  assert.equal(session.dirty, true)
  assert.equal(session.revision, 3)
  session.updateCurrent('')
  assert.equal(session.current, '')
  assert.equal(session.dirty, true)
  assert.equal(session.status, 'editing')
  session.updateCurrent('optimized')
  assert.equal(session.status, 'reviewing')
  assert.equal(session.dirty, false)
  assert.equal(session.revision, 5)
  assert.deepEqual(session.generations, [{ id: 1, text: 'optimized' }])
  assertGettersMatchSnapshot(session)
})

test('same-text updates do not replace snapshots, increment revisions, or notify', () => {
  const session = new RefinementSession()
  const notifications = []
  session.subscribe(snapshot => notifications.push(snapshot))
  for (const mutate of [() => {}, () => session.begin('original'), () => session.applyGeneration('optimized'), () => session.updateCurrent('edit')]) {
    mutate()
    const before = session.getSnapshot()
    const count = notifications.length
    session.updateCurrent(session.current)
    assert.strictEqual(session.getSnapshot(), before)
    assert.equal(session.revision, before.revision)
    assert.equal(notifications.length, count)
  }
})

test('clear resets all text, history, and result state while revision stays monotonic', () => {
  const session = new RefinementSession()
  session.begin('original')
  session.applyGeneration('optimized')
  session.updateCurrent('edit')
  const before = session.getSnapshot()
  session.clear()
  assert.deepEqual(session.getSnapshot(), {
    original: '', optimized: '', current: '', status: 'idle', revision: 4,
    generations: [], hasResult: false, dirty: false
  })
  assert.notStrictEqual(session.getSnapshot(), before)
  assert.equal(before.current, 'edit')
  assertGettersMatchSnapshot(session)
})

test('subscriptions receive each new snapshot and support independent idempotent unsubscribe', () => {
  const session = new RefinementSession()
  const first = []
  const second = []
  const unsubscribe = session.subscribe(snapshot => first.push(snapshot))
  session.subscribe(snapshot => second.push(snapshot))
  assert.deepEqual(first, [])
  session.begin('original')
  assert.strictEqual(first[0], session.getSnapshot())
  session.applyGeneration('optimized')
  assert.strictEqual(first[1], session.getSnapshot())
  unsubscribe()
  unsubscribe()
  session.updateCurrent('edit')
  session.clear()
  assert.equal(first.length, 2)
  assert.deepEqual(second.map(snapshot => snapshot.revision), [1, 2, 3, 4])
  assert.strictEqual(second[3], session.getSnapshot())
})

test('history keeps every successful generation, including identical results, but not user edits', () => {
  const session = new RefinementSession()
  session.begin('original')
  session.applyGeneration('one')
  session.updateCurrent('user edit')
  session.applyGeneration('two')
  session.applyGeneration('two')
  assert.deepEqual(session.generations, [
    { id: 1, text: 'one' }, { id: 2, text: 'two' }, { id: 3, text: 'two' }
  ])
  assert.equal(session.revision, 5)
  assert.equal(session.current, 'two')
  assert.equal(session.status, 'reviewing')
  assert.equal(session.dirty, false)
  session.begin('new original')
  assert.equal(session.original, 'new original')
  assert.equal(session.current, 'new original')
  assert.equal(session.optimized, '')
  assert.equal(session.hasResult, false)
  assert.equal(session.dirty, false)
  assert.deepEqual(session.generations, [])
  session.applyGeneration('three')
  assert.deepEqual(session.generations, [{ id: 4, text: 'three' }])
})

test('snapshots, history arrays, and history entries are immutable and remain unchanged', () => {
  const session = new RefinementSession()
  const initial = session.getSnapshot()
  session.begin('original')
  const begun = session.getSnapshot()
  session.applyGeneration('optimized')
  const generated = session.getSnapshot()
  assert.ok(Object.isFrozen(generated))
  assert.ok(Object.isFrozen(generated.generations))
  assert.ok(Object.isFrozen(generated.generations[0]))
  assert.throws(() => { generated.current = 'tampered' }, TypeError)
  assert.throws(() => { generated.generations.push({ id: 9, text: 'tampered' }) }, TypeError)
  assert.throws(() => { generated.generations[0].text = 'tampered' }, TypeError)
  assert.throws(() => { session.original = 'tampered' }, TypeError)
  session.applyGeneration('new optimized')
  session.clear()
  assert.equal(initial.revision, 0)
  assert.equal(initial.original, '')
  assert.ok(Object.isFrozen(initial.generations))
  assert.equal(begun.current, 'original')
  assert.deepEqual(begun.generations, [])
  assert.equal(generated.current, 'optimized')
  assert.deepEqual(generated.generations, [{ id: 1, text: 'optimized' }])
})

test('text mutations reject non-strings atomically and accept empty strings without coercion', () => {
  const session = new RefinementSession()
  session.begin('original')
  const notifications = []
  session.subscribe(snapshot => notifications.push(snapshot))
  for (const method of ['begin', 'applyGeneration', 'updateCurrent']) {
    for (const value of [undefined, null, 1, false, {}, [], new String('text')]) {
      const before = session.getSnapshot()
      assert.throws(() => session[method](value), TypeError)
      assert.strictEqual(session.getSnapshot(), before)
    }
  }
  assert.deepEqual(notifications, [])
  session.begin('')
  session.applyGeneration('')
  assert.equal(session.hasResult, true)
  assert.equal(session.status, 'reviewing')
  assert.equal(session.dirty, false)
  assert.deepEqual(session.generations, [{ id: 1, text: '' }])
  session.updateCurrent(' ')
  assert.equal(session.current, ' ')
  assert.equal(session.dirty, true)
  session.updateCurrent('')
  assert.equal(session.current, '')
  assert.equal(session.status, 'reviewing')
  for (const listener of [null, undefined, 'listener', {}]) {
    assert.throws(() => session.subscribe(listener), TypeError)
  }
})
