/* Client checks: the hand-written CJS bundle must load under the shell's
   module facade, register the foot entry and the panel, and format numbers
   the way the page assumes. */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { group, test, assert, assertEqual, report } = require('./harness.cjs')

const CLIENT = path.join(__dirname, '..', 'client.js')

/** Minimal React stand-in: the bundle only calls these at apply time. */
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'Fragment',
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

/** Primitives stand-in: real icons/controls are irrelevant here. */
const primitives = new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : undefined) })

/** Load the bundle under a captured module facade. */
function loadBundle() {
  let registration
  const window = {
    __ModuleLoader__: {
      load: (entry) => {
        registration = entry
      },
    },
  }
  const previous = global.window
  global.window = window
  try {
    delete require.cache[require.resolve(CLIENT)]
    require(CLIENT)
  } finally {
    global.window = previous
  }
  assert(registration !== undefined, 'the bundle registered no factory')
  const requireStub = (id) => {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement, Fragment: 'Fragment' }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected module request: ${id}`)
  }
  return { registration, exports: registration.factory(requireStub) }
}

/** A context stub recording slot registrations and effects. */
function makeCtx() {
  const registered = []
  const effects = []
  const panels = []
  const ctx = {
    locale: {
      register: (ns, dict) => ({ ns, dict }),
      bind: () => (key) => key,
    },
    layout: {
      selectPanel: (id) => panels.push(id),
    },
    slots: {
      inject: (slot) => {
        // The real registry runs the injector when the slot exists.
        return slot
      },
      register: (definition, Component) => {
        registered.push({ definition, Component })
        return () => {}
      },
    },
    effect: (fn, label) => {
      effects.push(label)
      const disposer = fn()
      return disposer
    },
  }
  return { ctx, registered, effects, panels }
}

/** Make `slots.inject` actually run its injector, as the registry does. */
function activate(ctx) {
  ctx.slots.inject = (slot, injector) => injector()
  return ctx
}

const bundle = loadBundle()

group('client: bundle shape')

test('the module id is the plugin name', () => {
  assertEqual(bundle.registration.id, 'dsh-token-dashboard')
})

test('the bundle loads under the shell facade', () => {
  assert(typeof bundle.exports.apply === 'function', 'apply must be exported')
  assert(Array.isArray(bundle.exports.inject), 'inject must be exported')
})

test('the declared services are the ones the code uses', () => {
  assertEqual([...bundle.exports.inject].sort(), ['layout', 'locale', 'slots'])
})

test('connection is not a hard dependency', () => {
  assert(!bundle.exports.inject.includes('connection'), 'connection must be read opportunistically')
})

test('the panel id is the shared constant', () => {
  assertEqual(bundle.exports.PANEL_ID, 'token-usage')
  assertEqual(bundle.exports.__internal.PANEL_ID, 'token-usage')
})

group('client: registration')

test('apply registers the foot entry and the main panel', () => {
  const { ctx, registered } = makeCtx()
  activate(ctx)
  bundle.exports.apply(ctx)
  const slots = registered.map((r) => r.definition.name).sort()
  assertEqual(slots, ['main', 'sidebar.footer.action'])
})

test('the foot entry lands in sidebar.footer.action under the panel id', () => {
  const { ctx, registered } = makeCtx()
  activate(ctx)
  bundle.exports.apply(ctx)
  const entry = registered.find((r) => r.definition.name === 'sidebar.footer.action')
  assert(entry !== undefined, 'no footer registration')
  assertEqual(entry.definition.id, 'token-usage')
  assertEqual(typeof entry.definition.label, 'function')
  assertEqual(entry.definition.label(), 'foot.trigger')
})

test('the main panel registers under the same key the foot selects', () => {
  const { ctx, registered } = makeCtx()
  activate(ctx)
  bundle.exports.apply(ctx)
  const panel = registered.find((r) => r.definition.name === 'main')
  assertEqual(panel.definition.key, bundle.exports.PANEL_ID)
})

test('the panel registers before the entry that selects it', () => {
  // layout.selectPanel throws for an unregistered key, so ordering matters.
  const { ctx, registered } = makeCtx()
  activate(ctx)
  bundle.exports.apply(ctx)
  const order = registered.map((r) => r.definition.name)
  assert(order.indexOf('main') < order.indexOf('sidebar.footer.action'), `wrong order: ${order.join(', ')}`)
})

test('the foot entry selects the panel when clicked', () => {
  const { ctx, registered, panels } = makeCtx()
  activate(ctx)
  bundle.exports.apply(ctx)
  const entry = registered.find((r) => r.definition.name === 'sidebar.footer.action')
  const injected = entry.definition.inject()
  injected.onOpen()
  assertEqual(panels, ['token-usage'])
})

test('both registrations hand their component a source and a translator', () => {
  const { ctx, registered } = makeCtx()
  activate(ctx)
  bundle.exports.apply(ctx)
  for (const item of registered) {
    const props = item.definition.inject()
    assert(props.source !== undefined, `${item.definition.name} has no source`)
    assertEqual(typeof props.t, 'function')
  }
})

test('the entry asks for localizable text through its label thunk', () => {
  const { ctx, registered } = makeCtx()
  activate(ctx)
  bundle.exports.apply(ctx)
  const entry = registered.find((r) => r.definition.name === 'sidebar.footer.action')
  assertEqual(typeof entry.definition.label, 'function')
  assertEqual(typeof entry.definition.label(), 'string')
})

test('apply registers an effect for the dictionaries', () => {
  const { ctx, effects } = makeCtx()
  activate(ctx)
  bundle.exports.apply(ctx)
  assert(effects.some((label) => String(label).includes('dictionaries')), `effects: ${effects.join(', ')}`)
})

group('client: no connection')

test('a context without a connection yields an unavailable source', () => {
  const { ctx } = makeCtx()
  activate(ctx)
  // `ctx.connection` is absent and `ctx.get` is not even defined.
  const rpc = bundle.exports.connectionRpc(ctx)
  assertEqual(rpc.available, false)
  assertEqual(rpc.call, undefined)
})

test('a connection whose rpc lacks call is treated as unavailable', () => {
  const rpc = bundle.exports.connectionRpc({ connection: { rpc: {} } })
  assertEqual(rpc.available, false)
})

test('a throwing connection getter is contained', () => {
  const ctx = {
    get connection() {
      throw new Error('nope')
    },
  }
  const rpc = bundle.exports.connectionRpc(ctx)
  assertEqual(rpc.available, false)
})

test('a working connection calls the plugin endpoint on /api', async () => {
  const calls = []
  const ctx = {
    connection: {
      rpc: {
        call: async (channel, endpoint, payload) => {
          calls.push({ channel, endpoint, payload })
          // The real carrier answers with a RESULT ENVELOPE, not the payload.
          return { ok: true, value: { marker: 'payload' } }
        },
      },
    },
  }
  const rpc = bundle.exports.connectionRpc(ctx)
  assertEqual(rpc.available, true)
  const value = await rpc.call('dashboard', { range: 'today' })
  assertEqual(calls.length, 1)
  assertEqual(calls[0].channel, '/api')
  assertEqual(calls[0].endpoint, 'token-dashboard')
  assertEqual(calls[0].payload, { method: 'dashboard', payload: { range: 'today' } })
  // The envelope must be unwrapped: storing it raw is what blanked the page.
  assertEqual(value, { marker: 'payload' })
})

test('a failed envelope becomes a thrown error carrying the host message', async () => {
  const rpc = bundle.exports.connectionRpc({
    connection: {
      rpc: { call: async () => ({ ok: false, error: { code: 'boom', message: 'handler exploded' } }) },
    },
  })
  let caught
  try {
    await rpc.call('dashboard', {})
  } catch (error) {
    caught = error
  }
  assert(caught !== undefined, 'expected a throw')
  assertEqual(caught.message, 'handler exploded')
})

test('a failed envelope without a message falls back to its code', async () => {
  const rpc = bundle.exports.connectionRpc({
    connection: { rpc: { call: async () => ({ ok: false, error: { code: 'no-message' } }) } },
  })
  let caught
  try {
    await rpc.call('dashboard', {})
  } catch (error) {
    caught = error
  }
  assertEqual(caught.message, 'no-message')
})

test('a malformed envelope is rejected rather than stored', async () => {
  const rpc = bundle.exports.connectionRpc({
    connection: { rpc: { call: async () => null } },
  })
  let caught
  try {
    await rpc.call('dashboard', {})
  } catch (error) {
    caught = error
  }
  assert(caught !== undefined, 'expected a throw')
})

test('a carrier returning a bare value is accepted', async () => {
  const rpc = bundle.exports.connectionRpc({
    connection: { rpc: { call: async () => ({ days: [] }) } },
  })
  assertEqual(await rpc.call('dashboard', {}), { days: [] })
})

test('an envelope is unwrapped end to end through the source', async () => {
  // The exact shape the Host produces on the wire: `{ ok: true, value }`.
  // `connectionRpc` unwraps that envelope, and the source consumes the bare
  // dashboard payload — so wiring them together proves the full path.
  const rpc = bundle.exports.connectionRpc({
    connection: {
      rpc: {
        call: async () => ({ ok: true, value: { range: 'today', days: [], totals: { totalTokens: 9 } } }),
      },
    },
  })
  const source = bundle.exports.createSource(rpc)
  await source.loadToday()
  const snapshot = source.getSnapshot()
  assertEqual(snapshot.today.status, 'ready')
  // `totals` must be reachable directly — the bug made this undefined.
  assertEqual(snapshot.today.data.totals.totalTokens, 9)
})

test('the source reports unavailable without touching the network', async () => {
  const source = bundle.exports.createSource({ available: false, call: undefined })
  await source.loadToday()
  assertEqual(source.getSnapshot().today.status, 'unavailable')
  await source.loadPage('7d')
  assertEqual(source.getSnapshot().page.status, 'unavailable')
})

test('a successful load publishes the payload', async () => {
  const source = bundle.exports.createSource({
    available: true,
    call: async () => ({ range: 'today', totals: { totalTokens: 5 } }),
  })
  await source.loadToday()
  const snapshot = source.getSnapshot()
  assertEqual(snapshot.today.status, 'ready')
  assertEqual(snapshot.today.data.totals.totalTokens, 5)
})

test('a rejected load becomes an error state, not a throw', async () => {
  const source = bundle.exports.createSource({
    available: true,
    call: async () => {
      throw new Error('boom')
    },
  })
  await source.loadToday()
  const snapshot = source.getSnapshot()
  assertEqual(snapshot.today.status, 'error')
  assertEqual(snapshot.today.error, 'boom')
})

test('the page remembers the requested range', async () => {
  const source = bundle.exports.createSource({ available: true, call: async () => ({}) })
  await source.loadPage('30d')
  assertEqual(source.getSnapshot().page.range, '30d')
})

test('a range switch during an in-flight read is not dropped', async () => {
  // Regression: an `inFlight` boolean made the second call return immediately,
  // so a click that landed while the 30s poll was open did nothing at all and
  // the control snapped back to the old range.
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const source = bundle.exports.createSource({
    available: true,
    call: async (method, payload) => {
      if (payload.range === '7d') await gate
      return { range: payload.range, days: [], totals: { totalTokens: payload.range === '7d' ? 7 : 30 } }
    },
  })
  const slow = source.loadPage('7d')
  const fast = source.loadPage('30d')
  await fast
  // The newer request has already published its own range and payload.
  assertEqual(source.getSnapshot().page.range, '30d')
  assertEqual(source.getSnapshot().page.data.totals.totalTokens, 30)
  release()
  await slow
  // The superseded response must not overwrite the newer one.
  assertEqual(source.getSnapshot().page.range, '30d')
  assertEqual(source.getSnapshot().page.data.totals.totalTokens, 30)
  assertEqual(source.getSnapshot().page.status, 'ready')
})

test('a superseded failure does not clobber a newer success', async () => {
  let fail
  const gate = new Promise((_resolve, reject) => {
    fail = reject
  })
  const source = bundle.exports.createSource({
    available: true,
    call: async (method, payload) => {
      if (payload.range === '7d') await gate
      return { range: payload.range, days: [], totals: { totalTokens: 30 } }
    },
  })
  const slow = source.loadPage('7d')
  await source.loadPage('30d')
  fail(new Error('late failure'))
  await slow.catch(() => {})
  const page = source.getSnapshot().page
  assertEqual(page.status, 'ready')
  assertEqual(page.error, '')
  assertEqual(page.range, '30d')
})

test('an aborted read is not reported as a failure', async () => {
  // An abort is the caller unmounting or superseding, not the endpoint failing:
  // showing "read failed" for it painted a red error box for a request nobody
  // was waiting for.
  const source = bundle.exports.createSource({
    available: true,
    call: async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    },
  })
  await source.loadPage('7d')
  const page = source.getSnapshot().page
  assert(page.status !== 'error', `an abort must not become an error state, got ${page.status}`)
  assertEqual(page.error, '')
})

test('a DOMException-shaped abort is recognised too', async () => {
  // A browser fetch abort throws a `DOMException`, which is not an `Error`
  // subclass in every engine, so the check must read the name rather than the
  // prototype chain.
  const source = bundle.exports.createSource({
    available: true,
    call: async () => {
      const abort = { name: 'AbortError', message: 'The operation was aborted.' }
      throw abort
    },
  })
  await source.loadToday()
  const today = source.getSnapshot().today
  assert(today.status !== 'error', `a DOMException abort must not become an error, got ${today.status}`)
})

test('a superseding today read wins over the slower earlier one', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let call = 0
  const source = bundle.exports.createSource({
    available: true,
    call: async () => {
      call += 1
      if (call === 1) await gate
      return { totals: { totalTokens: call === 1 ? 1 : 2 } }
    },
  })
  const first = source.loadToday()
  const second = source.loadToday()
  await second
  release()
  await first
  assertEqual(source.getSnapshot().today.data.totals.totalTokens, 2)
})

test('subscribers are notified on every publish', async () => {
  const source = bundle.exports.createSource({ available: true, call: async () => ({}) })
  let notifications = 0
  const unsubscribe = source.subscribe(() => {
    notifications += 1
  })
  await source.loadToday()
  unsubscribe()
  assert(notifications >= 2, `expected at least a loading and a ready publish, got ${notifications}`)
})

test('a disposed source stops notifying', async () => {
  const source = bundle.exports.createSource({ available: true, call: async () => ({}) })
  let notifications = 0
  source.subscribe(() => {
    notifications += 1
  })
  source.dispose()
  await source.loadToday()
  assertEqual(notifications, 0)
})

group('client: formatting')

test('integers are grouped', () => {
  assertEqual(bundle.exports.__internal.formatInt(1234567), '1,234,567')
})

test('a non-number renders as an em dash', () => {
  assertEqual(bundle.exports.__internal.formatInt(undefined), '—')
  assertEqual(bundle.exports.__internal.formatTokens(null), '—')
})

test('large token counts are abbreviated', () => {
  const f = bundle.exports.__internal.formatTokens
  assertEqual(f(999), '999')
  assertEqual(f(9999), '9,999')
  assertEqual(f(12345), '12.3K')
  assertEqual(f(1234567), '1.23M')
  assertEqual(f(1234567890), '1.23B')
})

test('a rate renders as a percentage, unknown as an em dash', () => {
  assertEqual(bundle.exports.__internal.formatRate(0.9876), '98.8%')
  assertEqual(bundle.exports.__internal.formatRate(null), '—')
})

test('durations switch unit at one second', () => {
  const f = bundle.exports.__internal.formatMs
  assertEqual(f(456), '456 ms')
  assertEqual(f(1234), '1.23 s')
  assertEqual(f(0), '—')
  assertEqual(f(null), '—')
})

test('a day key shortens to month and day', () => {
  assertEqual(bundle.exports.__internal.formatDayShort('2026-10-14'), '10-14')
})

test('the clock formats a timestamp and dashes an empty one', () => {
  assertEqual(bundle.exports.__internal.formatClock(0), '—')
  assertEqual(bundle.exports.__internal.formatClock(Date.UTC(2026, 9, 14, 6, 0, 0)).length, 8)
})

group('client: chart helpers')

test('the peak is the largest cache-inclusive stacked total', () => {
  const peak = bundle.exports.__internal.chartPeak([
    { inputTokens: 10, outputTokens: 5, cacheReadTokens: 900 },
    { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 },
  ])
  assertEqual(peak, 915)
})

test('a cache-only day still contributes to the peak', () => {
  const peak = bundle.exports.__internal.chartPeak([{ inputTokens: 0, outputTokens: 0, cacheReadTokens: 5000 }])
  assertEqual(peak, 5000)
})

test('an empty day list has a zero peak', () => {
  assertEqual(bundle.exports.__internal.chartPeak([]), 0)
})

test('the segments stack cache read, cache write, input, then output', () => {
  const segments = bundle.exports.__internal.columnSegments({
    inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 40,
  })
  assertEqual(segments.map((s) => s.key), ['cache', 'cacheWrite', 'in', 'out'])
  assertEqual(segments.map((s) => s.value), [100, 40, 10, 5])
})

test('the stacked segments sum to the total the KPI card reports', () => {
  // Regression: the bar omitted cache writes while `derive().totalTokens`
  // included them, so on any provider that reports cache writes the bar was
  // drawn shorter than the number printed directly above it.
  const column = {
    inputTokens: 561_654, outputTokens: 147_883,
    cacheReadTokens: 95_797_248, cacheWriteTokens: 400,
  }
  const stacked = bundle.exports.__internal.columnSegments(column)
    .reduce((sum, segment) => sum + segment.value, 0)
  assertEqual(stacked, 96_507_185)
  assertEqual(bundle.exports.__internal.columnTotal(column), stacked)
})

test('a column with no cache writes counts zero for that segment', () => {
  const column = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100 }
  assertEqual(bundle.exports.__internal.columnTotal(column), 115)
  const write = bundle.exports.__internal.columnSegments(column).find((s) => s.key === 'cacheWrite')
  assertEqual(write.value, 0)
})

test('a short range maps one column per day and carries its cache', () => {
  const columns = bundle.exports.__internal.bucketDays([
    { day: '2026-10-13', inputTokens: 1, outputTokens: 2, cacheReadTokens: 7, requests: 1 },
    { day: '2026-10-14', inputTokens: 3, outputTokens: 4, cacheReadTokens: 8, requests: 2 },
  ])
  assertEqual(columns.length, 2)
  assertEqual(columns[0].label, '10-13')
  assertEqual(columns[1].inputTokens, 3)
  assertEqual(columns[0].cacheReadTokens, 7)
  assertEqual(columns[1].cacheReadTokens, 8)
})

test('bucketing sums cache reads across the week', () => {
  const days = []
  for (let i = 0; i < 60; i += 1) {
    days.push({
      day: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      inputTokens: 1, outputTokens: 1, cacheReadTokens: 10,
    })
  }
  const columns = bundle.exports.__internal.bucketDays(days, 30)
  const summed = columns.reduce((total, column) => total + column.cacheReadTokens, 0)
  assertEqual(summed, 600)
})

test('cache writes survive both the per-day and the bucketed path', () => {
  // Regression: `bucketDays` dropped the field entirely, so even once
  // `columnTotal` counted cache writes the bucketed columns had none to count.
  const short = bundle.exports.__internal.bucketDays([
    { day: '2026-10-13', inputTokens: 1, outputTokens: 2, cacheWriteTokens: 9 },
  ])
  assertEqual(short[0].cacheWriteTokens, 9)

  const days = []
  for (let i = 0; i < 60; i += 1) {
    days.push({ day: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, inputTokens: 1, cacheWriteTokens: 5 })
  }
  const columns = bundle.exports.__internal.bucketDays(days, 30)
  const summed = columns.reduce((total, column) => total + column.cacheWriteTokens, 0)
  assertEqual(summed, 300)
})

test('a bucketed column still totals what its segments stack to', () => {
  const days = []
  for (let i = 0; i < 60; i += 1) {
    days.push({
      day: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      inputTokens: 3, outputTokens: 2, cacheReadTokens: 20, cacheWriteTokens: 5,
    })
  }
  for (const column of bundle.exports.__internal.bucketDays(days, 30)) {
    const stacked = bundle.exports.__internal.columnSegments(column)
      .reduce((sum, segment) => sum + segment.value, 0)
    assertEqual(bundle.exports.__internal.columnTotal(column), stacked)
  }
})

test('a long range buckets into at most the column cap', () => {
  const days = []
  for (let i = 0; i < 90; i += 1) {
    days.push({ day: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`, inputTokens: 10, outputTokens: 5, requests: 1 })
  }
  const columns = bundle.exports.__internal.bucketDays(days, 30)
  assert(columns.length <= 30, `expected at most 30 columns, got ${columns.length}`)
  const summedInput = columns.reduce((total, column) => total + column.inputTokens, 0)
  assertEqual(summedInput, 900)
})

