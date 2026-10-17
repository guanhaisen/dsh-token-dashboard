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
const { group, test, assert, assertEqual, assertClose, report } = require('./harness.cjs')

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

/** The captured module registration; the bundle is ESM, so it runs once. */
let capturedRegistration

/** Load the bundle under a captured module facade.
 *
 * The bundle is ESM (the package is `type: module`), so `require.cache` does not
 * apply and a second `require` returns the already-executed module without
 * re-registering. The factory takes its module surface as an argument, so the
 * registration is captured once and the factory is simply called again with a
 * different React when a test needs stateful hooks.
 * @param react - the React surface to build the factory with; defaults to the
 *   inert one above, which renders a single pass and cannot change state. */
function loadBundle(react = React) {
  if (capturedRegistration === undefined) {
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
    capturedRegistration = registration
  }
  const requireStub = (id) => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected module request: ${id}`)
  }
  return capturedRegistration.factory(requireStub)
}

/**
 * A React surface whose `useState` really holds state, so a hover can be
 * exercised: the handler a hit area carries is invoked, and the component is
 * then re-rendered the way React would re-render it.
 *
 * Hooks are keyed by call order within a render pass, which is exactly how the
 * components call them (they are not conditional), so the nth `useState` always
 * lands in the same slot.
 */
function makeInteractiveReact() {
  const state = []
  let cursor = 0
  let dirty = false
  const refs = []
  let refCursor = 0
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...(props ?? {}), ...(children.length > 0 ? { children } : {}) },
    }),
    Fragment: 'Fragment',
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (value) => {
      const slot = refCursor
      refCursor += 1
      if (refs[slot] === undefined) refs[slot] = { current: value }
      return refs[slot]
    },
    useState: (initial) => {
      const slot = cursor
      cursor += 1
      if (!(slot in state)) state[slot] = initial
      const set = (next) => {
        state[slot] = typeof next === 'function' ? next(state[slot]) : next
        dirty = true
      }
      return [state[slot], set]
    },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  return {
    react,
    /** Render one element, collecting every element node it produced. */
    render(element) {
      cursor = 0
      refCursor = 0
      const elements = []
      const html = renderCollect(element, elements)
      return { html, elements }
    },
    /** Whether a state setter ran since the last render. */
    get dirty() { return dirty },
    resetDirty() { dirty = false },
  }
}

/** Render a node, pushing every element node into `elements` as it goes. */
function renderCollect(node, elements) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map((child) => renderCollect(child, elements)).join('')
  if (typeof node === 'string' || typeof node === 'number') return escape(node)
  if (typeof node.type === 'function') return renderCollect(node.type(node.props), elements)
  elements.push(node)
  const children = renderCollect(node.props?.children, elements)
  const { type, props } = node
  if (typeof type !== 'string') return `<${type}>${children}</${type}>`
  const attributes = Object.entries(props ?? {})
    .filter(([key, value]) => key !== 'children' && key !== 'key' && typeof value !== 'function')
    .map(([key, value]) => {
      if (value === undefined || value === null || value === false) return ''
      const name = key === 'className' ? 'class' : key
      if (value === true) return ` ${name}`
      return ` ${name}="${escape(value)}"`
    })
    .join('')
  return `<${type}${attributes}>${children}</${type}>`
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

/**
 * A translator backed by the real English dictionary.
 *
 * Needed wherever the assertion is about the *text* rather than about which key
 * was requested: the echo translator returns the key itself, so a placeholder
 * like `{zone}` would never be substituted and could not be checked.
 */
function realT(key) {
  const text = exports_.__internal.en[key]
  return text === undefined ? key : text
}

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
          { day: '2026-10-13', inputTokens: 100, outputTokens: 50, cacheReadTokens: 850, requests: 1, totalTokens: 1000, nonCachedTokens: 150, cacheHitRate: 0.5, avgTtftMs: 200 },
          { day: '2026-10-14', inputTokens: 200, outputTokens: 80, cacheReadTokens: 1720, requests: 2, totalTokens: 2000, nonCachedTokens: 280, cacheHitRate: null, avgTtftMs: null },
        ],
        totals: {
          requests: 3, reportedRequests: 3, errors: 1,
          inputTokens: 300, outputTokens: 130, cacheReadTokens: 2570,
          cacheWriteTokens: 0, reasoningTokens: 20, durationMs: 3000,
          totalTokens: 3000, nonCachedTokens: 430, cacheHitRate: 0.9, avgTtftMs: 200, avgDurationMs: 1000,
        },
        models: [{
          key: 'p|m', provider: 'p', model: 'm', totalTokens: 3000, nonCachedTokens: 430, inputTokens: 300,
          outputTokens: 130, cacheReadTokens: 2570, requests: 3, avgTtftMs: 200,
        }],
        purposes: [{ key: 'chat', totalTokens: 3000, nonCachedTokens: 430, requests: 3 }],
        projects: [{ key: 'D:\\p', cwd: 'D:\\p', totalTokens: 3000, nonCachedTokens: 430, requests: 3, cacheReadTokens: 2570 }],
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
  assert(html.includes('90.0%'), `cache hit rate missing: ${html.slice(0, 700)}`)
  assert(html.includes('200 ms'), `latency missing: ${html.slice(0, 700)}`)
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

test('the total and the non-cached figure are both shown, and differ', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  // Total consumption (3,000) and the non-cached part (430) must both appear:
  // a lone "total tokens" is ambiguous about whether cache is included, and the
  // non-cached figure must not be labelled as a billing figure, because cache
  // reads are billed too.
  assert(html.includes('kpi.total'), 'the total card is missing')
  assert(html.includes('kpi.nonCached'), 'the non-cached card is missing')
  assert(!html.includes('kpi.billable'), 'the misleading billable label is still rendered')
  assert(html.includes('>3,000<'), `the true total is missing: ${html.slice(0, 700)}`)
  assert(html.includes('>430<'), `the non-cached figure is missing: ${html.slice(0, 700)}`)
})

test('no card claims to be a billing total', () => {
  // Cache reads are billed too, just at a lower rate, so a card that excludes
  // them must never be labelled as the billable or cost figure.
  const { zh, en } = exports_.__internal
  for (const [locale, dict] of [['zh', zh], ['en', en]]) {
    const labels = Object.entries(dict).filter(([key]) => key.startsWith('kpi.'))
    for (const [key, text] of labels) {
      const lower = String(text).toLowerCase()
      assert(!lower.includes('billable'), `${locale} ${key} still says "billable"`)
      assert(!lower.includes('计费'), `${locale} ${key} still says 计费`)
      assert(!lower.includes('cost'), `${locale} ${key} implies a cost figure`)
    }
  }
})

test('the chart draws a cache segment below input and output', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  assert(html.includes('tkd_barCache'), 'the cache segment is missing from the chart')
  assert(html.includes('tkd_barAlt'), 'the input segment is missing')
  assert(html.includes('tkd_bar'), 'the output segment is missing')
})

test('the chart legend names all four segments', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  for (const key of ['chart.cache', 'chart.cacheWrite', 'chart.input', 'chart.output']) {
    assert(html.includes(key), `legend entry ${key} is missing`)
  }
})

test('the chart draws a cache-write segment', () => {
  const state = ready()
  state.page.data.days = [{
    day: '2026-10-14', inputTokens: 10, outputTokens: 5,
    cacheReadTokens: 100, cacheWriteTokens: 40, requests: 1, totalTokens: 155,
  }]
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('tkd_barCacheWrite'), 'the cache-write segment is missing')
})

test('a zero cache-write day omits the segment rather than drawing nothing', () => {
  const state = ready()
  state.page.data.days = [{
    day: '2026-10-14', inputTokens: 10, outputTokens: 5,
    cacheReadTokens: 100, cacheWriteTokens: 0, requests: 1, totalTokens: 115,
  }]
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(!html.includes('tkd_barCacheWrite'), 'a zero-width segment should not be emitted')
})

/** Every stacked-bar `height="..."` in the markup, in document order.
 *
 * Matched on a bar `<rect>` rather than on any `height="..."` attribute. The
 * chart's own `<svg>` carries a height, and the hover track rects carry a
 * full-plot height, so a looser match counted both and made a four-segment
 * stack look like five or more. The helper exists to check the stacking
 * geometry, so it counts only the rectangles that carry a bar class. */
function barHeights(html) {
  return [...html.matchAll(/<rect[^>]*class="(tkd_bar[A-Za-z]*)"[^>]*height="([\d.]+)"/g)]
    .map((match) => Number(match[2]))
}

test('a day with cache writes fills the plot exactly, matching the KPI total', () => {
  // Regression: the bar stacked only cache-read + input + output while the KPI
  // card totalled cache-read + cache-write + input + output, so the bar was
  // drawn short by exactly the cache-write share on any provider reporting it.
  // The day totals 2,000, which the axis rounds to 2,000 exactly, so a single
  // peak day must stack to the full plot height (160) — reachable only when
  // every segment the total counts is also drawn.
  const day = {
    day: '2026-10-14',
    inputTokens: 200, outputTokens: 100,
    cacheReadTokens: 1300, cacheWriteTokens: 400,
    requests: 1, totalTokens: 2_000, nonCachedTokens: 300,
    cacheHitRate: 0.9, avgTtftMs: 200,
  }
  const state = ready()
  state.page.data.days = [day]
  state.page.data.totals = { ...state.page.data.totals, ...day }
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  const heights = barHeights(html)
  assertEqual(heights.length, 4, 'expected one rect per segment')
  const stacked = heights.reduce((sum, height) => sum + height, 0)
  assertClose(stacked, 160, 0.5, 'the stacked bar must fill the plot for a peak day')
  // And the card above it shows that same figure.
  assert(html.includes('>2,000<'), `the KPI total should match the bar: ${html.slice(0, 900)}`)
})

test('the bar is scaled against the rounded axis top, not the raw peak', () => {
  // The top gridline is labelled with the axis top, so a bar drawn against the
  // raw peak would touch a gridline that reads as a larger number.
  const day = {
    day: '2026-10-14', inputTokens: 400, outputTokens: 100,
    cacheReadTokens: 900, cacheWriteTokens: 0,
    requests: 1, totalTokens: 1_400,
  }
  const state = ready()
  state.page.data.days = [day]
  state.page.data.totals = { ...state.page.data.totals, ...day }
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  const stacked = barHeights(html).reduce((sum, height) => sum + height, 0)
  // 1,400 against a 2,000 axis top over a 160px plot.
  assertClose(stacked, (1_400 / 2_000) * 160, 0.5, 'the bar must scale to the axis top')
})

test('a day without cache writes still stacks to the full plot', () => {
  const day = {
    day: '2026-10-14',
    inputTokens: 200, outputTokens: 100, cacheReadTokens: 1700, cacheWriteTokens: 0,
    requests: 1, totalTokens: 2_000, nonCachedTokens: 300,
  }
  const state = ready()
  state.page.data.days = [day]
  state.page.data.totals = { ...state.page.data.totals, ...day }
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  const stacked = barHeights(html).reduce((sum, height) => sum + height, 0)
  assertClose(stacked, 160, 0.5, 'a zero cache-write day must still fill the plot')
})

test('the chart scales to the cache-inclusive total', () => {
  // Days of 1,000 and 2,000 total tokens: the axis must reflect those, not the
  // 150/280 non-cached remainder, or the bars would be drawn 6x too tall.
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  assert(html.includes('>2,000<'), `expected a cache-inclusive axis: ${html.slice(0, 900)}`)
})

test('the legend swatches are distinct from one another', () => {
  const state = ready()
  state.page.data.days = [{ day: '2026-10-14', inputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1, totalTokens: 4 }]
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  for (const className of ['tkd_swatchCache', 'tkd_swatchCacheWrite', 'tkd_swatchAlt', 'tkd_swatch']) {
    assert(html.includes(className), `legend swatch ${className} is missing`)
  }
})

test('the refresh control carries an accessible name', () => {
  // The button is icon-only, so without these it announces as just "button".
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  assert(html.includes('aria-label="page.refresh"'), `no accessible name on the refresh button: ${html.slice(0, 1200)}`)
  assert(html.includes('title="page.refresh"'), 'no tooltip on the refresh button')
})

test('the footnote names the configured day boundary, not a hardcoded one', () => {
  // A literal "UTC+8" was wrong for every deployment that changed the setting.
  // The echo translator would hide that (it returns the key, and the key holds
  // the placeholder), so this uses the real dictionary text.
  const state = ready()
  state.page.data.meta = { ...state.page.data.meta, utcOffsetMinutes: -300 }
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t: realT }))
  assert(html.includes('UTC-5'), `expected the configured zone in the footnote: ${html.slice(-700)}`)
  assert(!html.includes('UTC+8'), 'the footnote still states a hardcoded zone')
})

test('the footnote renders a half-hour offset correctly', () => {
  const state = ready()
  state.page.data.meta = { ...state.page.data.meta, utcOffsetMinutes: 330 }
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t: realT }))
  assert(html.includes('UTC+5:30'), `expected a half-hour zone: ${html.slice(-700)}`)
})

test('the footnote with no metadata still renders without a placeholder', () => {
  const state = ready()
  delete state.page.data.meta
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t: realT }))
  assert(!html.includes('{zone}'), 'an unsubstituted placeholder leaked into the page')
  assert(html.includes('UTC'), 'the footnote should still name a day boundary')
})

test('a payload with no totals block renders em dashes instead of throwing', () => {
  // Regression: the shape check accepted a payload carrying the series but no
  // `totals`, and the page then dereferenced `totals.totalTokens` unguarded —
  // throwing out of render and blanking the shell, which is exactly what the
  // check was written to prevent. Omitting the key entirely (rather than
  // passing `{}`) is the case the old test missed.
  const state = ready()
  delete state.page.data.totals
  let html
  let threw
  try {
    html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  } catch (error) {
    threw = error
  }
  assert(threw === undefined, `omitting totals threw: ${threw && threw.message}`)
  assert(html.includes('page.title'), 'the page must still render its header')
  assert(html.includes('—'), 'every absent figure should render as an em dash')
})

test('a payload whose totals is null renders em dashes instead of throwing', () => {
  const state = ready()
  state.page.data.totals = null
  let threw
  try {
    render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  } catch (error) {
    threw = error
  }
  assert(threw === undefined, `a null totals threw: ${threw && threw.message}`)
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

group('render: dashboard layout')

/** Count the elements carrying one class, by counting its occurrences. */
function countClass(html, className) {
  return [...html.matchAll(new RegExp(`class="[^"]*\\b${className}\\b[^"]*"`, 'g'))].length
}

test('the KPIs are split into a primary row of three and a secondary row of six', () => {
  // Regression: one `auto-fit` grid of nine cards packed five to a row and left
  // the second row with four and an empty column, so the figures never lined up
  // into a readable hierarchy.
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  assert(html.includes('class="tkd_kpiPrimaryRow"'), 'no primary KPI row')
  assert(html.includes('class="tkd_kpiSecondaryRow"'), 'no secondary KPI row')
  assertEqual(countClass(html, 'tkd_kpiPrimary'), 3, `primary cards: ${html.slice(0, 400)}`)
  assertEqual(countClass(html, 'tkd_kpiSecondary'), 6, 'secondary cards')
})

test('every KPI card carries a sub-line, so a row cannot go ragged', () => {
  // Cards with and without a sub-line were different heights, which pushed the
  // big figures off a shared baseline.
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  assertEqual(countClass(html, 'tkd_kpiSub'), 9, 'every card needs a sub-line element')
})

test('the chart viewBox tracks the rendered width instead of a fixed 1000', () => {
  // A fixed viewBox stretched with preserveAspectRatio="none" scaled every
  // glyph by the panel's width: squeezed at 0.87x on a narrow panel, stretched
  // at 1.6x on a wide one. The viewBox must match the element's own width, and
  // the non-uniform stretch must be gone.
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  assert(!html.includes('preserveAspectRatio'), 'the chart still stretches non-uniformly')
  const svg = /<svg[^>]*>/.exec(html)
  assert(svg !== null, 'no chart svg')
  const width = /width="(\d+)"/.exec(svg[0])
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg[0])
  assert(width !== null, `the svg has no width: ${svg[0]}`)
  assert(viewBox !== null, `the svg has no viewBox: ${svg[0]}`)
  assertEqual(viewBox[1], width[1], 'the viewBox width must equal the rendered width')
  assertEqual(viewBox[2], '190', 'the viewBox height is unchanged')
})

test('the axis ticks are round numbers, not the raw peak divided by four', () => {
  // A 132M peak used to render as 132.09M / 99.07M / 66.05M / 33.02M. Rounding
  // the step up to a nice number instead puts the gridlines on values a reader
  // can hold in their head.
  const state = ready()
  state.page.data.days = [{ day: '2026-10-15', inputTokens: 0, outputTokens: 0, cacheReadTokens: 132_000_000, requests: 1 }]
  state.page.data.totals = { ...state.page.data.totals, cacheReadTokens: 132_000_000, totalTokens: 132_000_000 }
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  for (const tick of ['0', '50M', '100M', '150M', '200M']) {
    assert(html.includes(`>${tick}</text>`), `missing tick ${tick}: ${html.slice(0, 900)}`)
  }
  assert(!html.includes('.09M'), 'a raw-division tick leaked in')
})

test('the projects and purposes cards share a row', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(ready()), t }))
  const at = html.indexOf('class="tkd_grid2"')
  assert(at !== -1, `no two-column card grid: ${html.slice(0, 500)}`)
  // Both small tables live inside the grid, which closes before the recent
  // calls card; the wide model table stays outside it, above.
  const after = html.slice(at)
  assert(after.includes('table.projects'), 'the projects card is not in the grid')
  assert(after.includes('table.purposes'), 'the purposes card is not in the grid')
  assert(html.indexOf('table.models') < at, 'the model table should stay full width, above the grid')
})

test('a long project path is clipped and keeps its full text in the title', () => {
  // `white-space:nowrap` on the cell turned an unbreakable path into a
  // horizontal scrollbar that pushed the numeric columns off screen.
  const long = 'D:\\VibeCoding\\Deepseek\\a-very-long-project-directory-name'
  const state = ready()
  state.page.data.projects = [{
    key: long, cwd: long, totalTokens: 100, nonCachedTokens: 10, requests: 1, cacheReadTokens: 90,
  }]
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('tkd_trunc'), `the path is not clipped: ${html.slice(0, 900)}`)
  assert(html.includes(`title="${long}"`), 'the full path must survive in the title')
})

test('an unused chart segment is dimmed rather than dropped from the legend', () => {
  // The four legend keys must stay present (the aria description names them),
  // but a segment that is zero everywhere should read as unused instead of
  // claiming a colour it never draws.
  const state = ready()
  state.page.data.days = [{
    day: '2026-10-14', inputTokens: 10, outputTokens: 5,
    cacheReadTokens: 100, cacheWriteTokens: 0, requests: 1, totalTokens: 115,
  }]
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  for (const key of ['chart.cache', 'chart.cacheWrite', 'chart.input', 'chart.output']) {
    assert(html.includes(key), `legend entry ${key} disappeared`)
  }
  assert(html.includes('tkd_legendZero'), 'the unused segment should be dimmed')
  // And the used ones must not all be dimmed with it.
  const dimmed = countClass(html, 'tkd_legendZero')
  assert(dimmed < 4, `only the unused segment may be dimmed, got ${dimmed}`)
})

group('render: usage calendar')

/** The payload `ready()` builds, plus a year of calendar days ending today. */
function calendarState(extra = {}) {
  const state = ready()
  const now = Date.UTC(2026, 9, 17, 2, 0, 0)
  state.page.data.meta = { ...state.page.data.meta, now, utcOffsetMinutes: 480 }
  state.page.data.calendar = []
  for (let offset = 0; offset < 120; offset += 1) {
    state.page.data.calendar.push({
      day: new Date(now - offset * 86_400_000).toISOString().slice(0, 10),
      totalTokens: (offset + 1) * 1000,
      requests: offset + 1,
      ...extra,
    })
  }
  return state
}

test('the calendar card renders below the bar chart', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(calendarState()), t }))
  assert(html.includes('heat.title'), `the calendar card is missing: ${html.slice(0, 500)}`)
  const chart = html.indexOf('chart.title')
  const heat = html.indexOf('heat.title')
  const models = html.indexOf('table.models')
  assert(chart !== -1 && heat !== -1, 'both cards must render')
  assert(chart < heat && heat < models, `the calendar should sit between the chart and the tables: chart=${chart} heat=${heat} models=${models}`)
})

test('the calendar draws one cell per day of the window, not per recorded day', () => {
  // A calendar with only the busy days on it is not a calendar.
  const html = render(React.createElement(DashboardPage, { source: sourceStub(calendarState()), t }))
  // Cells carry an x coordinate; the five legend swatches (also `tkd_heatN`
  // rects) do not, so the attribute is what tells the grid from its key.
  const cells = [...html.matchAll(/<rect class="tkd_heat[0-4]" x=/g)].length
  assertEqual(cells, 365, `one cell per day of the trailing year, got ${cells}`)
})

test('the calendar starts each column on Monday and labels the weekdays', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(calendarState()), t }))
  for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    assert(html.includes(`>heat.day.${day}<`), `weekday label ${day} is missing`)
  }
  // Every cell's y coordinate must be one of seven rows.
  const ys = new Set([...html.matchAll(/<rect class="tkd_heat[0-4]" x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1])))
  assertEqual(ys.size, 7, `expected seven weekday rows, got ${ys.size}`)
})

test('the calendar keeps its card note explaining the window', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(calendarState()), t }))
  assert(html.includes('heat.subtitle'), 'the card must state that it ignores the range control')
  assert(html.includes('class="tkd_cardNote"'), 'no sub-line for the window')
})

test('the calendar legend names all five shades', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(calendarState()), t }))
  for (const level of ['tkd_heat0', 'tkd_heat1', 'tkd_heat2', 'tkd_heat3', 'tkd_heat4']) {
    assert(html.includes(level), `legend shade ${level} is missing`)
  }
  assert(html.includes('heat.less') && html.includes('heat.more'), 'the legend needs its less/more ends')
})

test('a day with no record is drawn in the empty shade, not as the accent', () => {
  const html = render(React.createElement(DashboardPage, { source: sourceStub(calendarState()), t }))
  assert(html.includes('tkd_heat0'), 'empty days need their own shade')
})

test('the calendar states how many days were recorded', () => {
  const state = calendarState()
  state.page.data.calendar = state.page.data.calendar.slice(0, 3)
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t: realT }))
  assert(html.includes('recorded on 3 days'), `the recorded-day count is missing: ${html.slice(-900)}`)
})

test('a calendar with no recorded day shows its empty note', () => {
  const state = calendarState()
  state.page.data.calendar = []
  // The page's own empty state keys off `days`/`recent`, so keep those populated
  // to reach the card at all.
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assert(html.includes('heat.empty'), `expected the calendar empty note: ${html.slice(-900)}`)
})

test('a payload with no calendar series still renders the page', () => {
  // The series is newer than the other five: a Host that predates it answers
  // without the key, and that must not blank the dashboard.
  const state = ready()
  delete state.page.data.calendar
  let html
  let threw
  try {
    html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  } catch (error) {
    threw = error
  }
  assert(threw === undefined, `a missing calendar threw: ${threw && threw.message}`)
  assert(html.includes('heat.title'), 'the card should still render')
  assert(html.includes('heat.empty'), 'and say it has nothing to show')
})

test('the calendar is not driven by the range control', () => {
  // Under "Today" the day list holds one entry, but the calendar still shows a
  // year: it answers "when was I busy", not "how much did I use today".
  const state = calendarState()
  state.page.range = 'today'
  state.page.data.days = state.page.data.days.slice(0, 1)
  const html = render(React.createElement(DashboardPage, { source: sourceStub(state), t }))
  assertEqual([...html.matchAll(/<rect class="tkd_heat[0-4]" x=/g)].length, 365,
    'the calendar must stay a year wide under a one-day range')
})

group('render: usage calendar hover')

/** Render the page with a stateful React and drive one calendar cell. */
function heatProbe() {
  const interactive = makeInteractiveReact()
  const bundle = loadBundle(interactive.react)
  const draw = () => interactive.render(React.createElement(bundle.DashboardPage, {
    source: sourceStub(calendarState()), t,
  }))
  let shown = draw()
  return {
    get html() { return shown.html },
    get elements() { return shown.elements },
    cells() {
      return shown.elements.filter((el) => /^tkd_heat[0-4]/.test(String(el.props?.className ?? '')))
    },
    /** Hover the cell for one day key and re-render. */
    hover(day) {
      const cell = shown.elements.find((el) => el.key === day)
      assert(cell !== undefined, `no cell for ${day}`)
      cell.props.onMouseEnter()
      shown = draw()
    },
    leave(day) {
      const cell = shown.elements.find((el) => el.key === day)
      assert(cell !== undefined, `no cell for ${day}`)
      cell.props.onMouseLeave()
      shown = draw()
    },
  }
}

test('no calendar tooltip is rendered until a day is hovered', () => {
  const probe = heatProbe()
  assert(!probe.html.includes('class="tkd_tip"'), `a tooltip rendered uninvited: ${probe.html.slice(0, 400)}`)
})

test('hovering a day shows its date, weekday, total and requests', () => {
  const probe = heatProbe()
  probe.hover('2026-10-17')
  const html = probe.html
  assert(html.includes('class="tkd_tip"'), 'no tooltip after hovering a cell')
  assert(html.includes('>2026-10-17<'), `the date is missing: ${html.slice(-900)}`)
  assert(html.includes('>heat.day.sat<'), 'the weekday is missing')
  assert(html.includes('>1,000<'), `the day total is missing: ${html.slice(-900)}`)
  assert(html.includes('>1<'), 'the request count is missing')
})

test('the calendar tooltip hides when the pointer leaves', () => {
  const probe = heatProbe()
  probe.hover('2026-10-17')
  assert(probe.html.includes('class="tkd_tip"'), 'no tooltip to hide')
  probe.leave('2026-10-17')
  assert(!probe.html.includes('class="tkd_tip"'), 'the tooltip outlived the pointer')
})

test('exactly one calendar cell is outlined while hovered', () => {
  const probe = heatProbe()
  assert(!probe.html.includes('tkd_heatOn'), 'a cell was outlined before any hover')
  probe.hover('2026-10-17')
  assertEqual(countClass(probe.html, 'tkd_heatOn'), 1, 'exactly one cell should be outlined')
  probe.hover('2026-10-10')
  assertEqual(countClass(probe.html, 'tkd_heatOn'), 1, 'the outline should move, not accumulate')
})

test('the hover outline rides on top of the cell\'s own shade', () => {
  // The outline is a stroke on the same rect, so the cell keeps its fill class;
  // replacing the class would erase the very shade being explained.
  const probe = heatProbe()
  probe.hover('2026-10-17')
  const cell = probe.cells().find((el) => el.key === '2026-10-17')
  assert(cell.props.className.includes('tkd_heatOn'), 'the hovered cell is not outlined')
  assert(/tkd_heat[0-4]/.test(cell.props.className), `the hovered cell lost its shade: ${cell.props.className}`)
})

test('the calendar tooltip is positioned against the card, not the page', () => {
  const probe = heatProbe()
  probe.hover('2026-10-17')
  const html = probe.html
  const box = html.indexOf('class="tkd_heatBox"')
  const tip = html.indexOf('class="tkd_tip"')
  const legend = html.indexOf('class="tkd_heatLegend"')
  assert(box !== -1 && tip !== -1 && legend !== -1, 'box, tooltip and legend must all render')
  assert(box < tip && tip < legend, `the tooltip must live inside the positioned box: box=${box} tip=${tip}`)
})



/** A ready page whose days are known, so the tooltip's figures are predictable. */
function chartState() {
  const state = ready()
  state.page.data.days = [
    {
      day: '2026-10-15', inputTokens: 1000, outputTokens: 500,
      cacheReadTokens: 8000, cacheWriteTokens: 0, requests: 3, totalTokens: 9500,
    },
    {
      day: '2026-10-16', inputTokens: 2000, outputTokens: 300,
      cacheReadTokens: 12000, cacheWriteTokens: 0, requests: 5, totalTokens: 14300,
    },
  ]
  return state
}

/** Render the page with a stateful React, and return the tooltip driver. */
function hoverProbe() {
  const interactive = makeInteractiveReact()
  const bundle = loadBundle(interactive.react)
  let shown = interactive.render(React.createElement(bundle.DashboardPage, {
    source: sourceStub(chartState()), t,
  }))
  return {
    /** The markup as it stands now. */
    get html() { return shown.html },
    /** Every element node of the current render. */
    get elements() { return shown.elements },
    /** The hit area for one column. */
    hit(index) {
      return shown.elements.find((el) => el.key === `hit-${index}`)
    },
    /** Fire one handler on the column's hit area and re-render. */
    fire(index, handler) {
      const target = this.hit(index)
      assert(target !== undefined, `no hit area for column ${index}`)
      target.props[handler]()
      interactive.resetDirty()
      shown = interactive.render(React.createElement(bundle.DashboardPage, {
        source: sourceStub(chartState()), t,
      }))
    },
  }
}

test('every column gets a full-slot hit area on top of the bars', () => {
  // A thin (or zero-height) bar is hard to hit, so the hover target is the whole
  // slot rather than the rectangle itself.
  const probe = hoverProbe()
  assert(probe.hit(0) !== undefined, 'column 0 has no hit area')
  assert(probe.hit(1) !== undefined, 'column 1 has no hit area')
  assert(probe.elements.some((el) => el.key === 'hit-2') === false, 'invented a hit area for a column that does not exist')
  const count = probe.elements.filter((el) => typeof el.key === 'string' && el.key.startsWith('hit-')).length
  assertEqual(count, 2, `one hit area per column, got ${count}`)
})

test('no tooltip is rendered until a column is hovered', () => {
  const probe = hoverProbe()
  assert(!probe.html.includes('tkd_tip'), `a tooltip rendered uninvited: ${probe.html.slice(0, 400)}`)
})

test('hovering a column shows its label and every segment figure', () => {
  const probe = hoverProbe()
  probe.fire(0, 'onMouseEnter')
  const html = probe.html
  assert(html.includes('class="tkd_tip"'), 'no tooltip after hovering')
  assert(html.includes('>10-15<'), `the day label is missing: ${html.slice(-1500)}`)
  // The four segment values, exact rather than abbreviated.
  for (const value of ['1,000', '500', '8,000']) {
    assert(html.includes(value), `segment figure ${value} missing from the tooltip`)
  }
  assert(html.includes('chart.tipTotal'), 'the tooltip has no total row')
  assert(html.includes('>9,500<'), `the column total is missing: ${html.slice(-1500)}`)
})

test('the tooltip follows the pointer from one column to the next', () => {
  const probe = hoverProbe()
  probe.fire(0, 'onMouseEnter')
  assert(probe.html.includes('>9,500<'), 'column 0 total missing')
  probe.fire(1, 'onMouseEnter')
  assert(probe.html.includes('>14,300<'), `column 1 total missing: ${probe.html.slice(-1500)}`)
  assert(!probe.html.includes('>9,500<'), 'the previous column is still on screen')
})

test('leaving a column hides its tooltip', () => {
  const probe = hoverProbe()
  probe.fire(0, 'onMouseEnter')
  assert(probe.html.includes('tkd_tip'), 'no tooltip to hide')
  probe.fire(0, 'onMouseLeave')
  assert(!probe.html.includes('tkd_tip'), `the tooltip outlived the pointer: ${probe.html.slice(-1200)}`)
})

test('the hovered column is marked with a track', () => {
  // A day whose bar is a hairline still has to look selected.
  const probe = hoverProbe()
  assert(!probe.html.includes('tkd_trackOn'), 'a column was marked before any hover')
  probe.fire(0, 'onMouseEnter')
  assertEqual(countClass(probe.html, 'tkd_trackOn'), 1, 'exactly one column should be marked')
  probe.fire(1, 'onMouseEnter')
  assertEqual(countClass(probe.html, 'tkd_trackOn'), 1, 'the mark should move, not accumulate')
})

test('the tooltip reports a bucketed column as a multi-day total', () => {
  // Beyond 30 days the chart buckets by week; the tooltip must say so rather
  // than presenting a week's figure as one day's.
  const state = ready()
  state.page.data.days = []
  for (let i = 0; i < 60; i += 1) {
    state.page.data.days.push({
      day: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      inputTokens: 10, outputTokens: 5, cacheReadTokens: 100,
      requests: 1, totalTokens: 115,
    })
  }
  const interactive = makeInteractiveReact()
  const bundle = loadBundle(interactive.react)
  let shown = interactive.render(React.createElement(bundle.DashboardPage, { source: sourceStub(state), t }))
  const hit = shown.elements.find((el) => el.key === 'hit-0')
  assert(hit !== undefined, 'the bucketed chart has no hit area')
  hit.props.onMouseEnter()
  shown = interactive.render(React.createElement(bundle.DashboardPage, { source: sourceStub(state), t }))
  assert(shown.html.includes('chart.tipDays'), `a bucketed column must be labelled as such: ${shown.html.slice(-1500)}`)
})

test('a column with no tokens still yields a tooltip rather than nothing', () => {
  // A recorded day with no reported usage: the bar is zero-height, but the day
  // exists and the reader may ask about it.
  const state = ready()
  state.page.data.days = [{ day: '2026-10-15', inputTokens: 0, outputTokens: 0, requests: 1, totalTokens: 0 }]
  const interactive = makeInteractiveReact()
  const bundle = loadBundle(interactive.react)
  let shown = interactive.render(React.createElement(bundle.DashboardPage, { source: sourceStub(state), t }))
  const hit = shown.elements.find((el) => el.key === 'hit-0')
  assert(hit !== undefined, 'a zero day has no hit area')
  hit.props.onMouseEnter()
  shown = interactive.render(React.createElement(bundle.DashboardPage, { source: sourceStub(state), t }))
  assert(shown.html.includes('class="tkd_tip"'), 'hovering a zero day should still explain it')
  assert(shown.html.includes('>0<'), 'the zero total should be shown, not omitted')
})

test('the tooltip is pulled inward rather than hanging off an edge column', () => {
  // The tooltip is centred on its column, so the first and last columns would
  // push it past the plot edge. It is clamped instead. The column centres come
  // from the chart's own hit rects, so this does not re-derive the layout.
  const state = ready()
  state.page.data.days = []
  for (let i = 0; i < 30; i += 1) {
    state.page.data.days.push({
      day: `2026-09-${String(i + 1).padStart(2, '0')}`,
      inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, requests: 1, totalTokens: 115,
    })
  }
  const interactive = makeInteractiveReact()
  const bundle = loadBundle(interactive.react)
  const draw = () => interactive.render(React.createElement(bundle.DashboardPage, { source: sourceStub(state), t }))
  let shown = draw()
  const hitCount = shown.elements.filter((el) => String(el.key).startsWith('hit-')).length
  assertEqual(hitCount, 30, 'expected one hit area per day')

  const tipLeft = () => {
    const tip = shown.elements.find((el) => el.props?.className === 'tkd_tip')
    assert(tip !== undefined, 'no tooltip rendered')
    return { left: Number.parseFloat(tip.props.style.left), width: Number.parseFloat(tip.props.style.top) }
  }

  for (const index of [0, 29]) {
    const hit = shown.elements.find((el) => el.key === `hit-${index}`)
    const centre = hit.props.x + hit.props.width / 2
    hit.props.onMouseEnter()
    shown = draw()
    const { left } = tipLeft()
    assert(!Number.isNaN(left), `column ${index} produced no position`)
    assert(left >= 0 && left <= 1000, `column ${index} placed the tooltip at ${left}px, outside the plot`)
    if (index === 0) assert(left > centre, `the first column should be pulled inward: left=${left} centre=${centre}`)
    if (index === 29) assert(left < centre, `the last column should be pulled inward: left=${left} centre=${centre}`)
  }
})

test('a middle column is centred on its own slot', () => {
  const probe = hoverProbe()
  probe.fire(0, 'onMouseEnter')
  const tip = probe.elements.find((el) => el.props?.className === 'tkd_tip')
  const hit = probe.elements.find((el) => el.key === 'hit-0')
  assertEqual(Number.parseFloat(tip.props.style.left), hit.props.x + hit.props.width / 2,
    'the tooltip should sit over the centre of its column')
})

test('the tooltip is positioned against the chart, not the page', () => {
  // Regression: the tooltip was a SIBLING of the positioned chart box, so its
  // `position:absolute` resolved against the nearest positioned ancestor further
  // up the tree. It floated over the KPI cards above the chart rather than over
  // the chart. It has to be a descendant of the box.
  const probe = hoverProbe()
  probe.fire(0, 'onMouseEnter')
  const html = probe.html
  const box = html.indexOf('class="tkd_chartBox"')
  const tip = html.indexOf('class="tkd_tip"')
  const legend = html.indexOf('class="tkd_legend"')
  assert(box !== -1, 'no chart box')
  assert(tip !== -1, 'no tooltip')
  assert(legend !== -1, 'no legend')
  assert(box < tip && tip < legend,
    `the tooltip must sit inside the chart box, before the legend: box=${box} tip=${tip} legend=${legend}`)
})

test('the segment swatches in the tooltip match the legend', () => {
  // Both are drawn from one declaration now; this pins the property that
  // matters, which is that a tooltip row shows the same shade as the bar it
  // describes.
  const probe = hoverProbe()
  probe.fire(0, 'onMouseEnter')
  const html = probe.html
  for (const swatch of ['tkd_swatchCache', 'tkd_swatchAlt', 'tkd_swatch']) {
    assert(html.includes(swatch), `tooltip swatch ${swatch} is missing`)
  }
})

;(async () => {
  process.exit(await report('render-check'))
})().catch((error) => {
  console.error('render-check crashed:', error)
  process.exit(1)
})
