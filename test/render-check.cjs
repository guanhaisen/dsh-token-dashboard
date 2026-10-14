/* Render checks: the two components must survive being rendered in every
   state they can be shown in. Registration alone would not catch a component
   that throws on its first render.
 *
 * There is no React to import here — the DSH install ships none resolvable
 * from this project — so instead of a shallow mock this file *renders* the
 * element tree the components return: it stubs the two `react/jsx-runtime`
 * factories to plain `{type, props, key}` nodes and then walks them into
 * markup. That executes every branch of every component (including the
 * formatting helpers and the chart geometry) without React's reconciler.
 *
 * What it therefore does NOT cover: hook rules and React-specific validity.
 * It does cover everything the components themselves compute. */
'use strict'

const path = require('node:path')
const { group, test, assert, assertEqual, report } = require('./harness.cjs')

/** Minimal React surface: the components only call these. */
const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), ...(children.length > 0 ? { children } : {}) },
  }),
  Fragment: 'Fragment',
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
  // The real hook re-renders on store changes; for a single pass, reading the
  // snapshot once is exactly equivalent.
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

/** jsx/jsxs from react/jsx-runtime: the third argument is the key. */
const jsxRuntime = {
  jsx: (type, props, key) => ({ type, props: props ?? {}, key }),
  jsxs: (type, props, key) => ({ type, props: props ?? {}, key }),
  Fragment: 'Fragment',
}

/** Primitives stand-in: icons and controls become inert named elements. */
const primitives = new Proxy({}, {
  get: (_target, key) => (typeof key === 'string' ? `Primitive:${key}` : undefined),
})

