/* Store checks: debounced flush, atomic write, the cross-process delta merge,
   retention on write, and the degradation paths that must never throw. */
'use strict'

const { group, test, assert, assertEqual, report } = require('./harness.cjs')

const modulePromise = import('../index.js')

const UTC8 = 480

/** An in-memory stand-in for the fs seam the store takes. */
function fakeIo() {
  const files = new Map()
  return {
    files,
    existsSync: (path) => files.has(path),
    mkdirSync: () => {},
    readFileSync: (path) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`)
      return files.get(path)
    },
    writeFileSync: (path, text) => {
      files.set(path, text)
    },
    renameSync: (from, to) => {
      if (!files.has(from)) throw new Error(`ENOENT: ${from}`)
      files.set(to, files.get(from))
      files.delete(from)
    },
  }
}

/** One recorded call with sane defaults. */
function record(overrides = {}) {
  return {
    ts: Date.UTC(2026, 9, 14, 6, 0, 0),
    day: '2026-10-14',
    provider: 'workbuddy',
    model: 'deepseek-v4.1-flash',
    purpose: 'chat',
    usageReported: true,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    durationMs: 1000,
    ttftMs: 200,
    ok: true,
    ...overrides,
  }
}

/** Build a store over a fake io and a controllable clock. */
function makeStore(X, io, options = {}) {
  let now = options.now ?? Date.UTC(2026, 9, 14, 12, 0, 0)
  const timers = []
  const store = X.createLedgerStore({
    path: options.path ?? '/state/token-dashboard/ledger.json',
    logger: options.logger,
    retentionDays: options.retentionDays ?? 730,
    recentLimit: options.recentLimit ?? 300,
    utcOffsetMinutes: UTC8,
    flushDebounceMs: options.flushDebounceMs ?? 2000,
    io,
    now: () => now,
    // Collect the scheduled callbacks so a test can fire the debounce itself.
    setTimeoutImpl: (fn) => {
      timers.push(fn)
      return { unref() {} }
    },
    clearTimeoutImpl: () => {},
  })
  return {
    store,
    setNow: (value) => {
      now = value
    },
    /** Fire every pending debounce callback. */
    runTimers() {
      const pending = timers.splice(0, timers.length)
      for (const fn of pending) fn()
    },
  }
}

async function main() {
  const { __internal: X } = await modulePromise

  group('store: flush behaviour')

  test('recording schedules a flush without touching disk immediately', () => {
    const io = fakeIo()
    const { store } = makeStore(X, io)
    store.append(record())
    assertEqual(io.files.size, 0)
  })

  test('firing the debounce writes the ledger', () => {
    const io = fakeIo()
    const { store, runTimers } = makeStore(X, io)
    store.append(record())
    runTimers()
    assertEqual(io.files.size, 1)
    const { state } = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json'))
    assertEqual(state.days['2026-10-14'].requests, 1)
    assertEqual(state.days['2026-10-14'].inputTokens, 100)
  })

  test('the write lands on the final path, never the temporary one', () => {
    const io = fakeIo()
    const { store, runTimers } = makeStore(X, io)
    store.append(record())
    runTimers()
    assert(io.files.has('/state/token-dashboard/ledger.json'), 'ledger missing')
    assert(!io.files.has('/state/token-dashboard/ledger.json.tmp'), 'temporary file left behind')
  })

  test('many calls inside one window coalesce into a single write', () => {
    const io = fakeIo()
    const { store, runTimers } = makeStore(X, io)
    for (let i = 0; i < 25; i += 1) store.append(record())
    assertEqual(io.files.size, 0)
    runTimers()
    const { state } = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json'))
    assertEqual(state.days['2026-10-14'].requests, 25)
  })

  test('sub-maps and the detail list are persisted alongside the counters', () => {
    const io = fakeIo()
    const { store, runTimers } = makeStore(X, io)
    store.append(record({ cwd: 'D:\\proj' }))
    runTimers()
    const { state } = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json'))
    assertEqual(state.days['2026-10-14'].models['workbuddy|deepseek-v4.1-flash'].requests, 1)
    assertEqual(state.days['2026-10-14'].purposes.chat.requests, 1)
    assertEqual(state.days['2026-10-14'].projects['D:\\proj'].requests, 1)
    assertEqual(state.recent.length, 1)
    assertEqual(state.recent[0].cwd, 'D:\\proj')
  })

  test('a second flush only adds the new delta', () => {
    const io = fakeIo()
    const { store, runTimers } = makeStore(X, io)
    store.append(record())
    runTimers()
    store.append(record())
    runTimers()
    const { state } = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json'))
    assertEqual(state.days['2026-10-14'].requests, 2)
    assertEqual(state.days['2026-10-14'].inputTokens, 200)
  })

  group('store: reading across a restart')

  test('a freshly mounted store reads the records already on disk', () => {
    // The regression: `read()` once returned only this process's memory, so a
    // restart made the dashboard look as though the day had just begun while
    // the file held the whole day.
    const io = fakeIo()
    const first = makeStore(X, io)
    for (let i = 0; i < 3; i += 1) first.store.append(record({ ts: Date.UTC(2026, 9, 14, 6, 0, i) }))
    first.runTimers()

    const second = makeStore(X, io)
    second.store.append(record({ ts: Date.UTC(2026, 9, 14, 6, 0, 30) }))

    const { state } = second.store.read()
    assertEqual(state.days['2026-10-14'].requests, 4)
    assertEqual(state.days['2026-10-14'].inputTokens, 400)
    assertEqual(state.recent.length, 4)
  })

  test('repeated reads do not accumulate', () => {
    const io = fakeIo()
    const first = makeStore(X, io)
    first.store.append(record())
    first.runTimers()

    const second = makeStore(X, io)
    second.store.append(record({ ts: Date.UTC(2026, 9, 14, 6, 0, 9) }))

    assertEqual(second.store.read().state.days['2026-10-14'].requests, 2)
    assertEqual(second.store.read().state.days['2026-10-14'].requests, 2)
    assertEqual(second.store.read().state.days['2026-10-14'].requests, 2)
  })

  test('a read after a flush still matches what landed on disk', () => {
    const io = fakeIo()
    const first = makeStore(X, io)
    first.store.append(record())
    first.runTimers()

    const second = makeStore(X, io)
    second.store.append(record({ ts: Date.UTC(2026, 9, 14, 6, 0, 9) }))
    second.runTimers()

    const read = second.store.read().state
    const onDisk = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json')).state
    assertEqual(read.days['2026-10-14'].requests, onDisk.days['2026-10-14'].requests)
    assertEqual(read.days['2026-10-14'].inputTokens, onDisk.days['2026-10-14'].inputTokens)
    assertEqual(read.days['2026-10-14'].requests, 2)
  })

  test('a read never mutates what a later flush would consume', () => {
    const io = fakeIo()
    const first = makeStore(X, io)
    first.store.append(record())
    first.runTimers()

    const second = makeStore(X, io)
    second.store.append(record({ ts: Date.UTC(2026, 9, 14, 6, 0, 9) }))
    // Read several times, then flush: the write must not have doubled.
    second.store.read()
    second.store.read()
    second.runTimers()
    const onDisk = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json')).state
    assertEqual(onDisk.days['2026-10-14'].requests, 2)
    assertEqual(onDisk.days['2026-10-14'].inputTokens, 200)
  })

  test('sub-maps from a previous process are read back too', () => {
    const io = fakeIo()
    const first = makeStore(X, io)
    first.store.append(record({ cwd: 'D:\\a' }))
    first.runTimers()

    const second = makeStore(X, io)
    const { state } = second.store.read()
    assertEqual(state.days['2026-10-14'].models['workbuddy|deepseek-v4.1-flash'].requests, 1)
    assertEqual(state.days['2026-10-14'].projects['D:\\a'].requests, 1)
  })

  test('a corrupt file still reads as an empty ledger', () => {
    const io = fakeIo()
    io.files.set('/state/token-dashboard/ledger.json', '{"days":{ truncated')
    const warnings = []
    const { store } = makeStore(X, io, { logger: { warn: (m) => warnings.push(m) } })
    assertEqual(store.read().state.days, {})
    assert(warnings.length > 0, 'expected a warning about the unreadable ledger')
  })

  group('store: two processes on one ledger')

  test('interleaved flushes from two stores keep both sets of counts', () => {
    const io = fakeIo()
    const a = makeStore(X, io)
    const b = makeStore(X, io)
    // Each store records its own calls, then they alternate flushes — the
    // desktop and headless profiles sharing one ledger. Timestamps differ per
    // call, as they do in reality.
    a.store.append(record({ ts: Date.UTC(2026, 9, 14, 6, 0, 1) }))
    a.store.append(record({ ts: Date.UTC(2026, 9, 14, 6, 0, 2) }))
    b.store.append(record({ ts: Date.UTC(2026, 9, 14, 6, 0, 3) }))
    a.runTimers()
    b.runTimers()
    a.store.append(record({ ts: Date.UTC(2026, 9, 14, 6, 0, 4) }))
    a.runTimers()
    b.store.append(record({ ts: Date.UTC(2026, 9, 14, 6, 0, 5) }))
    b.runTimers()
    const { state } = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json'))
    assertEqual(state.days['2026-10-14'].requests, 5)
    assertEqual(state.days['2026-10-14'].inputTokens, 500)
    assertEqual(state.recent.length, 5)
  })

  test('repeated flushes do not duplicate detail records', () => {
    const io = fakeIo()
    const { store, runTimers } = makeStore(X, io)
    store.append(record())
    runTimers()
    // Two further flushes with no new calls must not re-add the same record.
    store.flush()
    store.flush()
    const { state } = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json'))
    assertEqual(state.recent.length, 1)
    assertEqual(state.days['2026-10-14'].requests, 1)
  })

  test('a store that never wrote still merges onto a foreign document', () => {
    const io = fakeIo()
    // A different process (or an earlier version) already wrote this file.
    const seed = X.emptyState()
    seed.days['2026-10-14'] = { ...X.emptyBucket(), requests: 40, inputTokens: 4000 }
    io.files.set('/state/token-dashboard/ledger.json', X.serializeLedger(seed))
    const { store, runTimers } = makeStore(X, io)
    store.append(record())
    runTimers()
    const { state } = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json'))
    assertEqual(state.days['2026-10-14'].requests, 41)
    assertEqual(state.days['2026-10-14'].inputTokens, 4100)
  })

  test('a corrupt document is overwritten rather than treated as fatal', () => {
    const io = fakeIo()
    io.files.set('/state/token-dashboard/ledger.json', '{"days":{ truncated')
    const warnings = []
    const { store, runTimers } = makeStore(X, io, { logger: { warn: (m) => warnings.push(m) } })
    store.append(record())
    runTimers()
    const { state, problem } = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json'))
    assertEqual(problem, null)
    assertEqual(state.days['2026-10-14'].requests, 1)
    assert(warnings.length > 0, 'expected a warning about the unreadable ledger')
  })

  test('a write failure is contained and does not throw at the caller', () => {
    const io = fakeIo()
    io.writeFileSync = () => {
      throw new Error('disk full')
    }
    const warnings = []
    const { store, runTimers } = makeStore(X, io, { logger: { warn: (m) => warnings.push(m) } })
    store.append(record())
    runTimers()
    assert(warnings.some((m) => m.includes('disk full')), 'expected the write failure to be reported')
    // The in-memory totals survive, so the dashboard keeps working.
    assertEqual(store.read().state.days['2026-10-14'].requests, 1)
  })

  test('a throwing logger cannot escape the recording path', () => {
    const io = fakeIo()
    const { store, runTimers } = makeStore(X, io, {
      logger: {
        warn: () => {
          throw new Error('logger exploded')
        },
      },
    })
    io.files.clear()
    store.append(record())
    runTimers()
    assertEqual(store.read().state.days['2026-10-14'].requests, 1)
  })

  group('store: retention and limits')

  test('retention trims old days as the document is written', () => {
    const io = fakeIo()
    // A ledger holding a day far outside a short window.
    const seed = X.emptyState()
    seed.days['2026-01-01'] = { ...X.emptyBucket(), requests: 9 }
    io.files.set('/state/token-dashboard/ledger.json', X.serializeLedger(seed))
    const { store, runTimers } = makeStore(X, io, { retentionDays: 5 })
    store.append(record())
    runTimers()
    const { state } = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json'))
    assertEqual(state.days['2026-01-01'], undefined)
    assertEqual(state.days['2026-10-14'].requests, 1)
  })

  test('the detail list respects recentLimit', () => {
    const io = fakeIo()
    const { store, runTimers } = makeStore(X, io, { recentLimit: 3 })
    for (let i = 0; i < 8; i += 1) store.append(record({ ts: Date.UTC(2026, 9, 14, 6, 0, i) }))
    runTimers()
    const { state } = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json'))
    assertEqual(state.recent.length, 3)
    // Newest first.
    assert(state.recent[0].ts > state.recent[2].ts, 'expected newest-first ordering')
  })

  test('dispose flushes what the debounce had not yet written', () => {
    const io = fakeIo()
    const { store } = makeStore(X, io)
    store.append(record())
    assertEqual(io.files.size, 0)
    store.dispose()
    assertEqual(io.files.size, 1)
    const { state } = X.parseLedger(io.files.get('/state/token-dashboard/ledger.json'))
    assertEqual(state.days['2026-10-14'].requests, 1)
  })

  test('a disposed store ignores further records', () => {
    const io = fakeIo()
    const { store, runTimers } = makeStore(X, io)
    store.dispose()
    store.append(record())
    runTimers()
    assertEqual(store.read().state.days['2026-10-14'], undefined)
  })

  process.exit(report('store-check'))
}

main().catch((error) => {
  console.error('store-check crashed:', error)
  process.exit(1)
})
