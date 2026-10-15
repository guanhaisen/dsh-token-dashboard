/* Integration checks: drive the real `apply()` against a stub context and
   prove the three pieces are actually wired to each other — the llm/stream
   listener feeds the store, the store feeds the route, and the route answers
   a browser with what the browser half expects. */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { group, test, assert, assertEqual, report } = require('./harness.cjs')

const modulePromise = import('../index.js')

/** A Cordis context stub recording what `apply` does with it. */
function makeCtx(home) {
  const listeners = []
  const effects = []
  const disposers = []
  const injections = []
  const routes = []
  const scopedEffects = []

  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    get(key) {
      if (key === 'profileContext') return { home }
      if (key === 'sessions') return ctx.__sessions
      return undefined
    },
    __sessions: undefined,
    on(event, listener) {
      listeners.push({ event, listener })
    },
    effect(fn, label) {
      effects.push(label)
      const disposer = fn()
      // The real registry calls a returned disposer on unload; capturing it
      // lets a test trigger the plugin's flush-on-dispose path on demand.
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    inject(services, callback) {
      injections.push(services)
      const scoped = {
        ...ctx,
        connection: ctx.__connection,
        effect(fn, label) {
          scopedEffects.push(label)
          return fn()
        },
      }
      callback(scoped)
    },
    __connection: {
      fetch: {
        register(route) {
          routes.push(route)
          return async () => {}
        },
      },
    },
  }
  return { ctx, listeners, effects, disposers, injections, routes, scopedEffects }
}

/** POST one dashboard query at a registered route. */
async function query(route, range) {
  const request = new Request('http://localhost/api/token-dashboard', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'rpc-it',
      method: 'token-dashboard',
      payload: { method: 'dashboard', payload: { range } },
    }),
  })
  const response = await route.fetch(request)
  const envelope = await response.json()
  return envelope.result
}

/** Drive one model call through a captured llm/stream listener. */
async function callModel(listener, options, chunks) {
  const stream = listener(options, () => (async function* () {
    for (const chunk of chunks) yield chunk
  })())
  for await (const _chunk of stream) {
    /* drain */
  }
}

/** A temp home so the integration run never touches the real ledger. */
function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tkd-'))
}

