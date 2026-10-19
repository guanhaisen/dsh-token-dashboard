/* Preview entry: mounts the real DashboardPage against the real React, the
   shell's real design tokens, and a payload captured from the live ledger.

   URL parameters (all optional), so one build covers every state to review:
     w=1120       pane width in px (the layout is a container query)
     h=1400       pane height in px
     scroll=600   scroll the page by this many px after mount
     theme=dark   sets the shell's dark-theme attribute
     locale=en    English copy
     range=7d     today | 7d | 30d | all

   Not shipped — dev/ is excluded from the package. */
import './loader.js'
import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import * as jsxRuntime from 'react/jsx-runtime'

import '../../client.js'
import data from './data.json'
import { primitives } from './primitives.jsx'
import { registration } from './loader.js'

const captured = registration('dsh-token-dashboard')
if (captured === undefined) throw new Error('the bundle registered no factory')

const plugin = captured.factory((id) => {
  if (id === 'react') return React
  if (id === 'react/jsx-runtime') return jsxRuntime
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected module request: ${id}`)
})

const params = new URLSearchParams(location.search)
const range = params.get('range') ?? '7d'
const width = Number(params.get('w') ?? 1120)
const height = Number(params.get('h') ?? 0)
const scroll = Number(params.get('scroll') ?? 0)
const locale = params.get('locale') ?? 'zh'
const theme = params.get('theme') ?? 'light'
// `state` forces one of the page's non-ready branches, which a real payload
// never reaches from a URL alone: empty, loading, error, or no-connection.
const forced = params.get('state') ?? ''

if (theme === 'dark') document.body.setAttribute('data-ds-dark-theme', '')

const ranges = data
const listeners = new Set()

/**
 * The page slot for one range, as the captured payload shapes it.
 *
 * `state` is honoured here rather than only in the initial snapshot because the
 * page polls on mount: without this, the first poll overwrote the forced state
 * with a ready payload about a frame after paint, and every "empty" or "error"
 * screenshot was silently a screenshot of the normal page.
 */
function pageFor(next) {
  if (forced === 'loading') return { status: 'loading', range: next, data: null, error: '' }
  if (forced === 'error') return { status: 'error', range: next, data: null, error: 'EACCES: ledger.json (permission denied)' }
  if (forced === 'no-connection') return { status: 'idle', range: next, data: null, error: '' }
  const base = ranges[next] ?? ranges['7d']
  const payload = forced === 'empty'
    ? { ...base, days: [], recent: [], calendar: [], models: [], projects: [], purposes: [] }
    : base
  return { status: 'ready', range: next, data: payload, error: '' }
}

let snapshot = {
  connection: forced !== 'no-connection',
  today: { status: 'ready', data: ranges.today, error: '' },
  page: pageFor(range),
}

const source = {
  getSnapshot: () => snapshot,
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  async loadToday() {},
  async loadPage(next) {
    snapshot = { ...snapshot, page: pageFor(next) }
    for (const listener of [...listeners]) listener()
  },
}

const dictionary = (name) => (key) => {
  const text = plugin.__internal[name][key]
  return text === undefined ? key : text
}

// The pane: the real page fills whatever box the main pane gives it.
const root = document.getElementById('root')
root.style.width = `${width}px`
if (height > 0) root.style.height = `${height}px`

const app = ReactDOM.createRoot(root)
app.render(React.createElement(plugin.DashboardPage, { source, t: dictionary(locale) }))

// Scroll once the first paint has laid the page out.
if (scroll > 0) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const page = document.querySelector('.tkd_page')
      if (page !== null) page.scrollTop = scroll
      window.scrollTo(0, scroll)
    })
  })
}

// A footer entry, parked under the page, so its two states can be reviewed too.
const foot = document.getElementById('foot')
if (foot !== null) {
  foot.style.width = `${Number(params.get('footw') ?? width)}px`
  ReactDOM.createRoot(foot).render(
    React.createElement(plugin.FooterTokenButton, {
      wide: params.get('foot') !== 'rail',
      source,
      t: dictionary(locale),
      onOpen: () => {},
    }),
  )
}

window.__plugin = plugin
window.__source = source
