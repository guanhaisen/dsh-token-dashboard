/* Minimal zero-dependency assertion harness for the token-dashboard tests. */
'use strict'

const results = []

function group(name) {
  currentGroup = name
}

let currentGroup = 'ungrouped'

function test(name, fn) {
  try {
    fn()
    results.push({ group: currentGroup, name, ok: true })
  } catch (error) {
    results.push({
      group: currentGroup,
      name,
      ok: false,
      message: error && error.message ? error.message : String(error),
    })
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    results.push({ group: currentGroup, name, ok: true })
  } catch (error) {
    results.push({
      group: currentGroup,
      name,
      ok: false,
      message: error && error.message ? error.message : String(error),
    })
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

/** Print the collected results and return the process exit code. */
function report(label) {
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