test('a bucketed column reports how many days it covers', () => {
  const days = []
  for (let i = 0; i < 60; i += 1) days.push({ day: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, inputTokens: 1, outputTokens: 0 })
  const columns = bundle.exports.__internal.bucketDays(days, 30)
  assert(columns[0].days >= 2, 'expected a multi-day bucket')
})

group('client: calendar heatmap')

/** A day key `offset` days after `2026-10-17`. */
function dayAt(offset) {
  return new Date(Date.UTC(2026, 9, 17) + offset * 86_400_000).toISOString().slice(0, 10)
}

test('a day key parses as a calendar day and round-trips', () => {
  const { parseDayKey, dayKeyOf } = bundle.exports.__internal
  assertEqual(parseDayKey('2026-10-17'), { y: 2026, m: 10, d: 17, ms: Date.UTC(2026, 9, 17) })
  assertEqual(dayKeyOf(Date.UTC(2026, 0, 1)), '2026-01-01')
})

test('a key that is not a real calendar day is rejected, not rolled over', () => {
  // `2026-02-30` would otherwise parse as 2 March and be drawn under February.
  const { parseDayKey } = bundle.exports.__internal
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', 'nope', '', null, 42]) {
    assertEqual(parseDayKey(bad), undefined, `${JSON.stringify(bad)} should be rejected`)
  }
})

