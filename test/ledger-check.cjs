/* Pure-ledger checks: day boundaries, bucket math, derived values, and the
   defensive parse that keeps a corrupt file from taking the plugin down. */
'use strict'

const { group, test, assert, assertEqual, assertClose, report } = require('./harness.cjs')

const UTC8 = 480
const modulePromise = import('../index.js')

async function main() {
  const { __internal: X } = await modulePromise

  group('ledger: day boundary (UTC+8)')

  test('a stamp just before local midnight stays on the same day', () => {
    // 2026-10-14T15:59:59Z === 2026-10-14 23:59:59 at UTC+8.
    const ts = Date.UTC(2026, 9, 14, 15, 59, 59)
    assertEqual(X.dayKey(ts, UTC8), '2026-10-14')
  })

  test('a stamp at local midnight rolls to the next day', () => {
    // 2026-10-14T16:00:00Z === 2026-10-15 00:00:00 at UTC+8.
    const ts = Date.UTC(2026, 9, 14, 16, 0, 0)
    assertEqual(X.dayKey(ts, UTC8), '2026-10-15')
  })

  test('one millisecond earlier is still the previous day', () => {
    const ts = Date.UTC(2026, 9, 14, 16, 0, 0) - 1
    assertEqual(X.dayKey(ts, UTC8), '2026-10-14')
  })

  test('offset zero uses the UTC calendar day', () => {
    const ts = Date.UTC(2026, 0, 2, 3, 4, 5)
    assertEqual(X.dayKey(ts, 0), '2026-01-02')
  })

  test('a non-numeric stamp degrades to the epoch day instead of NaN', () => {
    assert(X.dayKey(undefined, UTC8).startsWith('19'), 'expected an epoch-era day')
  })

  group('ledger: bucket accumulation')

  test('an unreported call counts as a request but adds no tokens', () => {
    const bucket = X.emptyBucket()
    X.addRecord(bucket, {
      usageReported: false,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 100,
      ttftMs: 0,
      ok: false,
    })
    assertEqual(bucket.requests, 1)
    assertEqual(bucket.reportedRequests, 0)
    assertEqual(bucket.errors, 1)
    assertEqual(bucket.inputTokens, 0)
  })

  test('a reported call folds every token field and both averages', () => {
    const bucket = X.emptyBucket()
    X.addRecord(bucket, {
      usageReported: true,
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 900,
      cacheWriteTokens: 5,
      reasoningTokens: 7,
      durationMs: 2000,
      ttftMs: 500,
      ok: true,
    })
    assertEqual(bucket.requests, 1)
    assertEqual(bucket.reportedRequests, 1)
    assertEqual(bucket.inputTokens, 100)
    assertEqual(bucket.outputTokens, 40)
    assertEqual(bucket.cacheReadTokens, 900)
    assertEqual(bucket.cacheWriteTokens, 5)
    assertEqual(bucket.reasoningTokens, 7)
    assertEqual(bucket.errors, 0)
    assertEqual(bucket.ttftSumMs, 500)
    assertEqual(bucket.ttftCount, 1)
  })

  test('a zero-ttft call contributes no latency sample', () => {
    const bucket = X.emptyBucket()
    X.addRecord(bucket, { usageReported: true, durationMs: 10, ttftMs: 0, ok: true })
    assertEqual(bucket.ttftCount, 0)
    assertEqual(bucket.ttftSumMs, 0)
  })

  test('negative and non-finite counts are clamped to zero', () => {
    const bucket = X.emptyBucket()
    X.addRecord(bucket, {
      usageReported: true,
      inputTokens: -50,
      outputTokens: Number.NaN,
      cacheReadTokens: Number.POSITIVE_INFINITY,
      durationMs: -1,
      ttftMs: -5,
      ok: true,
    })
    assertEqual(bucket.inputTokens, 0)
    assertEqual(bucket.outputTokens, 0)
    assertEqual(bucket.cacheReadTokens, 0)
    assertEqual(bucket.durationMs, 0)
  })

  group('ledger: sub-maps')

  test('a named sub-bucket accumulates independently of its sibling', () => {
    const day = X.emptyBucket()
    const record = { usageReported: true, inputTokens: 10, outputTokens: 5, durationMs: 1, ttftMs: 0, ok: true }
    X.mergeIntoSubMap(day, 'models', 'workbuddy|deepseek-v4.1-flash', record)
    X.mergeIntoSubMap(day, 'models', 'workbuddy|deepseek-v4.1-flash', record)
    X.mergeIntoSubMap(day, 'purposes', 'chat', record)
    assertEqual(day.models['workbuddy|deepseek-v4.1-flash'].inputTokens, 20)
    assertEqual(day.models['workbuddy|deepseek-v4.1-flash'].requests, 2)
    assertEqual(day.purposes.chat.requests, 1)
  })

  test('an empty or missing key is skipped rather than stored', () => {
    const day = X.emptyBucket()
    X.mergeIntoSubMap(day, 'models', '', { usageReported: true, inputTokens: 1, ok: true })
    X.mergeIntoSubMap(day, 'models', undefined, { usageReported: true, inputTokens: 1, ok: true })
    assertEqual(day.models ?? {}, {})
  })

  group('ledger: derived values')

  test('total tokens are input plus output', () => {
    const view = X.derive({ ...X.emptyBucket(), inputTokens: 30, outputTokens: 12 })
    assertEqual(view.totalTokens, 42)
  })

  test('cache hit rate uses input plus cache read as its base', () => {
    const view = X.derive({ ...X.emptyBucket(), inputTokens: 250, cacheReadTokens: 750 })
    assertClose(view.cacheHitRate, 0.75, 1e-9)
  })

  test('an empty denominator yields null, not zero', () => {
    const view = X.derive(X.emptyBucket())
    assertEqual(view.cacheHitRate, null)
    assertEqual(view.avgTtftMs, null)
    assertEqual(view.avgDurationMs, null)
  })

  test('averages round to whole milliseconds', () => {
    const view = X.derive({ ...X.emptyBucket(), requests: 3, durationMs: 1000, ttftSumMs: 1000, ttftCount: 3 })
    assertEqual(view.avgDurationMs, 333)
    assertEqual(view.avgTtftMs, 333)
  })

  test('summarize folds many buckets before deriving', () => {
    const a = { ...X.emptyBucket(), requests: 1, inputTokens: 10, outputTokens: 1 }
    const b = { ...X.emptyBucket(), requests: 2, inputTokens: 20, outputTokens: 2 }
    const view = X.summarize([a, b])
    assertEqual(view.requests, 3)
    assertEqual(view.totalTokens, 33)
  })

  group('ledger: deltas')

  test('a delta carries only fields that grew', () => {
    const base = { '2026-10-14': { ...X.emptyBucket(), requests: 1, inputTokens: 10 } }
    const next = { '2026-10-14': { ...X.emptyBucket(), requests: 3, inputTokens: 10 } }
    const delta = X.bucketDelta(next, base)
    assertEqual(delta['2026-10-14'].requests, 2)
    assertEqual(delta['2026-10-14'].inputTokens, undefined)
  })

  test('nested deltas are carried per key', () => {
    const base = {
      '2026-10-14': {
        ...X.emptyBucket(),
        models: { m: { ...X.emptyBucket(), requests: 1, inputTokens: 5 } },
      },
    }
    const next = {
      '2026-10-14': {
        ...X.emptyBucket(),
        models: {
          m: { ...X.emptyBucket(), requests: 2, inputTokens: 5 },
          n: { ...X.emptyBucket(), requests: 1, inputTokens: 9 },
        },
      },
    }
    const delta = X.bucketDelta(next, base)
    assertEqual(delta['2026-10-14'].models.m.requests, 1)
    assertEqual(delta['2026-10-14'].models.m.inputTokens, undefined)
    assertEqual(delta['2026-10-14'].models.n.inputTokens, 9)
  })

  test('a delta applies back onto a foreign state without double counting', () => {
    const base = { '2026-10-14': { ...X.emptyBucket(), requests: 1, inputTokens: 10 } }
    const next = { '2026-10-14': { ...X.emptyBucket(), requests: 3, inputTokens: 30 } }
    const delta = X.bucketDelta(next, base)
    // Another process already wrote its own contributions to this day.
    const foreign = { '2026-10-14': { ...X.emptyBucket(), requests: 50, inputTokens: 500 } }
    X.applyDelta(foreign, delta)
    assertEqual(foreign['2026-10-14'].requests, 52)
    assertEqual(foreign['2026-10-14'].inputTokens, 520)
  })

  test('an unchanged day produces no delta at all', () => {
    const state = { '2026-10-14': { ...X.emptyBucket(), requests: 7 } }
    assertEqual(X.bucketDelta(state, JSON.parse(JSON.stringify(state))), {})
  })

  group('ledger: retention')

  test('days outside the window are dropped and recent ones kept', () => {
    const days = {
      '2026-10-01': X.emptyBucket(),
      '2026-10-10': X.emptyBucket(),
      '2026-10-14': X.emptyBucket(),
    }
    const now = Date.UTC(2026, 9, 14, 12, 0, 0)
    const removed = X.pruneDays(days, now, 5, UTC8)
    // The window covers 2026-10-10 .. 2026-10-14.
    assertEqual(removed, 1)
    assertEqual(Object.keys(days).sort(), ['2026-10-10', '2026-10-14'])
  })

  test('a one-day window keeps only today', () => {
    const days = { '2026-10-13': X.emptyBucket(), '2026-10-14': X.emptyBucket() }
    const now = Date.UTC(2026, 9, 14, 12, 0, 0)
    X.pruneDays(days, now, 1, UTC8)
    assertEqual(Object.keys(days), ['2026-10-14'])
  })

  group('ledger: defensive parse')

  test('empty text reads as an empty ledger', () => {
    const { state, problem } = X.parseLedger('')
    assertEqual(problem, 'empty')
    assertEqual(state.days, {})
    assertEqual(state.recent, [])
  })

  test('truncated JSON degrades instead of throwing', () => {
    const { state, problem } = X.parseLedger('{"schema":"dsh-token-dashboard/ledger/v1","days":{')
    assertEqual(problem, 'invalid-json')
    assertEqual(state.days, {})
  })

  test('a foreign schema is refused rather than adopted', () => {
    const { problem } = X.parseLedger(JSON.stringify({ schema: 'someone-else/v9', days: {} }))
    assertEqual(problem, 'schema-mismatch')
  })

  test('a non-object days field is refused', () => {
    const { problem } = X.parseLedger(JSON.stringify({ schema: X.SCHEMA, days: [] }))
    assertEqual(problem, 'invalid-days')
  })

  test('a malformed bucket is replaced by a zeroed one, keeping the day', () => {
    const text = JSON.stringify({
      schema: X.SCHEMA,
      days: { '2026-10-14': { requests: 'lots', inputTokens: null }, '2026-10-15': 'nonsense' },
    })
    const { state, problem } = X.parseLedger(text)
    assertEqual(problem, null)
    assertEqual(state.days['2026-10-14'].requests, 0)
    assertEqual(state.days['2026-10-14'].inputTokens, 0)
    assertEqual(state.days['2026-10-15'], undefined)
  })

  test('a valid document round-trips through serialize', () => {
    const original = X.emptyState()
    original.days['2026-10-14'] = { ...X.emptyBucket(), requests: 4, inputTokens: 11 }
    original.recent = [{ ts: 1, provider: 'p', model: 'm', purpose: 'chat', usageReported: true, ok: true }]
    const { state, problem } = X.parseLedger(X.serializeLedger(original))
    assertEqual(problem, null)
    assertEqual(state.days['2026-10-14'].requests, 4)
    assertEqual(state.recent.length, 1)
  })

  test('detail records are normalized and unusable ones dropped', () => {
    const recent = X.mergeRecent([[{ ts: 5, provider: 'p', model: 'm' }, { model: 'no-ts' }, null]], 10)
    assertEqual(recent.length, 1)
    assertEqual(recent[0].ts, 5)
    assertEqual(recent[0].ok, true)
    assertEqual(recent[0].purpose, 'chat')
  })

  test('detail records merge newest first and respect the limit', () => {
    const list = [{ ts: 1 }, { ts: 9 }, { ts: 5 }].map((r) => ({ ...r, provider: 'p', model: 'm' }))
    const recent = X.mergeRecent([list], 2)
    assertEqual(recent.map((r) => r.ts), [9, 5])
  })

  group('ledger: dashboard assembly')

  test('today selects exactly one day', () => {
    const days = { '2026-10-13': {}, '2026-10-14': {} }
    const now = Date.UTC(2026, 9, 14, 6, 0, 0)
    assertEqual(X.selectDays(days, 'today', now, UTC8), ['2026-10-14'])
  })

  test('today on an empty ledger selects nothing', () => {
    assertEqual(X.selectDays({}, 'today', Date.now(), UTC8), [])
  })

  test('7d includes today and the six days before it', () => {
    const days = {}
    for (let i = 0; i < 10; i += 1) days[`2026-10-${String(i + 5).padStart(2, '0')}`] = {}
    const now = Date.UTC(2026, 9, 14, 6, 0, 0)
    const selected = X.selectDays(days, '7d', now, UTC8)
    assertEqual(selected[0], '2026-10-08')
    assertEqual(selected[selected.length - 1], '2026-10-14')
    assertEqual(selected.length, 7)
  })

  test('all returns every recorded day in order', () => {
    const days = { '2026-10-14': {}, '2026-10-09': {} }
    assertEqual(X.selectDays(days, 'all', Date.now(), UTC8), ['2026-10-09', '2026-10-14'])
  })

  test('the payload splits a model key into provider and model', () => {
    const state = X.emptyState()
    // The store writes every call into the day's own counters AND into the
    // sub-maps, so a realistic fixture must populate both.
    const record = {
      usageReported: true,
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 10,
      ttftMs: 0,
      ok: true,
      provider: 'workbuddy',
      model: 'deepseek-v4.1-flash',
      purpose: 'chat',
    }
    const day = X.emptyBucket()
    X.addRecord(day, record)
    X.mergeIntoSubMap(day, 'models', 'workbuddy|deepseek-v4.1-flash', record)
    state.days['2026-10-14'] = day
    const payload = X.buildDashboard(state, {
      range: 'all',
      now: Date.UTC(2026, 9, 14, 6, 0, 0),
      utcOffsetMinutes: UTC8,
      recentLimit: 10,
    })
    assertEqual(payload.models.length, 1)
    assertEqual(payload.models[0].provider, 'workbuddy')
    assertEqual(payload.models[0].model, 'deepseek-v4.1-flash')
    assertEqual(payload.totals.totalTokens, 150)
    assertEqual(payload.models[0].totalTokens, 150)
    assertEqual(payload.meta.firstDay, '2026-10-14')
  })

  test('recent entries outside the range are filtered out', () => {
    const state = X.emptyState()
    state.days['2026-10-14'] = { ...X.emptyBucket(), requests: 1 }
    state.recent = [
      { ts: Date.UTC(2026, 9, 14, 6, 0, 0), day: '2026-10-14', provider: 'p', model: 'm', usageReported: true, ok: true },
      { ts: Date.UTC(2026, 8, 1, 6, 0, 0), day: '2026-09-01', provider: 'p', model: 'm', usageReported: true, ok: true },
    ]
    const payload = X.buildDashboard(state, {
      range: 'today',
      now: Date.UTC(2026, 9, 14, 6, 0, 0),
      utcOffsetMinutes: UTC8,
      recentLimit: 10,
    })
    assertEqual(payload.recent.length, 1)
    assertEqual(payload.recent[0].day, '2026-10-14')
  })

  process.exit(report('ledger-check'))
}

main().catch((error) => {
  console.error('ledger-check crashed:', error)
  process.exit(1)
})
