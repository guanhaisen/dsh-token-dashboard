/* Minimal zero-dependency assertion harness for the token-dashboard tests. */
'use strict'

const results = []
const pending = []

function group(name) {
  currentGroup = name
}

let currentGroup = 'ungrouped'

/**
 * Register one test and record whether it passed.
 *
 * The body may be synchronous or asynchronous: a returned promise is tracked so
 * `report` waits for it. This matters — an earlier version called `fn()` and
 * recorded success the moment the promise was created, so every async body's
 * post-`await` assertions were still queued when `process.exit(report(…))`
 * fired and never actually ran. Half the suite was passing vacuously.
 */
function test(name, fn) {
  const result = { group: currentGroup, name, ok: true }
  results.push(result)
  let returned
  try {
    returned = fn()
  } catch (error) {
    result.ok = false
    result.message = error && error.message ? error.message : String(error)
    return
  }
  if (returned !== null && typeof returned === 'object' && typeof returned.then === 'function') {
    pending.push(returned.then(
      () => {},
      (error) => {
        result.ok = false
        result.message = error && error.message ? error.message : String(error)
      },
    ))
  }
}

async function testAsync(name, fn) {
  const result = { group: currentGroup, name, ok: true }
  results.push(result)
  try {
    await fn()
  } catch (error) {
    result.ok = false
    result.message = error && error.message ? error.message : String(error)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed')
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${message || 'values differ'}: got ${a}, expected ${b}`)
}

function assertClose(actual, expected, tolerance, message) {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${message || 'values differ'}: got ${actual}, expected ${expected} ±${tolerance}`)
  }
}

async function assertThrows(fn, message) {
  let threw = false
  try {
    await fn()
  } catch {
    threw = true
  }
  if (!threw) throw new Error(message || 'expected a throw')
}

/**
 * Wait for every registered test to settle, then print and return the exit code.
 *
 * Resolved asynchronously so the caller can `await report(…)` and only then
 * `process.exit`. Without this, async tests would be abandoned mid-flight.
 */
async function report(label) {
  if (pending.length > 0) await Promise.all(pending)
  const failed = results.filter((r) => !r.ok)
  const byGroup = new Map()
  for (const result of results) {
    if (!byGroup.has(result.group)) byGroup.set(result.group, [])
    byGroup.get(result.group).push(result)
  }
  for (const [name, items] of byGroup) {
    const bad = items.filter((r) => !r.ok).length
    console.log(`\n${name}  (${items.length - bad}/${items.length})`)
    for (const item of items) {
      console.log(`  ${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.ok ? '' : `\n       ${item.message}`}`)
    }
  }
  console.log(`\n${label}: ${results.length - failed.length}/${results.length} passed`)
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.length}`)
    return 1
  }
  return 0
}

module.exports = { group, test, testAsync, assert, assertEqual, assertClose, assertThrows, report }