test('the window is a year ending on the Host\'s current day', () => {
  // Not the UTC day: a UTC+8 Host has already started a new day at 16:00 UTC,
  // and anchoring to UTC would drop today's records for the first eight hours.
  const { heatmapWindow } = bundle.exports.__internal
  const now = Date.UTC(2026, 9, 17, 2, 0, 0)
  const model = heatmapWindow([], { now, utcOffsetMinutes: 480 })
  const flat = model.columns.flat().filter((cell) => cell.inside)
  assertEqual(flat.length, 365, 'a year to the day')
  assertEqual(flat[flat.length - 1].day, '2026-10-17', 'the window must end on the Host day')
  assertEqual(flat[0].day, '2025-10-18', 'and start a year earlier')
})

test('the first column starts on a Monday', () => {
  // Without the front padding the weekday rows would not line up with the labels.
  const { heatmapWindow } = bundle.exports.__internal
  const model = bundle.exports.__internal.heatmapWindow([], {
    now: Date.UTC(2026, 9, 17, 2), utcOffsetMinutes: 480,
  })
  const first = model.columns[0][0]
  assertEqual(new Date(`${first.day}T00:00:00Z`).getUTCDay(), 1, `first column starts ${first.day}`)
  for (const column of model.columns) {
    assertEqual(column.length, 7, 'every column is a full week')
  }
})

