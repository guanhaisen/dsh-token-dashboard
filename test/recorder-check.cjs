/* Recorder checks: the llm/stream wrapper must be perfectly transparent —
   every chunk through unchanged, every failure rethrown unchanged — while
   still landing exactly one record per call. */
'use strict'

const { group, test, assert, assertEqual, report } = require('./harness.cjs')

const modulePromise = import('../index.js')

/** Collect a stream into an array. */
async function drain(iterable) {
  const out = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

/** One capture sink recording every invocation. */
function sink() {
  const calls = []
  return {
    calls,
    fn: (meta, usage, ttftMs, failure) => {
      calls.push({ meta, usage, ttftMs, failure })
    },
  }
}

/** A meta block as the listener builds it. */
function meta(overrides = {}) {
  return {
    startedAt: Date.now(),
    day: '2026-10-14',
    provider: 'workbuddy',
    model: 'deepseek-v4.1-flash',
    purpose: 'chat',
    sessionId: 'session-test',
    cwd: undefined,
    ...overrides,
  }
}

async function main() {
  const { __internal: X } = await modulePromise

  group('recorder: transparency')

  test('every chunk passes through unchanged and in order', async () => {
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hello' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const captured = sink()
    const seen = await drain(X.recordThroughStream(() => (async function* () {
      for (const chunk of chunks) yield chunk
    })(), meta(), captured.fn))
    assertEqual(seen, chunks)
    // Identity, not a copy: the agent loop compares against these objects.
    assert(seen[0] === chunks[0], 'expected the exact chunk object')
  })

  test('the stream is lazy: nothing runs before it is consumed', async () => {
    let started = false
    const captured = sink()
    const stream = X.recordThroughStream(() => {
      started = true
      return (async function* () {
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    }, meta(), captured.fn)
    assertEqual(started, false)
    await drain(stream)
    assertEqual(started, true)
  })

  test('exactly one record lands for a successful call', async () => {
    const captured = sink()
    await drain(X.recordThroughStream(() => (async function* () {
      yield { type: 'text-delta', index: 0, text: 'x' }
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, reasoningTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(), meta(), captured.fn))
    assertEqual(captured.calls.length, 1)
    const { usage, failure } = captured.calls[0]
    assertEqual(usage.inputTokens, 100)
    assertEqual(usage.cacheReadTokens, 900)
    assertEqual(failure, undefined)
  })

  test('the last usage chunk wins when an attempt reports twice', async () => {
    const captured = sink()
    await drain(X.recordThroughStream(() => (async function* () {
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'usage', usage: { inputTokens: 250, outputTokens: 90 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(), meta(), captured.fn))
    assertEqual(captured.calls[0].usage.inputTokens, 250)
  })

  test('a malformed usage chunk is ignored rather than recorded', async () => {
    const captured = sink()
    await drain(X.recordThroughStream(() => (async function* () {
      yield { type: 'usage', usage: null }
      yield { type: 'usage' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(), meta(), captured.fn))
    assertEqual(captured.calls[0].usage, undefined)
  })

  test('a call with no usage still lands one record', async () => {
    const captured = sink()
    await drain(X.recordThroughStream(() => (async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(), meta(), captured.fn))
    assertEqual(captured.calls.length, 1)
    assertEqual(captured.calls[0].usage, undefined)
  })

  group('recorder: failure paths')

  test('an inner failure is rethrown unchanged', async () => {
    const boom = new Error('transport error')
    const captured = sink()
    const seen = X.recordThroughStream(() => (async function* () {
      yield { type: 'text-delta', index: 0, text: 'partial' }
      throw boom
    })(), meta(), captured.fn)
    let caught
    try {
      await drain(seen)
    } catch (error) {
      caught = error
    }
    assert(caught === boom, 'expected the identical error object to propagate')
  })

  test('a failed call still records, flagged as not ok', async () => {
    const captured = sink()
    try {
      await drain(X.recordThroughStream(() => (async function* () {
        throw new Error('boom')
      })(), meta(), captured.fn))
    } catch {
      /* expected */
    }
    assertEqual(captured.calls.length, 1)
    assertEqual(captured.calls[0].failure.message, 'boom')
  })

  test('a consumer that abandons the stream still records once', async () => {
    const captured = sink()
    const stream = X.recordThroughStream(() => (async function* () {
      yield { type: 'text-delta', index: 0, text: 'a' }
      yield { type: 'text-delta', index: 0, text: 'b' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(), meta(), captured.fn)
    for await (const _chunk of stream) break // stop after the first chunk
    assertEqual(captured.calls.length, 1)
  })

  test('a throwing sink cannot escape into the model lane', async () => {
    const seen = await drain(X.recordThroughStream(() => (async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(), meta(), () => {
      throw new Error('sink exploded')
    }))
    assertEqual(seen.length, 1)
  })

  test('a throwing sink does not swallow the stream error either', async () => {
    const boom = new Error('inner')
    let caught
    try {
      await drain(X.recordThroughStream(() => (async function* () {
        throw boom
      })(), meta(), () => {
        throw new Error('sink exploded')
      }))
    } catch (error) {
      caught = error
    }
    assert(caught === boom, 'expected the inner error, not the sink error')
  })

  group('recorder: record shaping')

  test('a reported call maps every token field', () => {
    const record = X.buildRecord(
      meta({ cwd: 'D:\\proj', sessionId: 'session-1' }),
      { inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 3, reasoningTokens: 8 },
      250,
      undefined,
      1000,
    )
    assertEqual(record.inputTokens, 100)
    assertEqual(record.outputTokens, 40)
    assertEqual(record.cacheReadTokens, 900)
    assertEqual(record.cacheWriteTokens, 3)
    assertEqual(record.reasoningTokens, 8)
    assertEqual(record.ttftMs, 250)
    assertEqual(record.usageReported, true)
    assertEqual(record.ok, true)
    assertEqual(record.cwd, 'D:\\proj')
    assertEqual(record.purpose, 'chat')
  })

  test('an unreported call records zeroes and usageReported false', () => {
    const record = X.buildRecord(meta(), undefined, 0, undefined, 5)
    assertEqual(record.usageReported, false)
    assertEqual(record.inputTokens, 0)
    assertEqual(record.outputTokens, 0)
    assertEqual(record.ok, true)
  })

  test('a failure is recorded with a bounded message', () => {
    const long = new Error('x'.repeat(500))
    const record = X.buildRecord(meta(), { inputTokens: 1, outputTokens: 1 }, 10, long, 20)
    assertEqual(record.ok, false)
    assertEqual(record.error.length, 200)
  })

  test('a non-Error throw is still stringified', () => {
    const record = X.buildRecord(meta(), undefined, 0, 'plain string', 5)
    assertEqual(record.error, 'plain string')
    assertEqual(record.ok, false)
  })

  test('duration is never negative even if the clock steps backwards', () => {
    const record = X.buildRecord(meta({ startedAt: 5000 }), undefined, 0, undefined, 1000)
    assertEqual(record.durationMs, 0)
  })

  test('an absent session id or cwd omits the field entirely', () => {
    const record = X.buildRecord(meta({ sessionId: '', cwd: undefined }), undefined, 0, undefined, 5)
    assert(!Object.prototype.hasOwnProperty.call(record, 'sessionId'), 'sessionId should be omitted')
    assert(!Object.prototype.hasOwnProperty.call(record, 'cwd'), 'cwd should be omitted')
  })

  process.exit(await report('recorder-check'))
}

main().catch((error) => {
  console.error('recorder-check crashed:', error)
  process.exit(1)
})
