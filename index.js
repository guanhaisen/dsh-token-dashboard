/**
 * dsh-token-dashboard — Host half.
 *
 * Records the token usage of every model call from the moment this plugin
 * mounts, aggregates it by day, and serves one read-only RPC the browser half
 * renders as a dashboard.
 *
 * Where the numbers come from
 * ---------------------------
 * `llm/stream` is the one waterfall every provider call passes through
 * (`LlmRuntime.streamWithRegistration`), so a single listener sees all of
 * them — main turns, subagents, compaction and session-title calls alike.
 * Usage arrives in-band as a `{ type: 'usage' }` stream chunk, which is the
 * same source the shipped token ledger reads.
 *
 * Nothing here scans the stored session logs: this plugin records forward from
 * its own mount time, and deliberately does not backfill history.
 *
 * What this half must never do
 * ----------------------------
 * Break the model lane. The listener yields every chunk through untouched,
 * rethrows every failure unchanged (the agent loop reads that failure), and
 * contains all of its own bookkeeping failures to a warning.
 *
 * @module dsh-token-dashboard
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Ledger document identity; a foreign or future document is not adopted. */
const SCHEMA = 'dsh-token-dashboard/ledger/v1'
/** Ledger document revision. */
const VERSION = 1
/** RPC endpoint name; the browser calls `/api` with exactly this. */
const ENDPOINT = 'token-dashboard'
/** Exact shared-channel path this plugin owns. */
const API_PATH = '/api/token-dashboard'
/** State directory name below the DSH home. */
const STATE_DIR_NAME = 'token-dashboard'
/** Ledger file name inside the state directory. */
const LEDGER_FILE_NAME = 'ledger.json'
/** Environment override for the state directory (tests, portable setups). */
const STATE_DIR_ENV = 'DSH_TOKEN_DASHBOARD_STATE_DIR'

/** Default plugin configuration; a plain merge, like the sibling plugins. */
const DEFAULTS = Object.freeze({
  /** Days of daily aggregation kept on disk. */
  retentionDays: 730,
  /** Detail records kept, newest first. */
  recentLimit: 300,
  /** Fixed day boundary offset; 480 is UTC+8. */
  utcOffsetMinutes: 480,
  /** Record the `cwd` dimension. */
  trackProjects: true,
  /** Debounce before a dirty ledger reaches disk. */
  flushDebounceMs: 2000,
})

/** Scalar counters inside one day bucket or one sub-bucket. */
const BUCKET_FIELDS = Object.freeze([
  'requests',
  'reportedRequests',
  'errors',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'durationMs',
  'ttftSumMs',
  'ttftCount',
])

/** Nested breakdowns carried by every day bucket. */
const SUB_MAPS = Object.freeze(['models', 'purposes', 'projects'])

/** One day in milliseconds. */
const DAY_MS = 86_400_000

// ─── pure helpers ──────────────────────────────────────────────────────────
// Everything below this marker is deterministic and free of I/O, so the test
// suite drives it directly through the `__internal` seam at the end of file.

/** Coerce one wire value to a non-negative finite number. */
function count(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.trunc(n))
}

/**
 * The UTC+offset calendar day one timestamp belongs to.
 * @param ts - epoch milliseconds.
 * @param utcOffsetMinutes - fixed offset; 480 for UTC+8.
 * @returns `YYYY-MM-DD`.
 */