test('a padding cell is outside the window and carries no level', () => {
  const { heatmapWindow } = bundle.exports.__internal
  const model = bundle.exports.__internal.heatmapWindow([], {
    now: Date.UTC(2026, 9, 17, 2), utcOffsetMinutes: 480,
  })
  const padding = model.columns.flat().filter((cell) => !cell.inside)
  assert(padding.length > 0, 'the window should need padding')
  for (const cell of padding) assertEqual(model.levelOf.has(cell.day), false)
})

test('the grid is padded to a whole number of weeks', () => {
  // A trailing partial week would render six cells beside seven-cell neighbours,
  // with the `Sat`/`Sun` rows simply missing from it.
  const { heatmapWindow } = bundle.exports.__internal
  for (const day of [1, 5, 12, 17, 28]) {
    const model = heatmapWindow([], { now: Date.UTC(2026, 9, day, 2), utcOffsetMinutes: 480 })
    for (const column of model.columns) {
      assertEqual(column.length, 7, `2026-10-${day}: a short column`)
    }
    const last = model.columns[model.columns.length - 1][6]
    assertEqual(new Date(`${last.day}T00:00:00Z`).getUTCDay(), 0,
      `2026-10-${day}: the last column must end on a Sunday`)
  }
})

test('every day in the window is emitted, recorded or not', () => {
  // Gaps are the point of a calendar: skipping an absent day would compress the
  // year and misstate the gaps.
  const { heatmapWindow } = bundle.exports.__internal
  const model = bundle.exports.__internal.heatmapWindow([{ day: dayAt(0), totalTokens: 5, requests: 1 }], {
    now: Date.UTC(2026, 9, 17, 2), utcOffsetMinutes: 480,
  })
  assertEqual(model.columns.flat().filter((cell) => cell.inside).length, 365)
  assertEqual(model.totals.recordedDays, 1)
})

