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
  // The exact shape the Host produces: { ok: true, value: <dashboard> }.
  const source = bundle.exports.createSource({
    available: true,
    call: async (method, payload) => {
      if (method !== 'dashboard') throw new Error('wrong method')
      return { ok: true, value: { range: payload.range, days: [], totals: { totalTokens: 9 } } }
    },
  })
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

test('the segments stack cache, then input, then output', () => {
  const segments = bundle.exports.__internal.columnSegments({
    inputTokens: 10, outputTokens: 5, cacheReadTokens: 100,
  })
  assertEqual(segments.map((s) => s.key), ['cache', 'in', 'out'])
  assertEqual(segments.map((s) => s.value), [100, 10, 5])
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

group('client: copy')

test('the two dictionaries carry identical key sets', () => {
  const { zh, en } = bundle.exports.__internal
  assertEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('every key the page needs exists in both dictionaries', () => {
  const { zh, en } = bundle.exports.__internal
  const required = [
    'foot.trigger', 'page.title', 'range.today', 'range.7d', 'range.30d', 'range.all',
    'chart.title', 'chart.input', 'chart.output', 'chart.cache', 'chart.empty', 'chart.aria',
    'kpi.total', 'kpi.billable', 'kpi.billableHint', 'kpi.input', 'kpi.output',
    'kpi.cacheRead', 'kpi.reasoning', 'kpi.requests', 'kpi.ttft', 'kpi.avgDuration',
    'table.models', 'table.projects', 'table.purposes', 'table.recent', 'table.empty',
    'col.model', 'col.provider', 'col.total', 'col.input', 'col.output', 'col.cacheRead',
    'col.requests', 'col.ttft', 'col.project', 'col.purpose', 'col.time', 'col.duration', 'col.status',
    'status.ok', 'status.error', 'state.loading', 'state.error', 'state.empty', 'state.noConnection',
  ]
  for (const key of required) {
    assert(typeof zh[key] === 'string', `zh missing ${key}`)
    assert(typeof en[key] === 'string', `en missing ${key}`)
  }
})

test('the empty state tells the user recording starts at install time', () => {
  const { zh, en } = bundle.exports.__internal
  assert(zh['state.empty'].includes('安装'), 'zh empty state should mention installation')
  assert(en['state.empty'].toLowerCase().includes('installed'), 'en empty state should mention installation')
})

test('the ranges offered match the four the Host accepts', () => {
  assertEqual([...bundle.exports.__internal.RANGES], ['today', '7d', '30d', 'all'])
})

process.exit(report('client-check'))
