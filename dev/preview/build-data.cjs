/* Build a dashboard payload from the real ledger for the preview page.
   Usage: node dev/preview/build-data.cjs [ledger] [out] */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

async function main() {
  const ledgerPath = process.argv[2] || path.join(os.homedir(), '.dsh', 'token-dashboard', 'ledger.json')
  const outPath = process.argv[3] || path.join(__dirname, 'data.json')
  const { pathToFileURL } = require('node:url')
  const host = await import(pathToFileURL(path.join(__dirname, '..', '..', 'index.js')).href)
  const internal = host.__internal
  const text = fs.readFileSync(ledgerPath, 'utf8')
  const parsed = internal.parseLedger(text)
  const state = parsed.state
  const utcOffsetMinutes = 480
  const now = Date.now()
  const ranges = {}
  for (const range of ['today', '7d', '30d', 'all']) {
    ranges[range] = internal.buildDashboard(state, { range, now, utcOffsetMinutes, recentLimit: 300 })
  }
  fs.writeFileSync(outPath, JSON.stringify(ranges))
  console.log(`wrote ${outPath}`)
  for (const range of Object.keys(ranges)) {
    const payload = ranges[range]
    console.log(`${range}: days=${payload.days.length} total=${payload.totals.totalTokens} requests=${payload.totals.requests} models=${payload.models.length} projects=${payload.projects.length} recent=${payload.recent.length}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