test('a malformed calendar row is skipped rather than breaking the window', () => {
  const { heatmapWindow } = bundle.exports.__internal
  const model = heatmapWindow([
    null, 'nope', { day: 'bad' }, { day: '2026-02-30', totalTokens: 9 },
    { day: dayAt(0), totalTokens: 7, requests: 2 },
  ], { now: Date.UTC(2026, 9, 17, 2), utcOffsetMinutes: 480 })
  assertEqual(model.totals.totalTokens, 7)
  assertEqual(model.totals.recordedDays, 1)
})

test('shades rank the window\'s own days instead of a fixed rate', () => {
  // Fixed thresholds would draw every day of a light user at level 1 and every
  // day of a heavy one at level 4, which says nothing about which days differed.
  const { heatBreaks, heatLevel } = bundle.exports.__internal
  const days = [1, 2, 3, 4, 5, 6, 7, 8].map((tokens) => ({ totalTokens: tokens * 100 }))
  const breaks = heatBreaks(days)
  assertEqual(breaks.length, 3, 'three boundaries give the five shades')
  assertEqual(heatLevel(0, breaks), 0)
  assertEqual(heatLevel(100, breaks), 1)
  assertEqual(heatLevel(800, breaks), 4)
})

test('zero days do not drag the low boundary to zero', () => {
  // Including them would flatten every real day into the top shade.
  const { heatBreaks, heatLevel } = bundle.exports.__internal
  const days = [{ totalTokens: 0 }, { totalTokens: 0 }, { totalTokens: 0 }]
    .concat([1000, 2000, 3000, 4000].map((totalTokens) => ({ totalTokens })))
  const breaks = heatBreaks(days)
  assert(breaks[0] > 0, `the low boundary collapsed to ${breaks[0]}`)
  assertEqual(heatLevel(0, breaks), 0, 'a zero day still has its own level')
  assertEqual(heatLevel(1000, breaks), 1)
})

test('a flat window lands on the middle shade, not the top one', () => {
  const { heatBreaks, heatLevel } = bundle.exports.__internal
  const breaks = heatBreaks([500, 500, 500, 500].map((totalTokens) => ({ totalTokens })))
  for (const total of [500, 900]) {
    assertEqual(heatLevel(total, breaks), 2, `a flat window should read as typical, got ${heatLevel(total, breaks)}`)
  }
})