/** Load the bundle under a captured module facade. */
function loadBundle() {
  let registration
  const previous = global.window
  global.window = { __ModuleLoader__: { load: (entry) => { registration = entry } } }
  try {
    const CLIENT = path.join(__dirname, '..', 'client.js')
    delete require.cache[require.resolve(CLIENT)]
    require(CLIENT)
  } finally {
    global.window = previous
  }
  assert(registration !== undefined, 'the bundle registered no factory')
  const requireStub = (id) => {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected module request: ${id}`)
  }
  return registration.factory(requireStub)
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** Escape one text value. */
function escape(value) {
  return String(value).replace(/[&<>"]/g, (c) => ESCAPES[c])
}

/** Render one node (element, array, string, number, null) to markup. */
function renderNode(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (Array.isArray(node)) return node.map(renderNode).join('')
  if (typeof node === 'string' || typeof node === 'number') return escape(node)
  if (typeof node.type === 'function') {
    // A component: call it with the props the owner passed.
    return renderNode(node.type(node.props))
  }
  const { type, props } = node
  const children = renderNode(props?.children)
  if (typeof type !== 'string') {
    // A primitives stand-in, e.g. "Primitive:IconDataOutlineRegular".
    return `<${type}>${children}</${type}>`
  }
  const attributes = Object.entries(props ?? {})
    .filter(([key, value]) => key !== 'children' && key !== 'key' && typeof value !== 'function')
    .map(([key, value]) => {
      if (value === undefined || value === null || value === false) return ''
      // Render React's DOM prop names as the HTML attributes they become.
      const name = key === 'className' ? 'class' : key
      if (value === true) return ` ${name}`
      return ` ${name}="${escape(value)}"`
    })
    .join('')
  return `<${type}${attributes}>${children}</${type}>`
}

/** Render an element to markup. */
function render(element) {
  return renderNode(element)
}

/** A translator that echoes its keys, as the stub locale does. */
const t = (key) => key

/** A source stub in a chosen state. */
function sourceStub(state) {
  return {
    getSnapshot: () => state,
    subscribe: () => () => {},
    loadToday: async () => {},
    loadPage: async () => {},
    dispose: () => {},
  }
}

/** A ready snapshot with a fully populated payload. */
function ready(overrides = {}) {
  return {
    connection: true,
    today: { status: 'ready', data: { totals: { totalTokens: 12345 } }, error: '' },
    page: {
      status: 'ready',
      range: '7d',
      data: {
        range: '7d',
        days: [
          { day: '2026-10-13', inputTokens: 100, outputTokens: 50, requests: 1, totalTokens: 150, cacheHitRate: 0.5, avgTtftMs: 200 },
          { day: '2026-10-14', inputTokens: 200, outputTokens: 80, requests: 2, totalTokens: 280, cacheHitRate: null, avgTtftMs: null },
        ],
        totals: {
          requests: 3, reportedRequests: 3, errors: 1,
          inputTokens: 300, outputTokens: 130, cacheReadTokens: 900,
          cacheWriteTokens: 0, reasoningTokens: 20, durationMs: 3000,
          totalTokens: 430, cacheHitRate: 0.75, avgTtftMs: 200, avgDurationMs: 1000,
        },
        models: [{
          key: 'p|m', provider: 'p', model: 'm', totalTokens: 430, inputTokens: 300,
          outputTokens: 130, cacheReadTokens: 900, requests: 3, avgTtftMs: 200,
        }],
        purposes: [{ key: 'chat', totalTokens: 430, requests: 3 }],
        projects: [{ key: 'D:\\p', cwd: 'D:\\p', totalTokens: 430, requests: 3, cacheReadTokens: 900 }],
        recent: [
          { ts: 1792019631000, provider: 'p', model: 'm', purpose: 'chat', inputTokens: 300, outputTokens: 130, cacheReadTokens: 900, durationMs: 1000, ttftMs: 200, ok: true },
          { ts: 1792019620000, provider: 'p', model: 'm', purpose: 'chat', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, durationMs: 50, ttftMs: 0, ok: false, error: 'boom' },
        ],
        meta: {
          firstDay: '2026-10-13', lastDay: '2026-10-14', recordedDays: 2,
          updatedAt: 1792019631000, utcOffsetMinutes: 480, now: 1792019631000,
        },
      },
      error: '',
    },
    ...overrides,
  }
}

const exports_ = loadBundle()
const { FooterTokenButton, DashboardPage } = exports_

group('render: footer entry')

test('the wide row renders the visible label and the today figure', () => {
  const html = render(React.createElement(FooterTokenButton, {
    wide: true, source: sourceStub(ready()), onOpen: () => {}, t,
  }))
  assert(html.includes('class="tkd_footLabel"'), `visible label span missing: ${html}`)
  assert(html.includes('>foot.trigger<'), `label text missing: ${html}`)
  assert(html.includes('12.3K'), `today figure missing: ${html}`)
})

test('the collapsed rail drops the visible label but keeps the accessible name', () => {
  const html = render(React.createElement(FooterTokenButton, {
    wide: false, source: sourceStub(ready()), onOpen: () => {}, t,
  }))
  assert(html.includes('tkd_footRail'), `rail class missing: ${html}`)
  // The label text must not be rendered as content...
  assert(!html.includes('class="tkd_footLabel"'), `the label span should be gone in the rail: ${html}`)
  assert(!html.includes('tkd_footValue'), `the figure span should be gone in the rail: ${html}`)
  // ...but the button must still be named for assistive tech and on hover.
  assert(html.includes('aria-label="foot.trigger"'), `accessible name missing: ${html}`)
  assert(html.includes('title='), 'the hover title should survive collapsing')
})

test('the entry is a real button with an accessible name', () => {
  const html = render(React.createElement(FooterTokenButton, {
    wide: true, source: sourceStub(ready()), onOpen: () => {}, t,
  }))
  assert(html.includes('<button'), 'expected a button element')
  assert(html.includes('type="button"'), 'expected an explicit button type')
})

test('a loading foot renders without a figure', () => {
  const state = ready({ today: { status: 'loading', data: null, error: '' } })
  const html = render(React.createElement(FooterTokenButton, {
    wide: true, source: sourceStub(state), onOpen: () => {}, t,
  }))
  assert(html.includes('foot.trigger'), html)
  assert(!html.includes('12.3K'), 'no figure should render while loading')
})

test('a failed today read still renders the entry', () => {
  const state = ready({ today: { status: 'error', data: null, error: 'boom' } })
  const html = render(React.createElement(FooterTokenButton, {
    wide: true, source: sourceStub(state), onOpen: () => {}, t,
  }))
  assert(html.includes('foot.trigger'), html)
})

test('a missing connection still renders the entry', () => {
  const state = ready({
    connection: false,
    today: { status: 'unavailable', data: null, error: 'no-connection' },
  })
  const html = render(React.createElement(FooterTokenButton, {
    wide: true, source: sourceStub(state), onOpen: () => {}, t,
  }))
  assert(html.includes('foot.trigger'), html)
})

group('render: dashboard page')

test('a ready page renders every section', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  for (const marker of ['page.title', 'kpi.total', 'chart.title', 'table.models', 'table.projects', 'table.purposes', 'table.recent']) {
    assert(html.includes(marker), `missing ${marker} in ${html.slice(0, 400)}`)
  }
})

test('the KPI figures are formatted, not raw', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  assert(html.includes('75.0%'), `cache hit rate missing: ${html}`)
  assert(html.includes('200 ms'), `latency missing: ${html}`)
})

test('the chart emits bars for the days it was given', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  assert(html.includes('<svg'), 'no chart svg')
  assert(html.includes('tkd_bar'), 'no bars rendered')
})

test('the chart axis labels are non-empty', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  // A tick label must carry a value; an empty <text></text> is a rendering bug.
  assert(!/<text[^>]*><\/text>/.test(html), `found an empty text node: ${html}`)
})

test('a null cache hit rate renders as an em dash, never a false zero', () => {
  const state = ready()
  state.page.data.totals.cacheHitRate = null
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('—'), 'expected an em dash for an unknown rate')
  assert(!html.includes('0.0%'), 'an unknown rate must not render as 0.0%')
})

test('a failed recent call is marked in the table', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  assert(html.includes('status.error'), 'the failed call should be labelled')
  assert(html.includes('tkd_err'), 'the failed call should carry the error class')
})

test('a successful recent call is marked as ok', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  assert(html.includes('status.ok'), 'the successful call should be labelled')
})

test('the empty state renders when nothing was recorded', () => {
  const state = ready()
  state.page.data.days = []
  state.page.data.recent = []
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('state.empty'), `expected the empty state: ${html.slice(0, 300)}`)
})

test('the loading state renders before the first payload', () => {
  const state = ready({ page: { status: 'loading', range: '7d', data: null, error: '' } })
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('state.loading'), html.slice(0, 300))
})

test('the error state renders the failure text', () => {
  const state = ready({ page: { status: 'error', range: '7d', data: null, error: 'store exploded' } })
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('state.error'), html.slice(0, 300))
  assert(html.includes('store exploded'), html.slice(0, 300))
})

test('the no-connection state renders instead of crashing', () => {
  const state = ready({ connection: false, page: { status: 'idle', range: '7d', data: null, error: '' } })
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('state.noConnection'), html.slice(0, 300))
})

test('the range control is offered with all four ranges', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  assert(html.includes('Primitive:SegmentedControl'), 'expected a segmented control')
})

test('a long range renders without exploding', () => {
  const state = ready()
  state.page.range = 'all'
  state.page.data.days = []
  for (let i = 0; i < 200; i += 1) {
    state.page.data.days.push({
      day: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      inputTokens: i * 10, outputTokens: i * 5, requests: 1, totalTokens: i * 15,
      cacheHitRate: null, avgTtftMs: null,
    })
  }
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('tkd_chart'), 'expected a chart for the long range')
})

test('a day with no tokens renders a zero-height bar, never a negative one', () => {
  const state = ready()
  state.page.data.days = [{ day: '2026-10-14', inputTokens: 0, outputTokens: 0, requests: 0, totalTokens: 0 }]
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(!html.includes('height="-'), 'a negative bar height would be invalid SVG')
})

test('a day with no tokens still produces a chart, not the empty note', () => {
  const state = ready()
  state.page.data.days = [{ day: '2026-10-14', inputTokens: 0, outputTokens: 0, requests: 0, totalTokens: 0 }]
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('tkd_chart'), 'expected a chart even for a zero day')
  assert(!html.includes('chart.empty'), 'the chart should not report itself empty')
})

test('an entirely empty day list shows the chart empty note', () => {
  const state = ready()
  state.page.data.days = []
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('chart.empty'), 'expected the chart empty note')
})

test('a missing meta block does not break the header', () => {
  const state = ready()
  state.page.data.meta = undefined
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('page.title'), html.slice(0, 300))
})

test('a missing totals block rows out every KPI as an em dash', () => {
  const state = ready()
  state.page.data.totals = {}
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('—'), 'expected em dashes for the absent figures')
})

test('an envelope-shaped payload does not blank the page', () => {
  // The regression: the raw RPC result `{ ok, value }` was once stored as the
  // payload, so `data.days` was undefined and indexing it threw mid-render.
  const state = ready()
  state.page.data = { ok: true, value: { range: '7d', days: [] } }
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('page.title'), 'the page must still render its header')
  assert(html.includes('state.empty'), 'an unusable payload must fall back to the empty state')
})

test('a payload without its series arrays does not blank the page', () => {
  for (const missing of ['days', 'models', 'purposes', 'projects', 'recent']) {
    const state = ready()
    delete state.page.data[missing]
    let html
    let threw
    try {
      html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
    } catch (error) {
      threw = error
    }
    assert(threw === undefined, `omitting ${missing} threw: ${threw && threw.message}`)
    assert(html.includes('page.title'), `omitting ${missing} blanked the page`)
  }
})

test('a null payload with an error status still renders the header', () => {
  const state = ready({ page: { status: 'error', range: '7d', data: null, error: 'x' } })
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('page.title'), html.slice(0, 200))
})

test('a non-numeric today total renders no figure rather than NaN', () => {
  const state = ready({ today: { status: 'ready', data: { totals: {} }, error: '' } })
  const html = render(React.createElement(FooterTokenButton, {
    wide: true, source: sourceStub(state), onOpen: () => {}, t,
  }))
  assert(!html.includes('NaN'), `NaN leaked into the row: ${html}`)
  assert(html.includes('foot.trigger'), html)
})

process.exit(report('render-check'))
