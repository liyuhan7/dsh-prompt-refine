function assertString(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
}

/** Standalone refinement state; snapshots and generation history are immutable. */
export class RefinementSession {
  #snapshot
  #listeners = new Set()
  #nextGenerationId = 1

  constructor() {
    this.#snapshot = Object.freeze({
      original: '',
      optimized: '',
      current: '',
      status: 'idle',
      revision: 0,
      generations: Object.freeze([]),
      hasResult: false,
      dirty: false
    })
  }

  get original() { return this.#snapshot.original }
  get optimized() { return this.#snapshot.optimized }
  get current() { return this.#snapshot.current }
  get status() { return this.#snapshot.status }
  get revision() { return this.#snapshot.revision }
  get generations() { return this.#snapshot.generations }
  get hasResult() { return this.#snapshot.hasResult }
  get dirty() { return this.#snapshot.dirty }

  getSnapshot() {
    return this.#snapshot
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  begin(original) {
    assertString(original, 'original')
    return this.#update({
      original,
      optimized: '',
      current: original,
      status: 'idle',
      generations: Object.freeze([]),
      hasResult: false
    })
  }

  applyGeneration(text) {
    assertString(text, 'text')
    const generation = Object.freeze({ id: this.#nextGenerationId++, text })
    return this.#update({
      optimized: text,
      current: text,
      status: 'reviewing',
      generations: Object.freeze([...this.generations, generation]),
      hasResult: true
    })
  }

  updateCurrent(text) {
    assertString(text, 'text')
    if (text === this.current) return this.#snapshot
    return this.#update({
      current: text,
      status: this.hasResult && text === this.optimized ? 'reviewing' : 'editing'
    })
  }

  clear() {
    return this.#update({
      original: '',
      optimized: '',
      current: '',
      status: 'idle',
      generations: Object.freeze([]),
      hasResult: false
    })
  }

  #update(changes) {
    const next = { ...this.#snapshot, ...changes, revision: this.revision + 1 }
    next.dirty = next.hasResult && next.current !== next.optimized
    const snapshot = Object.freeze(next)
    this.#snapshot = snapshot
    for (const listener of [...this.#listeners]) listener(snapshot)
    return snapshot
  }
}