test('an unranked window puts every recorded day at the top shade', () => {
  const { heatLevel } = bundle.exports.__internal
  assertEqual(heatLevel(5, []), 4)
})

test('a year of random totals uses the full shade range', () => {
  const { heatmapWindow } = bundle.exports.__internal
  const calendar = []
  for (let i = 0; i < 365; i += 1) {
    calendar.push({ day: dayAt(-i), totalTokens: (i * 7919) % 100_000, requests: 1 })
  }
  const model = heatmapWindow(calendar, { now: Date.UTC(2026, 9, 17, 2), utcOffsetMinutes: 480 })
  const used = new Set([...model.levelOf.values()])
  assertEqual([...used].filter((level) => level > 0).sort(), [1, 2, 3, 4], 'every non-empty shade should be reachable')
})

test('every month of the window is labelled exactly once', () => {
  const { heatmapWindow, heatMonthTicks } = bundle.exports.__internal
  const model = heatmapWindow([], { now: Date.UTC(2026, 9, 17, 2), utcOffsetMinutes: 480 })
  const ticks = heatMonthTicks(model.columns)
  assert(ticks.length >= 12, `expected a label per month, got ${ticks.length}`)
  assertEqual(new Set(ticks.map((tick) => tick.month)).size, ticks.length, 'a month was labelled twice')
  for (const tick of ticks) {
    assert(tick.index >= 0 && tick.index < model.columns.length, `tick ${tick.index} is off the grid`)
  }
})

test('the axis step rounds up to a nice number', () => {
  const { niceStep } = bundle.exports.__internal
  assertEqual(niceStep(35_340_000), 50_000_000)
  assertEqual(niceStep(12_500), 20_000)
  assertEqual(niceStep(1), 1)
  assertEqual(niceStep(0.4), 0.5)
  assertEqual(niceStep(0), 0)
  assertEqual(niceStep(-1), 0)
})

test('the axis top covers the peak on round numbers', () => {
  // The whole point of the helper: gridlines land on values a reader can hold
  // in their head, instead of 35.34M / 70.68M / 106.02M / 141.37M.
  const { axisScale } = bundle.exports.__internal
  assertEqual(axisScale(141_370_000), { max: 200_000_000, step: 50_000_000 })
  assertEqual(axisScale(2_000), { max: 2_000, step: 500 })
  assertEqual(axisScale(0), { max: 0, step: 0 })
})

test('every tick of a real peak is a round label', () => {
  const { axisScale, formatAxisTick } = bundle.exports.__internal
  const { max, step } = axisScale(141_370_000)
  const ticks = [0, 1, 2, 3, 4].map((i) => formatAxisTick(step * i, step))
  assertEqual(ticks, ['0', '50M', '100M', '150M', '200M'])
  assertEqual(max, 200_000_000)
})

test('a fractional step keeps exactly the decimals it needs', () => {
  const f = bundle.exports.__internal.formatAxisTick
  assertEqual(f(2_500_000, 2_500_000), '2.5M')
  assertEqual(f(5_000_000, 2_500_000), '5.0M')
})

test('a sub-thousand axis is grouped raw tokens', () => {
  const f = bundle.exports.__internal.formatAxisTick
  assertEqual(f(1_000, 250), '1,000')
  assertEqual(f(250, 250), '250')
})

test('the axis baseline is a bare zero', () => {
  const f = bundle.exports.__internal.formatAxisTick
  assertEqual(f(0, 50_000_000), '0')
  assertEqual(f(0, 500), '0')
})

test('a non-numeric tick is an em dash, never NaN', () => {
  const f = bundle.exports.__internal.formatAxisTick
  assertEqual(f(Number.NaN, 1e6), '—')
  assertEqual(f(undefined, 1e6), '—')
})

group('client: stylesheet contract')

test('the stylesheet carries the layered KPI grids and the two-column card row', () => {
  const { CSS } = bundle.exports.__internal
  for (const rule of ['.tkd_kpiPrimaryRow', '.tkd_kpiSecondaryRow', '.tkd_grid2', '.tkd_chartBox']) {
    assert(CSS.includes(rule), `the stylesheet is missing ${rule}`)
  }
  assert(!CSS.includes('tkd_kpis{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))'),
    'the ragged auto-fit KPI grid is still in the stylesheet')
})

test('cards follow the settings-page surface, not a bare outline', () => {
  const { CSS } = bundle.exports.__internal
  assert(CSS.includes('--dsw-alias-settings-card-fill'), 'cards should use the settings-page fill')
  assert(CSS.includes('--dsw-alias-settings-card-stroke'), 'cards should use the settings-page stroke')
  assert(CSS.includes('--dsw-radius-xl'), 'cards should use the shell radius token')
})

test('a bar and its legend swatch share one opacity', () => {
  // Regression: the bar and swatch opacities were two parallel ladders, and
  // raising the cache-write swatch to make the two cache shades tell apart left
  // the legend promising a shade the bar did not draw. They now read the same
  // variable, so the pair cannot disagree.
  const { CSS } = bundle.exports.__internal
  const pairs = [
    ['tkd_barCache', 'tkd_swatchCache', '--tkd-op-cache'],
    ['tkd_barCacheWrite', 'tkd_swatchCacheWrite', '--tkd-op-cacheWrite'],
    ['tkd_barAlt', 'tkd_swatchAlt', '--tkd-op-in'],
    ['tkd_bar', 'tkd_swatch', '--tkd-op-out'],
  ]
  for (const [bar, swatch, variable] of pairs) {
    const rule = new RegExp(`\\.${bar},\\.${swatch}\\{[^}]*opacity:var\\(${variable}\\)`)
    assert(rule.test(CSS), `${bar} and ${swatch} must share ${variable}`)
  }
  // And the four shades must stay distinguishable from one another.
  const values = [...CSS.matchAll(/--tkd-op-[a-zA-Z]+:([\d.]+)/g)].map((m) => Number(m[1]))
  assertEqual(values.length, 4, 'expected four segment opacities')
  assertEqual(new Set(values).size, 4, `the four segment shades must differ: ${values.join(', ')}`)
})