async function main() {
  const mod = await modulePromise

  group('integration: wiring')

  test('apply registers exactly one llm/stream listener and one route', () => {
    const home = tempHome()
    const { ctx, listeners, routes } = makeCtx(home)
    mod.apply(ctx, mod.DEFAULTS)
    const streams = listeners.filter((l) => l.event === 'llm/stream')
    assertEqual(streams.length, 1)
    assertEqual(routes.length, 1)
    assertEqual(routes[0].path, '/api/token-dashboard')
    assertEqual([...routes[0].methods], ['POST'])
    assertEqual(routes[0].requestBody, 'buffered')
  })

  test('apply declares the llm service and injects connection separately', () => {
    const home = tempHome()
    const { ctx, injections } = makeCtx(home)
    mod.apply(ctx, mod.DEFAULTS)
    assertEqual([...mod.inject], ['llm'])
    assert(injections.some((s) => s.includes('connection')), 'connection must be injected')
  })

  test('apply registers a persistence effect', () => {
    const home = tempHome()
    const { ctx, effects } = makeCtx(home)
    mod.apply(ctx, mod.DEFAULTS)
    assert(effects.some((l) => String(l).includes('persistence')), `effects: ${effects.join(', ')}`)
  })

  group('integration: a call reaches the endpoint')

  test('a recorded call shows up in the dashboard payload', async () => {
    const home = tempHome()
    const { ctx, listeners, routes } = makeCtx(home)
    mod.apply(ctx, mod.DEFAULTS)
    const stream = listeners.find((l) => l.event === 'llm/stream').listener
    const route = routes[0]

    await callModel(stream, { provider: 'workbuddy', model: 'deepseek-v4.1-flash' }, [
      { type: 'text-delta', index: 0, text: 'hi' },
      { type: 'usage', usage: { inputTokens: 1000, outputTokens: 250, cacheReadTokens: 3000, reasoningTokens: 40 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    const result = await query(route, 'today')
    assertEqual(result.ok, true)
    const value = result.value
    assertEqual(value.totals.requests, 1)
    assertEqual(value.totals.inputTokens, 1000)
    assertEqual(value.totals.outputTokens, 250)
    assertEqual(value.totals.cacheReadTokens, 3000)
    // 1000 + 250 + 3000: the cache read is real consumption and belongs in the
    // total, while the non-cached figure stays input+output.
    assertEqual(value.totals.totalTokens, 4250)
    assertEqual(value.totals.nonCachedTokens, 1250)
    assertEqual(value.totals.reasoningTokens, 40)
    assertEqual(value.totals.errors, 0)
    assertEqual(value.recent.length, 1)
    assertEqual(value.recent[0].model, 'deepseek-v4.1-flash')
    assertEqual(value.models.length, 1)
    assertEqual(value.models[0].provider, 'workbuddy')
    assertEqual(value.models[0].totalTokens, 4250)
    assertEqual(value.purposes[0].key, 'chat')
  })

  test('the session cwd is recorded when the session is live', async () => {
    const home = tempHome()
    const { ctx, listeners, routes } = makeCtx(home)
    ctx.__sessions = {
      get: (id) => (id === 'session-live' ? { header: { cwd: 'D:\\work\\thing' } } : undefined),
    }
    mod.apply(ctx, mod.DEFAULTS)
    const stream = listeners.find((l) => l.event === 'llm/stream').listener

    await callModel(stream, { provider: 'p', model: 'm', sessionId: 'session-live' }, [
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    const result = await query(routes[0], 'today')
    assertEqual(result.value.recent[0].cwd, 'D:\\work\\thing')
    assertEqual(result.value.projects.length, 1)
    assertEqual(result.value.projects[0].cwd, 'D:\\work\\thing')
  })

  test('an unknown session is tolerated and simply records no project', async () => {
    const home = tempHome()
    const { ctx, listeners, routes } = makeCtx(home)
    ctx.__sessions = {
      get: () => {
        throw new Error('session store exploded')
      },
    }
    mod.apply(ctx, mod.DEFAULTS)
    const stream = listeners.find((l) => l.event === 'llm/stream').listener

    await callModel(stream, { provider: 'p', model: 'm', sessionId: 'session-gone' }, [
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    const result = await query(routes[0], 'today')
    assertEqual(result.value.totals.requests, 1)
    assertEqual(result.value.projects, [])
  })

  test('trackProjects false records no project dimension', async () => {
    const home = tempHome()
    const { ctx, listeners, routes } = makeCtx(home)
    ctx.__sessions = { get: () => ({ header: { cwd: 'D:\\work' } }) }
    mod.apply(ctx, { ...mod.DEFAULTS, trackProjects: false })
    const stream = listeners.find((l) => l.event === 'llm/stream').listener

    await callModel(stream, { provider: 'p', model: 'm', sessionId: 's' }, [
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    const result = await query(routes[0], 'today')
    assertEqual(result.value.projects, [])
  })

  test('purpose is carried through to its own dimension', async () => {
    const home = tempHome()
    const { ctx, listeners, routes } = makeCtx(home)
    mod.apply(ctx, mod.DEFAULTS)
    const stream = listeners.find((l) => l.event === 'llm/stream').listener

    await callModel(stream, { provider: 'p', model: 'm', purpose: 'compaction' }, [
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    await callModel(stream, { provider: 'p', model: 'm' }, [
      { type: 'usage', usage: { inputTokens: 70, outputTokens: 30 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    const result = await query(routes[0], 'today')
    const purposes = result.value.purposes.map((row) => row.key).sort()
    assertEqual(purposes, ['chat', 'compaction'])
    const compaction = result.value.purposes.find((row) => row.key === 'compaction')
    assertEqual(compaction.totalTokens, 10)
  })

  group('integration: failure handling')

  test('a failed call is recorded as an error and still counted', async () => {
    const home = tempHome()
    const { ctx, listeners, routes } = makeCtx(home)
    mod.apply(ctx, mod.DEFAULTS)
    const stream = listeners.find((l) => l.event === 'llm/stream').listener

    let threw = false
    try {
      const inner = stream({ provider: 'p', model: 'm' }, () => (async function* () {
        throw new Error('transport error')
      })())
      for await (const _chunk of inner) {
        /* drain */
      }
    } catch {
      threw = true
    }
    assert(threw, 'the listener must propagate the inner failure')

    const result = await query(routes[0], 'today')
    assertEqual(result.value.totals.requests, 1)
    assertEqual(result.value.totals.errors, 1)
    assertEqual(result.value.recent[0].ok, false)
  })

  test('a model call is never broken by the recording layer', async () => {
    const home = tempHome()
    const { ctx, listeners } = makeCtx(home)
    mod.apply(ctx, mod.DEFAULTS)
    const stream = listeners.find((l) => l.event === 'llm/stream').listener
    const chunks = [
      { type: 'text-delta', index: 0, text: 'a' },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const seen = []
    for await (const chunk of stream({ provider: 'p', model: 'm' }, () => (async function* () {
      for (const c of chunks) yield c
    })())) seen.push(chunk)
    assertEqual(seen, chunks)
  })

  group('integration: durability')

  test('disposing the plugin flushes the ledger to disk', async () => {
    const home = tempHome()
    const { ctx, listeners, disposers } = makeCtx(home)
    mod.apply(ctx, mod.DEFAULTS)
    const stream = listeners.find((l) => l.event === 'llm/stream').listener

    await callModel(stream, { provider: 'p', model: 'm' }, [
      { type: 'usage', usage: { inputTokens: 42, outputTokens: 8 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    const ledgerPath = path.join(home, 'token-dashboard', 'ledger.json')
    // Unload the plugin exactly as the registry does.
    for (const dispose of disposers) dispose()

    assert(fs.existsSync(ledgerPath), `expected a ledger at ${ledgerPath}`)
    const { state, problem } = mod.__internal.parseLedger(fs.readFileSync(ledgerPath, 'utf-8'))
    assertEqual(problem, null)
    const day = Object.keys(state.days)[0]
    assertEqual(state.days[day].inputTokens, 42)
    assertEqual(state.days[day].outputTokens, 8)
    assertEqual(state.days[day].requests, 1)
  })

  test('a second mount continues from the persisted ledger', async () => {
    const home = tempHome()
    const first = makeCtx(home)
    mod.apply(first.ctx, mod.DEFAULTS)
    const firstStream = first.listeners.find((l) => l.event === 'llm/stream').listener
    await callModel(firstStream, { provider: 'p', model: 'm' }, [
      { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    for (const dispose of first.disposers) dispose()

    // A fresh process would fold this in only at its next flush; the delta
    // merge is what keeps the earlier totals.
    const second = makeCtx(home)
    mod.apply(second.ctx, mod.DEFAULTS)
    const secondStream = second.listeners.find((l) => l.event === 'llm/stream').listener
    await callModel(secondStream, { provider: 'p', model: 'm' }, [
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    for (const dispose of second.disposers) dispose()

    const ledgerPath = path.join(home, 'token-dashboard', 'ledger.json')
    const { state } = mod.__internal.parseLedger(fs.readFileSync(ledgerPath, 'utf-8'))
    const day = Object.keys(state.days)[0]
    assertEqual(state.days[day].requests, 2)
    assertEqual(state.days[day].inputTokens, 105)
    assertEqual(state.days[day].outputTokens, 25)
  })

  process.exit(report('integration-check'))
}

main().catch((error) => {
  console.error('integration-check crashed:', error)
  process.exit(1)
})
