/* Route checks: the exact Fetch handler owning /api/token-dashboard must
   reject a malformed envelope, answer the one method, and never leak a throw. */
'use strict'

const { group, test, assert, assertEqual, report } = require('./harness.cjs')

const modulePromise = import('../index.js')

const ENDPOINT = 'token-dashboard'

/** A store stub whose document the test controls. */
function stubStore(state) {
  return {
    read: () => ({ state, problem: null }),
    append: () => {},
    flush: () => true,
    dispose: () => {},
  }
}

/** A populated document for one day. */
function seededState(X) {
  const state = X.emptyState()
  const record = {
    usageReported: true,
    inputTokens: 100,
    outputTokens: 50,
    durationMs: 1000,
    ttftMs: 200,
    ok: true,
    provider: 'workbuddy',
    model: 'deepseek-v4.1-flash',
    purpose: 'chat',
  }
  const day = X.emptyBucket()
  X.addRecord(day, record)
  X.mergeIntoSubMap(day, 'models', 'workbuddy|deepseek-v4.1-flash', record)
  X.mergeIntoSubMap(day, 'purposes', 'chat', record)
  state.days[X.dayKey(record.ts, 480)] = day
  state.recent = [{
    ts: record.ts,
    day: X.dayKey(record.ts, 480),
    provider: 'workbuddy',
    model: 'deepseek-v4.1-flash',
    purpose: 'chat',
    usageReported: true,
    inputTokens: 100,
    outputTokens: 50,
    durationMs: 1000,
    ttftMs: 200,
    ok: true,
  }]
  return state
}

/** Build a route over a stub store. */
function makeRoute(X, state) {
  return X.createRoute({
    store: stubStore(state ?? X.emptyState()),
    config: { ...X.DEFAULTS },
    logger: { warn: () => {} },
  })
}

/** POST one JSON body at a route. */
async function post(route, body, headers = { 'content-type': 'application/json' }) {
  const request = new Request('http://localhost/api/token-dashboard', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const response = await route(request)
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: response.status, text, json }
}

/** One well-formed client request envelope. */
function envelope(method, payload, rpcId = 'rpc-1') {
  return { type: 'client-request', rpcId, method: ENDPOINT, payload: { method, payload } }
}