test('the chart no longer fixes its viewBox with a non-uniform stretch', () => {
  const { CSS } = bundle.exports.__internal
  assert(!CSS.includes('.tkd_chart{width:100%;height:190px'), 'the chart must not pin its own height')
})

test('the tooltip half-width is a real bound on the tooltip', () => {
  // The tooltip is centred on its column and pulled inward at the edges by a
  // hard-coded half-width, so that constant has to be at least half the width
  // the stylesheet allows. A smaller one lets the tooltip overhang the plot.
  const { CSS, TIP_HALF_WIDTH } = bundle.exports.__internal
  const match = /\.tkd_tip\{[^}]*max-width:(\d+)px/.exec(CSS)
  assert(match !== null, 'the tooltip declares no max-width, so the clamp has no real bound')
  const maxWidth = Number(match[1])
  assert(TIP_HALF_WIDTH * 2 >= maxWidth,
    `the clamp (${TIP_HALF_WIDTH}px half-width) is narrower than the tooltip's limit (${maxWidth}px)`)
})

test('the chart carries the tooltip hooks its tests drive', () => {
  const { CSS } = bundle.exports.__internal
  for (const rule of ['.tkd_tip{', '.tkd_hit{', '.tkd_track{', '.tkd_trackOn{']) {
    assert(CSS.includes(rule), `the stylesheet is missing ${rule}`)
  }
  // Gridlines and tick labels must not intercept the pointer, or a hover over
  // the lower part of a column would land on a gridline instead of the hit area.
  assert(/\.tkd_axis,\.tkd_tick\{pointer-events:none\}/.test(CSS),
    'gridlines and tick labels must not swallow the pointer')
})

test('the heatmap shades are one ladder, shared by the grid and its legend', () => {
  // The legend swatch is an inline <svg> carrying the same class as a grid cell,
  // so the two cannot promise different shades. `fill-opacity` rather than
  // `opacity` is what leaves the hover stroke at full strength.
  const { CSS, HEAT_LEVELS } = bundle.exports.__internal
  assertEqual(HEAT_LEVELS.length, 5, 'five shades, the empty one included')
  for (const className of HEAT_LEVELS) {
    const rule = new RegExp(`\\.${className}\\{fill:`)
    assert(rule.test(CSS), `${className} declares no fill`)
  }
  assert(/\.tkd_heat4\{[^}]*fill-opacity:1\}/.test(CSS), 'the darkest shade must be the full accent')
  assert(CSS.includes('.tkd_heatOn{stroke:'), 'the hover outline must be a stroke')
  assert(!CSS.includes('.tkd_heatOn{opacity'), 'a hovered cell must keep its own shade')
})