function dayKey(ts, utcOffsetMinutes) {
  const shifted = new Date(count(ts) + utcOffsetMinutes * 60_000)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${month}-${day}`
}

/** A zeroed counter set. */
function emptyBucket() {
  const bucket = {}
  for (const field of BUCKET_FIELDS) bucket[field] = 0
  return bucket
}

/** Add one counter set into another in place. */
function mergeBucket(into, from) {
  if (from === null || typeof from !== 'object') return into
  for (const field of BUCKET_FIELDS) into[field] = count(into[field]) + count(from[field])
  return into
}

/**
 * Accumulate one recorded call into a bucket.
 *
 * Counters are only summed when the provider actually reported usage: an
 * unreported call is still a request (and may be an error), but folding its
 * zeroes into the token totals would silently dilute the averages.
 * @param bucket - counter set to mutate.
 * @param record - one normalized usage record.
 */
function addRecord(bucket, record) {
  bucket.requests += 1
  if (record.usageReported) {
    bucket.reportedRequests += 1
    bucket.inputTokens += count(record.inputTokens)
    bucket.outputTokens += count(record.outputTokens)
    bucket.cacheReadTokens += count(record.cacheReadTokens)
    bucket.cacheWriteTokens += count(record.cacheWriteTokens)
    bucket.reasoningTokens += count(record.reasoningTokens)
  }
  if (record.ok !== true) bucket.errors += 1
  bucket.durationMs += count(record.durationMs)
  if (count(record.ttftMs) > 0) {
    bucket.ttftSumMs += count(record.ttftMs)
    bucket.ttftCount += 1
  }
  return bucket
}

/** Fold one record into one named sub-bucket of a day. */
function mergeIntoSubMap(day, name, key, record) {
  if (typeof key !== 'string' || key.length === 0) return
  if (day[name] === undefined) day[name] = {}
  if (day[name][key] === undefined) day[name][key] = emptyBucket()
  addRecord(day[name][key], record)
}

/**
 * Difference between two day maps, field by field.
 *
 * This is what makes a flush safe when two processes (desktop and headless)
 * share one ledger: only what this process added since its last successful
 * write is merged into whatever is on disk now.
 * @param next - current in-memory days.
 * @param base - snapshot taken at the last successful write.
 * @returns a sparse day map holding only non-zero deltas.
 */
function bucketDelta(next, base) {
  const out = {}
  for (const [day, bucket] of Object.entries(next)) {
    const before = base?.[day]
    const delta = {}
    let touched = false
    for (const field of BUCKET_FIELDS) {
      const difference = count(bucket[field]) - count(before?.[field])
      if (difference !== 0) {
        delta[field] = difference
        touched = true
      }
    }
    for (const name of SUB_MAPS) {
      const nested = subMapDelta(bucket[name], before?.[name])
      if (nested !== undefined) {
        delta[name] = nested
        touched = true
      }
    }
    if (touched) out[day] = delta
  }
  return out
}

/** Difference between two sub-maps; `undefined` when nothing changed. */
function subMapDelta(next, base) {
  if (next === undefined) return undefined
  const out = {}
  let touched = false
  for (const [key, bucket] of Object.entries(next)) {
    const before = base?.[key]
    const delta = {}
    for (const field of BUCKET_FIELDS) {
      const difference = count(bucket[field]) - count(before?.[field])
      if (difference !== 0) {
        delta[field] = difference
        touched = true
      }
    }
    if (Object.keys(delta).length > 0) out[key] = delta
  }
  return touched ? out : undefined
}

/** Add a sparse delta (as produced by {@link bucketDelta}) into a day map. */
function applyDelta(target, delta) {
  for (const [day, bucket] of Object.entries(delta)) {
    if (target[day] === undefined) target[day] = emptyBucket()
    for (const field of BUCKET_FIELDS) {
      if (bucket[field] !== undefined) target[day][field] = count(target[day][field]) + count(bucket[field])
    }
    for (const name of SUB_MAPS) {
      const nested = bucket[name]
      if (nested === undefined) continue
      if (target[day][name] === undefined) target[day][name] = {}
      for (const [key, sub] of Object.entries(nested)) {
        if (target[day][name][key] === undefined) target[day][name][key] = emptyBucket()
        for (const field of BUCKET_FIELDS) {
          if (sub[field] !== undefined) {
            target[day][name][key][field] = count(target[day][name][key][field]) + count(sub[field])
          }
        }
      }
    }
  }
  return target
}

/**
 * Drop days older than the retention window.
 * @param days - day map, mutated in place.
 * @param now - current epoch milliseconds.
 * @param retentionDays - window length in days.
 * @param utcOffsetMinutes - fixed day boundary offset.
 * @returns the number of days removed.
 */
function pruneDays(days, now, retentionDays, utcOffsetMinutes) {
  const cutoffKey = dayKey(count(now) - (count(retentionDays) - 1) * DAY_MS, utcOffsetMinutes)
  let removed = 0
  for (const day of Object.keys(days)) {
    if (day < cutoffKey) {
      delete days[day]
      removed += 1
    }
  }
  return removed
}

/** Coerce one persisted bucket into the exact counter shape. */
function normalizeBucket(raw) {
  const bucket = emptyBucket()
  for (const field of BUCKET_FIELDS) bucket[field] = count(raw?.[field])
  for (const name of SUB_MAPS) {
    const nested = raw?.[name]
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) continue
    const target = {}
    for (const [key, value] of Object.entries(nested)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      target[key] = normalizeBucket(value)
    }
    bucket[name] = target
  }
  return bucket
}

/** Coerce one persisted detail record, or `undefined` when unusable. */
function normalizeRecent(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const ts = count(raw.ts)
  if (ts === 0) return undefined
  const record = {
    ts,
    day: typeof raw.day === 'string' ? raw.day : '',
    provider: typeof raw.provider === 'string' ? raw.provider : '',
    model: typeof raw.model === 'string' ? raw.model : '',
    purpose: typeof raw.purpose === 'string' ? raw.purpose : 'chat',
    usageReported: raw.usageReported === true,
    inputTokens: count(raw.inputTokens),
    outputTokens: count(raw.outputTokens),
    cacheReadTokens: count(raw.cacheReadTokens),
    cacheWriteTokens: count(raw.cacheWriteTokens),
    reasoningTokens: count(raw.reasoningTokens),
    durationMs: count(raw.durationMs),
    ttftMs: count(raw.ttftMs),
    ok: raw.ok !== false,
  }
  if (typeof raw.sessionId === 'string' && raw.sessionId.length > 0) record.sessionId = raw.sessionId
  if (typeof raw.cwd === 'string' && raw.cwd.length > 0) record.cwd = raw.cwd
  if (typeof raw.error === 'string' && raw.error.length > 0) record.error = raw.error
  return record
}

/** Stable identity for one detail record, used to merge without double counting. */
function recentKey(record) {
  return [
    record.ts,
    record.provider,
    record.model,
    record.sessionId ?? '',
    record.inputTokens,
    record.outputTokens,
  ].join('|')
}

/** Merge two detail lists: newest first, deduplicated, bounded. */
function mergeRecent(lists, limit) {
  const byKey = new Map()
  for (const list of lists) {
    for (const record of list ?? []) {
      const normalized = normalizeRecent(record)
      if (normalized === undefined) continue
      const key = recentKey(normalized)
      if (!byKey.has(key)) byKey.set(key, normalized)
    }
  }
  return [...byKey.values()].sort((a, b) => b.ts - a.ts).slice(0, Math.max(0, count(limit)))
}

/** A brand-new ledger document. */
function emptyState() {
  return { schema: SCHEMA, version: VERSION, updatedAt: 0, days: {}, recent: [] }
}

/**
 * Parse one ledger document defensively.
 *
 * Every failure mode degrades to an empty ledger carrying a `problem` string
 * rather than throwing: a corrupt file must not take the dashboard — or the
 * plugin — down with it.
 * @param text - raw file contents.
 * @returns `{ state, problem }`; `problem` is `null` for a clean read.
 */
function parseLedger(text) {
  const empty = emptyState()
  if (typeof text !== 'string' || text.trim() === '') return { state: empty, problem: 'empty' }
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return { state: empty, problem: 'invalid-json' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { state: empty, problem: 'invalid-shape' }
  }
  if (raw.schema !== undefined && raw.schema !== SCHEMA) return { state: empty, problem: 'schema-mismatch' }
  if (raw.days !== undefined && (raw.days === null || typeof raw.days !== 'object' || Array.isArray(raw.days))) {
    return { state: empty, problem: 'invalid-days' }
  }
  const days = {}
  for (const [day, bucket] of Object.entries(raw.days ?? {})) {
    if (bucket === null || typeof bucket !== 'object' || Array.isArray(bucket)) continue
    days[day] = normalizeBucket(bucket)
  }
  const recent = Array.isArray(raw.recent)
    ? raw.recent.map(normalizeRecent).filter((record) => record !== undefined)
    : []
  return {
    state: { schema: SCHEMA, version: VERSION, updatedAt: count(raw.updatedAt), days, recent },
    problem: null,
  }
}

/** Serialize one ledger document for disk. */
function serializeLedger(state) {
  return `${JSON.stringify(
    { schema: SCHEMA, version: VERSION, updatedAt: count(state.updatedAt), days: state.days, recent: state.recent },
    null,
    2,
  )}\n`
}

/** Turn one counter set into the derived view the browser renders. */
function derive(bucket) {
  const cacheBase = count(bucket.inputTokens) + count(bucket.cacheReadTokens)
  return {
    requests: count(bucket.requests),
    reportedRequests: count(bucket.reportedRequests),
    errors: count(bucket.errors),
    inputTokens: count(bucket.inputTokens),
    outputTokens: count(bucket.outputTokens),
    cacheReadTokens: count(bucket.cacheReadTokens),
    cacheWriteTokens: count(bucket.cacheWriteTokens),
    reasoningTokens: count(bucket.reasoningTokens),
    durationMs: count(bucket.durationMs),
    totalTokens: count(bucket.inputTokens) + count(bucket.outputTokens),
    // A rate with a zero denominator is unknown, not zero: `null` keeps the
    // browser from drawing "0% cache hit" for a day that had no input at all.
    cacheHitRate: cacheBase > 0 ? count(bucket.cacheReadTokens) / cacheBase : null,
    avgTtftMs: count(bucket.ttftCount) > 0 ? Math.round(count(bucket.ttftSumMs) / count(bucket.ttftCount)) : null,
    avgDurationMs: count(bucket.requests) > 0 ? Math.round(count(bucket.durationMs) / count(bucket.requests)) : null,
  }
}

/** Sum many counter sets and derive the result. */
function summarize(buckets) {
  const total = emptyBucket()
  for (const bucket of buckets) mergeBucket(total, bucket)
  return derive(total)
}

/** Flatten one sub-map into sorted rows of `{ key, ...derived }`. */
function subRows(dayList, name) {
  const merged = new Map()
  for (const day of dayList) {
    for (const [key, bucket] of Object.entries(day[name] ?? {})) {
      if (!merged.has(key)) merged.set(key, emptyBucket())
      mergeBucket(merged.get(key), bucket)
    }
  }
  return [...merged.entries()]
    .map(([key, bucket]) => ({ key, ...derive(bucket) }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests)
}

/**
 * Select the days one range covers.
 * @param days - full day map.
 * @param range - `today` | `7d` | `30d` | `all`.
 * @param now - current epoch milliseconds.
 * @param utcOffsetMinutes - fixed day boundary offset.
 * @returns selected day keys, ascending.
 */
function selectDays(days, range, now, utcOffsetMinutes) {
  const keys = Object.keys(days).sort()
  if (range === 'all') return keys
  if (range === 'today') {
    const key = dayKey(now, utcOffsetMinutes)
    return keys.includes(key) ? [key] : []
  }
  const span = range === '7d' ? 7 : 30
  const cutoffKey = dayKey(count(now) - (span - 1) * DAY_MS, utcOffsetMinutes)
  return keys.filter((key) => key >= cutoffKey)
}

/**
 * Build the whole dashboard payload in one pass.
 *
 * One call per render keeps the browser half simple: it never has to stitch
 * several responses from different log positions together.
 */
function buildDashboard(state, options) {
  const { range, now, utcOffsetMinutes, recentLimit } = options
  const selected = selectDays(state.days, range, now, utcOffsetMinutes)
  const dayList = selected.map((day) => state.days[day])
  const days = selected.map((day) => ({ day, ...derive(state.days[day]) }))
  const allDays = Object.keys(state.days).sort()
  const models = subRows(dayList, 'models').map((row) => {
    const separator = row.key.indexOf('|')
    return {
      ...row,
      provider: separator === -1 ? row.key : row.key.slice(0, separator),
      model: separator === -1 ? '' : row.key.slice(separator + 1),
    }
  })
  const purposes = subRows(dayList, 'purposes')
  const projects = subRows(dayList, 'projects').map((row) => ({ ...row, cwd: row.key }))
  const cutoff = selected.length === 0 ? 0 : Date.parse(`${selected[0]}T00:00:00Z`) - utcOffsetMinutes * 60_000
  return {
    range,
    days,
    totals: summarize(dayList),
    models,
    purposes,
    projects,
    recent: state.recent.filter((record) => record.ts >= cutoff).slice(0, count(recentLimit)),
    meta: {
      firstDay: allDays.length > 0 ? allDays[0] : null,
      lastDay: allDays.length > 0 ? allDays[allDays.length - 1] : null,
      recordedDays: allDays.length,
      updatedAt: count(state.updatedAt),
      utcOffsetMinutes,
      now: count(now),
    },
  }
}

// ─── ledger store ──────────────────────────────────────────────────────────

/** Real filesystem seam; tests substitute a fake with the same shape. */
const defaultIo = Object.freeze({ existsSync, mkdirSync, readFileSync, renameSync, writeFileSync })

/**
 * Create the durable ledger.
 *
 * The store keeps the whole document in memory and flushes debounced deltas,
 * so the hot path (one model call) never touches the disk.
 * @param options - resolved configuration plus the ledger path.
 * @returns the store handle.
 */
function createLedgerStore(options) {
  const {
    path,
    logger,
    retentionDays,
    recentLimit,
    utcOffsetMinutes,
    flushDebounceMs,
    io = defaultIo,
    now = () => Date.now(),
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = options

  const state = emptyState()
  /** Counters as of the last successful write; the delta base. */
  let written = {}
  let timer
  let dirty = false
  let disposed = false

  const warn = (message) => {
    try {
      logger?.warn?.(message)
    } catch {
      /* a logger that throws must not break recording */
    }
  }

  /** Read the document currently on disk. */
  function readDisk() {
    try {
      if (!io.existsSync(path)) return emptyState()
      const { state: parsed, problem } = parseLedger(io.readFileSync(path, 'utf-8'))
      if (problem !== null && problem !== 'empty') warn(`[token-dashboard] ledger unreadable (${problem}); treating it as empty`)
      return parsed
    } catch (error) {
      warn(`[token-dashboard] reading ${path} failed: ${String(error?.message ?? error)}`)
      return emptyState()
    }
  }

  /** Write the merged document atomically. */
  function writeDisk(next) {
    try {
      io.mkdirSync(dirname(path), { recursive: true })
      const temporary = `${path}.tmp`
      io.writeFileSync(temporary, serializeLedger(next), 'utf-8')
      io.renameSync(temporary, path)
      return true
    } catch (error) {
      warn(`[token-dashboard] writing ${path} failed: ${String(error?.message ?? error)}`)
      return false
    }
  }

  /**
   * Fold this process's deltas into the on-disk document.
   *
   * Re-reading first is the whole point: another process may have written
   * since our last flush, and only the difference is ours to add.
   * @returns whether the document reached disk.
   */
  function flush() {
    if (timer !== undefined) {
      clearTimeoutImpl(timer)
      timer = undefined
    }
    dirty = false
    const delta = bucketDelta(state.days, written)
    const disk = readDisk()
    applyDelta(disk.days, delta)
    const merged = {
      ...disk,
      updatedAt: now(),
      recent: mergeRecent([state.recent, disk.recent], recentLimit),
    }
    pruneDays(merged.days, now(), retentionDays, utcOffsetMinutes)
    if (!writeDisk(merged)) return false
    state.updatedAt = merged.updatedAt
    state.recent = merged.recent
    written = JSON.parse(JSON.stringify(state.days))
    return true
  }

  /** Schedule a debounced flush; repeated calls inside the window coalesce. */
  function scheduleFlush() {
    if (disposed) return
    dirty = true
    if (timer !== undefined) return
    timer = setTimeoutImpl(() => {
      timer = undefined
      flush()
    }, flushDebounceMs)
    // Never hold the host process open for a pending bookkeeping write.
    timer?.unref?.()
  }

  return {
    /**
     * Record one finished model call.
     * @param record - normalized usage record.
     */
    append(record) {
      if (disposed) return
      const day = dayKey(record.ts, utcOffsetMinutes)
      if (state.days[day] === undefined) state.days[day] = emptyBucket()
      addRecord(state.days[day], record)
      mergeIntoSubMap(state.days[day], 'models', `${record.provider}|${record.model}`, record)
      mergeIntoSubMap(state.days[day], 'purposes', record.purpose ?? 'chat', record)
      if (record.cwd) mergeIntoSubMap(state.days[day], 'projects', record.cwd, record)
      state.recent = mergeRecent([state.recent, [record]], recentLimit)
      scheduleFlush()
    },
    /** The in-memory document plus the last read diagnostic. */
    read() {
      return { state, problem: null }
    },
    /** Force a synchronous flush (also used on dispose). */
    flush,
    /** Stop the debounce and write whatever is pending. */
    dispose() {
      if (disposed) return
      disposed = true
      if (dirty || timer !== undefined) flush()
      if (timer !== undefined) {
        clearTimeoutImpl(timer)
        timer = undefined
      }
    },
  }
}

// ─── recorder ──────────────────────────────────────────────────────────────

/**
 * Wrap one provider stream so its usage is recorded and every chunk passes
 * through unchanged.
 *
 * The `finally` block is the only place a record is written, so a stream that
 * fails, is cancelled, or ends early still lands exactly one record — and the
 * rethrow keeps the loop's failure path intact.
 * @param openStream - thunk returning the inner stream.
 * @param meta - call facts captured before dispatch.
 * @param sink - receives `(meta, usage, ttftMs, failure)`.
 * @returns the transparent stream.
 */
async function* recordThroughStream(openStream, meta, sink) {
  let usage
  let ttftMs = 0
  let failure
  try {
    for await (const chunk of openStream()) {
      if (ttftMs === 0) ttftMs = Date.now() - meta.startedAt
      if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage' && chunk.usage) {
        // Last usage chunk wins: a retried or restarted attempt reports the
        // numbers that actually settled, matching the shipped ledger's rule.
        usage = chunk.usage
      }
      yield chunk
    }
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      sink(meta, usage, ttftMs, failure)
    } catch {
      /* recording is best-effort and must never mask the stream's outcome */
    }
  }
}

/**
 * Build the normalized detail record for one finished call.
 * @param meta - call facts.
 * @param usage - last reported usage, or `undefined`.
 * @param ttftMs - first-chunk latency, or 0 when no chunk arrived.
 * @param failure - the thrown error, when the stream failed.
 * @param finishedAt - epoch milliseconds at completion.
 */
function buildRecord(meta, usage, ttftMs, failure, finishedAt) {
  const reported = usage !== undefined && usage !== null
  const record = {
    ts: meta.startedAt,
    day: meta.day,
    provider: meta.provider,
    model: meta.model,
    purpose: meta.purpose,
    usageReported: reported,
    inputTokens: reported ? count(usage.inputTokens) : 0,
    outputTokens: reported ? count(usage.outputTokens) : 0,
    cacheReadTokens: reported ? count(usage.cacheReadTokens) : 0,
    cacheWriteTokens: reported ? count(usage.cacheWriteTokens) : 0,
    reasoningTokens: reported ? count(usage.reasoningTokens) : 0,
    durationMs: Math.max(0, finishedAt - meta.startedAt),
    ttftMs: count(ttftMs),
    ok: failure === undefined,
  }
  if (meta.sessionId) record.sessionId = meta.sessionId
  if (meta.cwd) record.cwd = meta.cwd
  if (failure !== undefined) {
    record.error = (failure instanceof Error ? failure.message : String(failure)).slice(0, 200)
  }
  return record
}

// ─── RPC route ─────────────────────────────────────────────────────────────

/** Wrap one handler result in the Connection response envelope. */
function reply(rpcId, result) {
  const value = typeof result === 'object' && result !== null && result.ok === false
    ? { ...result, error: { ...result.error, details: {} } }
    : result
  return Response.json({ type: 'server-response', rpcId, result: value })
}

/**
 * Dispatch one business method.
 * @param method - method name from the envelope.
 * @param payload - method payload.
 * @param context - `{ store, config }`.
 */
async function handleMethod(method, payload, context) {
  if (method !== 'dashboard') {
    return { ok: false, error: { code: 'token-dashboard/unknown-method', message: `Unknown method "${String(method)}".` } }
  }
  const requested = payload?.range
  const range = requested === 'today' || requested === '7d' || requested === '30d' || requested === 'all' ? requested : '7d'
  const { state } = context.store.read()
  const now = Date.now()
  return {
    ok: true,
    value: buildDashboard(state, {
      range,
      now,
      utcOffsetMinutes: context.config.utcOffsetMinutes,
      recentLimit: context.config.recentLimit,
    }),
  }
}

/**
 * Create the exact Fetch route owning `/api/token-dashboard`.
 *
 * The carrier has already applied the Host/Origin fence and browser
 * authentication before this handler runs, so it only validates the envelope.
 * @param context - `{ store, config, logger }`.
 * @returns the Fetch handler.
 */
function createRoute(context) {
  return async function handler(request) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
    const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
    if (contentType !== 'application/json') return new Response('content type must be application/json', { status: 415 })
    let message
    try {
      message = await request.json()
    } catch {
      return new Response('body is not JSON', { status: 400 })
    }
    const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request'
    const call = message?.payload
    if (
      message?.type !== 'client-request'
      || typeof message.rpcId !== 'string'
      || message.method !== ENDPOINT
      || call === null
      || typeof call !== 'object'
      || typeof call.method !== 'string'
      || !Object.prototype.hasOwnProperty.call(call, 'payload')
    ) {
      return reply(rpcId, { ok: false, error: { code: 'token-dashboard/bad-request', message: 'Invalid Token Dashboard request.' } })
    }
    try {
      return reply(rpcId, await handleMethod(call.method, call.payload, context))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      context.logger?.warn?.(`[token-dashboard] ${String(call.method)} failed: ${detail}`)
      return reply(rpcId, { ok: false, error: { code: 'token-dashboard/handler-failed', message: detail } })
    }
  }
}

// ─── plugin ────────────────────────────────────────────────────────────────

/** Cordis plugin name used by loader diagnostics. */
const name = 'dsh-token-dashboard'

/** Required Host services; `connection` is injected separately and optionally. */
const inject = ['llm']

/**
 * Resolve the DSH home, mirroring the shipped plugins' precedence.
 * @param ctx - plugin context.
 */
function resolveStateDir(ctx) {
  const override = process.env[STATE_DIR_ENV]
  if (typeof override === 'string' && override.trim().length > 0) return override.trim()
  const profileHome = ctx.get('profileContext')?.home
  if (typeof profileHome === 'string' && profileHome.length > 0) return profileHome
  const envHome = process.env.DSH_HOME
  if (typeof envHome === 'string' && envHome.trim().length > 0) return envHome.trim()
  return join(homedir(), '.dsh')
}

/**
 * Mount the recorder, the ledger, and the dashboard route.
 * @param ctx - plugin context.
 * @param config - plugin configuration.
 */
function apply(ctx, config) {
  const settings = { ...DEFAULTS, ...(config ?? {}) }
  const logger = ctx.logger

  const stateDir = resolveStateDir(ctx)
  const ledgerPath = join(stateDir, STATE_DIR_NAME, LEDGER_FILE_NAME)
  const store = createLedgerStore({
    path: ledgerPath,
    logger,
    retentionDays: settings.retentionDays,
    recentLimit: settings.recentLimit,
    utcOffsetMinutes: settings.utcOffsetMinutes,
    flushDebounceMs: settings.flushDebounceMs,
  })

  // Flush on unload so the last few calls are not lost to the debounce window.
  ctx.effect(() => () => store.dispose(), 'dsh-token-dashboard: ledger persistence')

  ctx.on(
    'llm/stream',
    (options, next) => {
      const startedAt = Date.now()
      const sessionId = typeof options?.sessionId === 'string' ? options.sessionId : ''
      const meta = {
        startedAt,
        day: dayKey(startedAt, settings.utcOffsetMinutes),
        provider: String(options?.provider ?? ''),
        model: String(options?.model ?? ''),
        purpose: typeof options?.purpose === 'string' ? options.purpose : 'chat',
        sessionId,
        cwd: undefined,
      }
      if (settings.trackProjects && sessionId) {
        // Best effort: a session that is not (or no longer) in the live store
        // simply contributes no project dimension for this call.
        try {
          const cwd = ctx.get('sessions')?.get(sessionId)?.header?.cwd
          if (typeof cwd === 'string' && cwd.length > 0) meta.cwd = cwd
        } catch {
          /* the dimension is optional; never fail a call over it */
        }
      }
      return recordThroughStream(() => next(), meta, (callMeta, usage, ttftMs, failure) => {
        store.append(buildRecord(callMeta, usage, ttftMs, failure, Date.now()))
      })
    },
    { global: true },
  )

  // The dashboard route rides the shared API channel, so it is only mounted
  // when a Connection carrier actually exists in this composition.
  ctx.inject(['connection'], (scoped) => {
    const route = createRoute({ store, config: settings, logger })
    scoped.effect(
      () => scoped.connection.fetch.register({ path: API_PATH, methods: ['POST'], requestBody: 'buffered', fetch: route }),
      'dsh-token-dashboard: api route',
    )
    logger?.info?.(`dsh-token-dashboard: ledger at ${ledgerPath}`)
  })
}

export { apply, inject, name, API_PATH, ENDPOINT, DEFAULTS, SCHEMA }

/** Test seam: the pure helpers and the store factory, exercised by test/*.cjs. */
export const __internal = {
  count,
  dayKey,
  emptyBucket,
  mergeBucket,
  addRecord,
  mergeIntoSubMap,
  bucketDelta,
  applyDelta,
  pruneDays,
  normalizeBucket,
  normalizeRecent,
  mergeRecent,
  recentKey,
  emptyState,
  parseLedger,
  serializeLedger,
  derive,
  summarize,
  selectDays,
  buildDashboard,
  createLedgerStore,
  recordThroughStream,
  buildRecord,
  createRoute,
  handleMethod,
  reply,
  SCHEMA,
  VERSION,
  DEFAULTS,
  BUCKET_FIELDS,
  SUB_MAPS,
}