async function main() {
  const { __internal: X } = await modulePromise

  group('route: method and content type')

  test('a non-POST request is refused with 405', async () => {
    const route = makeRoute(X)
    const response = await route(new Request('http://localhost/api/token-dashboard', { method: 'GET' }))
    assertEqual(response.status, 405)
  })

  test('a non-JSON content type is refused with 415', async () => {
    const route = makeRoute(X)
    const { status } = await post(route, 'hello', { 'content-type': 'text/plain' })
    assertEqual(status, 415)
  })

  test('a body that is not JSON is refused with 400', async () => {
    const route = makeRoute(X)
    const { status } = await post(route, '{not json')
    assertEqual(status, 400)
  })

  test('a content type with a charset still parses', async () => {
    const route = makeRoute(X)
    const { status, json } = await post(route, envelope('dashboard', { range: 'all' }), {
      'content-type': 'application/json; charset=utf-8',
    })
    assertEqual(status, 200)
    assertEqual(json.result.ok, true)
  })

  group('route: envelope validation')

  test('a wrong type field is a bad request', async () => {
    const route = makeRoute(X)
    const { json } = await post(route, { ...envelope('dashboard', {}), type: 'nonsense' })
    assertEqual(json.result.ok, false)
    assertEqual(json.result.error.code, 'token-dashboard/bad-request')
  })

  test('a missing rpcId is a bad request echoed as a placeholder', async () => {
    const route = makeRoute(X)
    const body = envelope('dashboard', {})
    delete body.rpcId
    const { json } = await post(route, body)
    assertEqual(json.rpcId, 'invalid-request')
    assertEqual(json.result.ok, false)
  })

  test('a mismatched endpoint name is a bad request', async () => {
    const route = makeRoute(X)
    const { json } = await post(route, { ...envelope('dashboard', {}), method: 'something-else' })
    assertEqual(json.result.ok, false)
    assertEqual(json.result.error.code, 'token-dashboard/bad-request')
  })

  test('a payload without its own method is a bad request', async () => {
    const route = makeRoute(X)
    const { json } = await post(route, { type: 'client-request', rpcId: 'r1', method: ENDPOINT, payload: {} })
    assertEqual(json.result.ok, false)
  })

  test('the rpcId is echoed back on every response', async () => {
    const route = makeRoute(X)
    const { json } = await post(route, envelope('dashboard', { range: 'all' }, 'rpc-abc'))
    assertEqual(json.rpcId, 'rpc-abc')
    assertEqual(json.type, 'server-response')
  })

  group('route: methods')

  test('an unknown method reports a code rather than throwing', async () => {
    const route = makeRoute(X)
    const { json } = await post(route, envelope('nonsense', {}))
    assertEqual(json.result.ok, false)
    assertEqual(json.result.error.code, 'token-dashboard/unknown-method')
  })

  test('a failed result always carries an error details object', async () => {
    const route = makeRoute(X)
    const { json } = await post(route, envelope('nonsense', {}))
    assertEqual(json.result.error.details, {})
  })

  test('a throwing store surfaces as a handler failure, not a 500', async () => {
    const route = X.createRoute({
      store: {
        read: () => {
          throw new Error('store exploded')
        },
      },
      config: { ...X.DEFAULTS },
      logger: { warn: () => {} },
    })
    const { status, json } = await post(route, envelope('dashboard', {}))
    assertEqual(status, 200)
    assertEqual(json.result.ok, false)
    assertEqual(json.result.error.code, 'token-dashboard/handler-failed')
    assertEqual(json.result.error.message, 'store exploded')
  })

  group('route: dashboard payload')

  test('the default range is 7d when none is asked for', async () => {
    const route = makeRoute(X)
    const { json } = await post(route, envelope('dashboard', {}))
    assertEqual(json.result.value.range, '7d')
  })

  test('an unrecognized range falls back to 7d', async () => {
    const route = makeRoute(X)
    const { json } = await post(route, envelope('dashboard', { range: 'forever' }))
    assertEqual(json.result.value.range, '7d')
  })

  test('each offered range is accepted verbatim', async () => {
    for (const range of ['today', '7d', '30d', 'all']) {
      const route = makeRoute(X)
      const { json } = await post(route, envelope('dashboard', { range }))
      assertEqual(json.result.value.range, range)
    }
  })

  test('the payload carries every section the page renders', async () => {
    const route = makeRoute(X, seededState(X))
    const { json } = await post(route, envelope('dashboard', { range: 'all' }))
    const value = json.result.value
    for (const key of ['range', 'days', 'totals', 'models', 'purposes', 'projects', 'recent', 'meta']) {
      assert(Object.prototype.hasOwnProperty.call(value, key), `missing section: ${key}`)
    }
    assert(Array.isArray(value.days), 'days must be an array')
    assert(Array.isArray(value.models), 'models must be an array')
    assert(Array.isArray(value.recent), 'recent must be an array')
  })

  test('an empty ledger answers with empty sections, not an error', async () => {
    const route = makeRoute(X)
    const { json } = await post(route, envelope('dashboard', { range: 'all' }))
    const value = json.result.value
    assertEqual(value.days, [])
    assertEqual(value.models, [])
    assertEqual(value.recent, [])
    assertEqual(value.totals.requests, 0)
    assertEqual(value.totals.cacheHitRate, null)
    assertEqual(value.meta.firstDay, null)
    assertEqual(value.meta.utcOffsetMinutes, 480)
  })

  test('a populated ledger answers with derived figures', async () => {
    const route = makeRoute(X, seededState(X))
    const { json } = await post(route, envelope('dashboard', { range: 'all' }))
    const value = json.result.value
    assertEqual(value.totals.totalTokens, 150)
    assertEqual(value.models[0].model, 'deepseek-v4.1-flash')
    assertEqual(value.purposes[0].key, 'chat')
    assertEqual(value.meta.recordedDays, 1)
  })

  process.exit(await report('route-check'))
}

main().catch((error) => {
  console.error('route-check crashed:', error)
  process.exit(1)
})