test('the breakpoints are container queries, not viewport ones', () => {
  // The dashboard lives in a resizable main pane, so a wide window with a
  // narrow pane must still reflow. A `@media` breakpoint never fires there:
  // it measures the window, which is not the space this page has.
  const { CSS } = bundle.exports.__internal
  assert(CSS.includes('container:tkd/inline-size'), 'the page must be a query container')
  assert(CSS.includes('@container tkd'), 'the breakpoints must query the panel, not the viewport')
  assert(!/@media \(max-width/.test(CSS), 'a viewport breakpoint would never fire for a narrow pane')
})

test('every class the stylesheet defines is still reachable', () => {
  // Guards the opposite direction from the component assertions: a rule left
  // behind after a refactor is dead weight in a shipped bundle.
  const source = fs.readFileSync(CLIENT, 'utf8')
  const css = bundle.exports.__internal.CSS
  const declared = new Set([...css.matchAll(/\.(tkd_[A-Za-z0-9]+)/g)].map((m) => m[1]))
  const dead = [...declared].filter((name) => !source.includes(`'${name}`) && !source.includes(` ${name}`))
  assertEqual(dead, [], `dead stylesheet rules: ${dead.join(', ')}`)
})

group('client: copy')

test('the two dictionaries carry identical key sets', () => {
  const { zh, en } = bundle.exports.__internal
  assertEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('every key the page needs exists in both dictionaries', () => {
  const { zh, en } = bundle.exports.__internal
  const required = [
    'foot.trigger', 'page.title', 'page.footnote', 'page.refresh',
    'range.today', 'range.7d', 'range.30d', 'range.all',
    'chart.title', 'chart.input', 'chart.output', 'chart.cache', 'chart.cacheWrite',
    'chart.empty', 'chart.aria',
    'kpi.total', 'kpi.nonCached', 'kpi.nonCachedHint', 'kpi.input', 'kpi.output',
    'kpi.cacheRead', 'kpi.reasoning', 'kpi.requests', 'kpi.ttft', 'kpi.avgDuration',
    'table.models', 'table.projects', 'table.purposes', 'table.recent', 'table.empty',
    'col.model', 'col.provider', 'col.total', 'col.input', 'col.output', 'col.cacheRead',
    'col.requests', 'col.ttft', 'col.project', 'col.purpose', 'col.time', 'col.duration', 'col.status',
    'status.ok', 'status.error', 'state.loading', 'state.error', 'state.empty', 'state.noConnection',
    'heat.title', 'heat.subtitle', 'heat.total', 'heat.less', 'heat.more', 'heat.window',
    'heat.days', 'heat.empty', 'heat.aria',
    'heat.day.mon', 'heat.day.tue', 'heat.day.wed', 'heat.day.thu', 'heat.day.fri',
    'heat.day.sat', 'heat.day.sun',
    'heat.month.1', 'heat.month.2', 'heat.month.3', 'heat.month.4', 'heat.month.5', 'heat.month.6',
    'heat.month.7', 'heat.month.8', 'heat.month.9', 'heat.month.10', 'heat.month.11', 'heat.month.12',
  ]
  for (const key of required) {
    assert(typeof zh[key] === 'string', `zh missing ${key}`)
    assert(typeof en[key] === 'string', `en missing ${key}`)
  }
})

test('every month and weekday the calendar can render has a label', () => {
  // The grid indexes these keys by number, so a hole in the dictionary would
  // surface as a missing label rather than as a fallback.
  const { zh, en } = bundle.exports.__internal
  for (const dict of [zh, en]) {
    for (let month = 1; month <= 12; month += 1) {
      assert(typeof dict[`heat.month.${month}`] === 'string', `missing heat.month.${month}`)
    }
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      assert(typeof dict[`heat.day.${day}`] === 'string', `missing heat.day.${day}`)
    }
  }
  // A month label is a month, not a number: `10` beside `Nov` would read as a day.
  assert(!/^\d+$/.test(en['heat.month.10']), 'the month label should not be a bare number')
})

test('the calendar copy says the window is independent of the range', () => {
  const { zh, en } = bundle.exports.__internal
  assert(en['heat.subtitle'].toLowerCase().includes('independent'), 'en must state the window is fixed')
  assert(zh['heat.subtitle'].includes('无关'), 'zh must state the window is fixed')
  assert(zh['heat.days'].includes('{count}'), 'zh recorded-day count must interpolate')
  assert(en['heat.days'].includes('{count}'), 'en recorded-day count must interpolate')
})

test('the footnote names all four chart segments and the day zone', () => {
  const { zh, en } = bundle.exports.__internal
  assert(zh['page.footnote'].includes('{zone}'), 'zh footnote must interpolate the configured zone')
  assert(en['page.footnote'].includes('{zone}'), 'en footnote must interpolate the configured zone')
  assert(zh['page.footnote'].includes('缓存写入'), 'zh footnote should name cache writes')
  assert(en['page.footnote'].includes('writes'), 'en footnote should name cache writes')
})

test('the chart legend names cache writes as well as cache reads', () => {
  const { zh, en } = bundle.exports.__internal
  assert(zh['chart.cacheWrite'] !== zh['chart.cache'], 'the two cache segments need distinct labels')
  assert(en['chart.cacheWrite'] !== en['chart.cache'], 'the two cache segments need distinct labels')
  assert(zh['chart.aria'].includes('缓存写入'), 'zh chart aria should describe all four segments')
  assert(en['chart.aria'].includes('cache writes'), 'en chart aria should describe all four segments')
})

test('a UTC offset renders as a label the footnote can use', () => {
  const f = bundle.exports.__internal.formatUtcOffset
  assertEqual(f(480), 'UTC+8')
  assertEqual(f(0), 'UTC±0')
  assertEqual(f(-300), 'UTC-5')
  assertEqual(f(330), 'UTC+5:30')
  assertEqual(f(-570), 'UTC-9:30')
  assertEqual(f(undefined), 'UTC')
  assertEqual(f('abc'), 'UTC')
})

group('client: payload shape')

test('a payload missing its totals block is normalized, not rejected', () => {
  // Regression: the page dereferenced `totals.totalTokens` unguarded, so a
  // payload carrying the series but no totals threw out of render and blanked
  // the whole shell — the exact failure the shape check claimed to prevent.
  const normalized = bundle.exports.__internal.normalizeDashboard({
    days: [], models: [], purposes: [], projects: [], recent: [],
  })
  assert(normalized !== null, 'a payload without totals is still renderable')
  assertEqual(normalized.totals, {})
})

test('a payload missing its meta block is normalized too', () => {
  const normalized = bundle.exports.__internal.normalizeDashboard({
    days: [], models: [], purposes: [], projects: [], recent: [], totals: { totalTokens: 1 },
  })
  assertEqual(normalized.meta, {})
  assertEqual(normalized.totals.totalTokens, 1)
})

test('a payload with a non-record totals is replaced, not trusted', () => {
  const normalized = bundle.exports.__internal.normalizeDashboard({
    days: [], models: [], purposes: [], projects: [], recent: [], totals: 'nonsense',
  })
  assertEqual(normalized.totals, {})
})

test('a payload missing a series array is still rejected', () => {
  const isDashboard = bundle.exports.__internal.isDashboard
  assertEqual(isDashboard({ days: [], models: [], purposes: [], projects: [] }), false)
  assertEqual(isDashboard(null), false)
  assertEqual(isDashboard('nope'), false)
  assertEqual(isDashboard({ days: [], models: [], purposes: [], projects: [], recent: [] }), true)
})

test('the empty state tells the user recording starts at install time', () => {
  const { zh, en } = bundle.exports.__internal
  assert(zh['state.empty'].includes('安装'), 'zh empty state should mention installation')
  assert(en['state.empty'].toLowerCase().includes('installed'), 'en empty state should mention installation')
})

test('the ranges offered match the four the Host accepts', () => {
  assertEqual([...bundle.exports.__internal.RANGES], ['today', '7d', '30d', 'all'])
})

;(async () => {
  process.exit(await report('client-check'))
})().catch((error) => {
  console.error('client-check crashed:', error)
  process.exit(1)
})
