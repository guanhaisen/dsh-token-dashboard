/* Run every check in its own process, so one crash cannot mask the rest.
   Usage: node test/run-all.cjs */
'use strict'

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const CHECKS = [
  'ledger-check.cjs',
  'store-check.cjs',
  'recorder-check.cjs',
  'route-check.cjs',
  'client-check.cjs',
  'integration-check.cjs',
  'render-check.cjs',
]

let failed = 0
for (const check of CHECKS) {
  const file = path.join(__dirname, check)
  console.log(`\n${'='.repeat(60)}\n${check}\n${'='.repeat(60)}`)
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit' })
  if (result.status !== 0) failed += 1
}

console.log(`\n${'='.repeat(60)}`)
if (failed > 0) {
  console.log(`FAILED: ${failed} of ${CHECKS.length} check files`)
  process.exit(1)
}
console.log(`All ${CHECKS.length} check files passed`)
