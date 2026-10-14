/**
 * dsh-token-dashboard — browser half.
 *
 * Two surfaces over one Host RPC:
 *
 *   1. `sidebar.footer.action` — the entry row at the sidebar foot, directly
 *      above the account row. Collapsed, it degrades to a 36px rail button.
 *   2. `main` (key `token-usage`) — the dashboard the entry opens.
 *
 * Both read the same shared source, so the foot's "today" number and the
 * page's charts never disagree.
 *
 * Bundled by hand: no build step, no dependency beyond what the shell already
 * provides (React and the primitives package are on the frozen module table).
 *
 * Everything the Host returns is data to render. None of it is executed.
 */

window.__ModuleLoader__.load({
  id: 'dsh-token-dashboard',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    /** Panel id shared by the `main` key and the footer entry. */
    const PANEL_ID = 'token-usage'
    /** Locale namespace. */
    const NS = 'token-dashboard'
    /** Business endpoint name the Host route answers. */
    const ENDPOINT = 'token-dashboard'
    /** How long the foot's "today" number may go stale. */
    const TODAY_POLL_MS = 60_000
    /** How long the open dashboard may go stale. */
    const PAGE_POLL_MS = 30_000

    /** Ranges the page offers, in display order. */
    const RANGES = ['today', '7d', '30d', 'all']

    // ── styles ───────────────────────────────────────────────────────────────
    // Injected once, guarded so a non-DOM load (tests) is inert.
    const CSS = `
.tkd_foot{flex:none;align-items:center;width:100%;display:flex;position:relative}
.tkd_footRail{width:36px;height:36px;margin:0}
.tkd_footButton{box-sizing:border-box;width:calc(100% + 4px);height:42px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;margin:0 -2px;padding:0 10px 0 8px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}
.tkd_footButton:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tkd_footButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.tkd_footRail .tkd_footButton{corner-shape:round;border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;margin:0;padding:0}
.tkd_footIcon{flex:none;justify-content:center;align-items:center;display:inline-flex}
.tkd_footLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.tkd_footValue{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;margin-left:auto;font-size:12px;line-height:16px}
.tkd_page{box-sizing:border-box;height:100%;color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;gap:24px;padding:0 clamp(24px,4vw,48px) 48px;display:flex;overflow:auto}
.tkd_head{box-sizing:border-box;justify-content:space-between;align-items:flex-start;gap:16px;padding-top:calc(28px + var(--dsh-frame-top-clearance,0px));width:100%;max-width:1100px;display:flex}
.tkd_title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.tkd_intro{color:var(--dsw-alias-label-secondary);align-items:center;gap:4px;margin:4px 0 0;font-size:13px;line-height:20px;display:flex;flex-wrap:wrap}
.tkd_headActions{align-items:center;gap:8px;flex:none;display:flex}
.tkd_ghost{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);height:30px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;align-items:center;gap:6px;padding:0 10px;font-size:13px;display:inline-flex}
.tkd_ghost:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tkd_ghost:disabled{opacity:.5;cursor:default}
.tkd_body{width:100%;max-width:1100px;flex-direction:column;gap:20px;display:flex}
.tkd_kpis{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;display:grid}
.tkd_kpi{border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;flex-direction:column;gap:4px;padding:12px 14px;display:flex}
.tkd_kpiLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
.tkd_kpiValue{font-variant-numeric:tabular-nums;font-size:22px;font-weight:600;line-height:28px}
.tkd_kpiSub{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.tkd_card{border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;flex-direction:column;gap:12px;padding:16px;display:flex}
.tkd_cardTitle{margin:0;font-size:14px;font-weight:500;line-height:20px}
.tkd_chart{width:100%;height:190px;display:block;overflow:visible}
.tkd_bar{fill:var(--dsw-alias-state-business-primary)}
.tkd_barAlt{fill:var(--dsw-alias-state-business-primary);opacity:.45}
.tkd_axis{stroke:var(--dsw-alias-border-l2);stroke-width:1}
.tkd_tick{fill:var(--dsw-alias-label-caption);font-size:10px}
.tkd_table{width:100%;border-collapse:collapse;font-size:13px}
.tkd_table th{color:var(--dsw-alias-label-tertiary);text-align:right;font-weight:500;padding:6px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:12px;white-space:nowrap}
.tkd_table th:first-child,.tkd_table td:first-child{text-align:left}
.tkd_table td{text-align:right;font-variant-numeric:tabular-nums;padding:7px 8px;border-bottom:.5px solid var(--dsw-alias-border-l1);white-space:nowrap}
.tkd_table tbody tr:last-child td{border-bottom:none}
.tkd_mono{font-family:var(--ds-font-family-code,monospace);font-size:12px}
.tkd_muted{color:var(--dsw-alias-label-tertiary)}
.tkd_err{color:var(--dsw-alias-state-error-primary)}
.tkd_ok{color:var(--dsw-alias-state-success-primary)}
.tkd_scroll{max-height:320px;overflow:auto}
.tkd_empty{border:.5px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-secondary);text-align:center;padding:32px 20px;font-size:13px;line-height:22px}
.tkd_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.tkd_error{border:.5px solid var(--dsw-alias-state-error-primary);border-radius:12px;color:var(--dsw-alias-state-error-primary);padding:12px 14px;font-size:13px;line-height:20px}
.tkd_legend{align-items:center;gap:12px;color:var(--dsw-alias-label-tertiary);font-size:12px;display:flex}
.tkd_swatch{width:10px;height:10px;border-radius:2px;background:var(--dsw-alias-state-business-primary);flex:none;display:inline-block}
.tkd_swatchAlt{opacity:.45}
.tkd_spin{animation:tkd-spin 1s linear infinite}
@keyframes tkd-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.tkd_spin{animation:none}}
`
    if (typeof document !== 'undefined') {
      const tagId = 'dsh-token-dashboard/styles'
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-token-dashboard'
        tag.dataset.pluginCss = tagId
        tag.textContent = CSS
        document.head.appendChild(tag)
      }
    }

    // ── formatting (pure; also the test seam) ────────────────────────────────

    /** Group-separated integer, or an em dash for a non-number. */
    function formatInt(value) {
      return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—'
    }

    /** Compact token count: 1.2K / 3.4M / 5.6B. */
    function formatTokens(value) {
      if (!Number.isFinite(value)) return '—'
      const n = Math.round(value)
      const abs = Math.abs(n)
      if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
      if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
      if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}K`
      return n.toLocaleString('en-US')
    }

    /** Percentage from a `0..1` rate, or an em dash when unknown. */
    function formatRate(rate) {
      return Number.isFinite(rate) ? `${(rate * 100).toFixed(1)}%` : '—'
    }

    /** Milliseconds as `1.23 s` / `456 ms`, or an em dash. */
    function formatMs(value) {
      if (!Number.isFinite(value) || value <= 0) return '—'
      return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`
    }

    /** Local wall-clock time for one epoch-millisecond stamp. */
    function formatClock(ts) {
      if (!Number.isFinite(ts) || ts <= 0) return '—'
      const d = new Date(ts)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    }

    /** Short `MM-DD` label for one `YYYY-MM-DD` key. */
    function formatDayShort(day) {
      return typeof day === 'string' && day.length === 10 ? day.slice(5) : String(day ?? '')
    }

    /**
     * Peak of one day list, used to scale the chart.
     * @param days - derived day rows.
     * @returns the largest stacked total, or 0.
     */
    function chartPeak(days) {
      let peak = 0
      for (const day of days ?? []) {
        const total = (day.inputTokens ?? 0) + (day.outputTokens ?? 0)
        if (total > peak) peak = total
      }
      return peak
    }

    /**
     * Group derived day rows into fixed-width chart columns.
     *
     * A 30-day or all-time range would draw hairlines at one bar per day, so
     * long ranges bucket by week and label the bucket's first day.
     * @param days - derived day rows, ascending.
     * @param maxColumns - widest column count to emit.
     * @returns `{ label, inputTokens, outputTokens, requests, days }[]`.
     */
    function bucketDays(days, maxColumns = 30) {
      const list = days ?? []
      if (list.length <= maxColumns) {
        return list.map((day) => ({
          label: formatDayShort(day.day),
          inputTokens: day.inputTokens ?? 0,
          outputTokens: day.outputTokens ?? 0,
          requests: day.requests ?? 0,
          days: 1,
        }))
      }
      const size = Math.ceil(list.length / maxColumns)
      const out = []
      for (let i = 0; i < list.length; i += size) {
        const slice = list.slice(i, i + size)
        let inputTokens = 0
        let outputTokens = 0
        let requests = 0
        for (const day of slice) {
          inputTokens += day.inputTokens ?? 0
          outputTokens += day.outputTokens ?? 0
          requests += day.requests ?? 0
        }
        out.push({ label: formatDayShort(slice[0].day), inputTokens, outputTokens, requests, days: slice.length })
      }
      return out
    }

    /** Series the page indexes unconditionally; each must be an array. */
    const DASHBOARD_SERIES = ['days', 'models', 'purposes', 'projects', 'recent']

    /**
     * Whether one payload is the shape the page renders.
     *
     * The page indexes these arrays directly, so a payload that lacks them
     * would throw mid-render and blank the entire shell. Checking once here
     * turns that into the ordinary "no data" path.
     * @param value - whatever the endpoint returned.
     * @returns true only for a renderable dashboard payload.
     */
    function isDashboard(value) {
      if (value === null || typeof value !== 'object') return false
      for (const key of DASHBOARD_SERIES) {
        if (!Array.isArray(value[key])) return false
      }
      return true
    }

    // ── shared data source ───────────────────────────────────────────────────

    /**
     * Read the Connection RPC caller off the context.
     *
     * `connection` is read opportunistically rather than declared as an
     * injected service: a composition without a carrier should render "no
     * connection", not fail to mount.
     * @param ctx - the plugin context.
     * @returns `{ available, call }`.
     */
    function connectionRpc(ctx) {
      let connection
      try {
        connection = ctx?.connection
      } catch {
        connection = undefined
      }
      if (connection === undefined && typeof ctx?.get === 'function') {
        try {
          connection = ctx.get('connection')
        } catch {
          connection = undefined
        }
      }
      const target = connection?.rpc
      const call = target?.call
      if (typeof call !== 'function') return { available: false, call: undefined }
      return {
        available: true,
        // `rpc.call` resolves to a Connection *result envelope*
        // (`{ ok: true, value } | { ok: false, error }`), never the handler's
        // payload itself. Unwrapping here — once, at the boundary — is what
        // keeps every consumer below working on plain data.
        call: async (method, payload, signal) => {
          const result = await call.call(target, '/api', ENDPOINT, { method, payload }, signal)
          if (result === null || typeof result !== 'object') {
            throw new Error(`token-dashboard: malformed RPC response for ${method}`)
          }
          if (result.ok === true) return result.value
          if (result.ok === false) {
            throw new Error(result.error?.message ?? result.error?.code ?? 'rpc-failed')
          }
          // A carrier that answers with a bare value instead of an envelope:
          // accept it rather than rejecting data we can actually use.
          return result
        },
      }
    }

    /**
     * One shared, observable cache over the dashboard endpoint.
     *
     * Two independent slots — `today` for the foot row and `page` for the open
     * dashboard — so the foot's cheap refresh never clobbers the page's range.
     * @param rpc - the Connection caller.
     * @returns the source handle.
     */
    function createSource(rpc) {
      const listeners = new Set()
      let snapshot = {
        connection: rpc.available,
        today: { status: 'idle', data: null, error: '' },
        page: { status: 'idle', range: '7d', data: null, error: '' },
      }
      let todayInFlight = false
      let pageInFlight = false
      let disposed = false

      const publish = (next) => {
        if (disposed) return
        snapshot = next
        for (const listener of [...listeners]) listener()
      }

      const fail = (error) => (error instanceof Error ? error.message : String(error))

      /** Fetch one slot through the shared caller. */
      async function fetchInto(slot, range, signal) {
        if (!rpc.available) {
          publish({ ...snapshot, [slot]: { ...snapshot[slot], status: 'unavailable', error: 'no-connection' } })
          return
        }
        publish({ ...snapshot, [slot]: { ...snapshot[slot], status: 'loading', error: '' } })
        try {
          const data = await rpc.call('dashboard', { range }, signal)
          publish({ ...snapshot, [slot]: { ...snapshot[slot], status: 'ready', data, error: '' } })
        } catch (error) {
          publish({ ...snapshot, [slot]: { ...snapshot[slot], status: 'error', error: fail(error) } })
        }
      }

      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        /** Refresh the foot row's today figure, coalescing concurrent calls. */
        async loadToday(signal) {
          if (todayInFlight) return
          todayInFlight = true
          try {
            await fetchInto('today', 'today', signal)
          } finally {
            todayInFlight = false
          }
        },
        /** Refresh the page at one range. */
        async loadPage(range, signal) {
          if (pageInFlight) return
          pageInFlight = true
          try {
            publish({ ...snapshot, page: { ...snapshot.page, range } })
            await fetchInto('page', range, signal)
          } finally {
            pageInFlight = false
          }
        },
        dispose() {
          disposed = true
          listeners.clear()
        },
      }
    }

    /** Subscribe a component to the source. */
    function useSource(source) {
      return React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
    }

    /** Poll one loader on an interval, plus once on mount. */
    function usePoll(load, intervalMs) {
      React.useEffect(() => {
        const controller = new AbortController()
        void load(controller.signal)
        const timer = setInterval(() => void load(controller.signal), intervalMs)
        return () => {
          controller.abort()
          clearInterval(timer)
        }
      }, [load, intervalMs])
    }

    // ── foot entry ───────────────────────────────────────────────────────────

    /**
     * The sidebar-foot entry, rendered directly above the account row.
     * @param props - `{ wide, source, onOpen, t }`.
     */
    function FooterTokenButton(props) {
      const { wide, source, onOpen, t } = props
      const snapshot = useSource(source)
      const loadToday = React.useCallback((signal) => source.loadToday(signal), [source])
      usePoll(loadToday, TODAY_POLL_MS)

      const today = snapshot.today
      const totals = today.data?.totals
      const label = t('foot.trigger')
      const value = Number.isFinite(totals?.totalTokens)
        ? formatTokens(totals.totalTokens)
        : undefined

      const children = [
        jsx('span', {
          className: 'tkd_footIcon',
          key: 'icon',
          children: jsx(primitives.IconDataOutlineRegular, { size: wide ? 16 : 18 }),
        }),
      ]
      if (wide) {
        children.push(jsx('span', { className: 'tkd_footLabel', key: 'label', children: label }))
        if (value !== undefined) {
          children.push(jsx('span', { className: 'tkd_footValue', key: 'value', children: value }))
        }
      }

      return jsx('div', {
        className: `tkd_foot${wide ? '' : ' tkd_footRail'}`,
        children: jsx('button', {
          type: 'button',
          className: 'tkd_footButton',
          title: value === undefined ? label : `${label} · ${t('foot.today')} ${value}`,
          'aria-label': label,
          onClick: onOpen,
          children,
        }),
      })
    }

    // ── dashboard page ───────────────────────────────────────────────────────

    /** One labelled reading. */
    function Kpi(props) {
      return jsxs('div', {
        className: 'tkd_kpi',
        children: [
          jsx('span', { className: 'tkd_kpiLabel', children: props.label }),
          jsx('span', { className: 'tkd_kpiValue', children: props.value }),
          props.sub === undefined ? null : jsx('span', { className: 'tkd_kpiSub', children: props.sub }),
        ],
      })
    }

    /**
     * Stacked daily bar chart.
     * @param props - `{ days, t }`.
     */
    function Chart(props) {
      const { days, t } = props
      const columns = bucketDays(days, 30)
      const peak = chartPeak(columns)
      const width = 1000
      const height = 190
      const padLeft = 52
      const padBottom = 22
      const plotWidth = width - padLeft - 8
      const plotHeight = height - padBottom - 8
      const slot = columns.length > 0 ? plotWidth / columns.length : plotWidth
      const barWidth = Math.max(2, Math.min(28, slot * 0.62))

      const bars = []
      columns.forEach((column, index) => {
        const x = padLeft + slot * index + (slot - barWidth) / 2
        const total = column.inputTokens + column.outputTokens
        const scaled = peak > 0 ? (total / peak) * plotHeight : 0
        const inputHeight = total > 0 ? (column.inputTokens / total) * scaled : 0
        const outputHeight = total > 0 ? (column.outputTokens / total) * scaled : 0
        const baseY = 8 + plotHeight
        bars.push(jsx('rect', {
          className: 'tkd_barAlt',
          x,
          y: baseY - inputHeight,
          width: barWidth,
          height: Math.max(0, inputHeight),
          rx: 2,
        }, `in-${index}`))
        bars.push(jsx('rect', {
          className: 'tkd_bar',
          x,
          y: baseY - inputHeight - outputHeight,
          width: barWidth,
          height: Math.max(0, outputHeight),
          rx: 2,
        }, `out-${index}`))
      })

      const ticks = []
      for (let i = 0; i <= 4; i += 1) {
        const y = 8 + plotHeight - (plotHeight / 4) * i
        ticks.push(jsx('line', { className: 'tkd_axis', x1: padLeft, x2: width - 8, y1: y, y2: y }, `grid-${i}`))
        ticks.push(jsx('text', {
          className: 'tkd_tick',
          x: padLeft - 8,
          y: y + 3,
          textAnchor: 'end',
          children: formatTokens((peak / 4) * i),
        }, `tick-${i}`))
      }

      const labels = []
      const stride = Math.max(1, Math.ceil(columns.length / 12))
      columns.forEach((column, index) => {
        if (index % stride !== 0 && index !== columns.length - 1) return
        labels.push(jsx('text', {
          className: 'tkd_tick',
          x: padLeft + slot * index + slot / 2,
          y: height - 6,
          textAnchor: 'middle',
          children: column.label,
        }, `label-${index}`))
      })

      if (columns.length === 0) {
        return jsx('p', { className: 'tkd_note', children: t('chart.empty') })
      }

      return jsxs('div', {
        children: [
          jsxs('svg', {
            className: 'tkd_chart',
            viewBox: `0 0 ${width} ${height}`,
            preserveAspectRatio: 'none',
            role: 'img',
            'aria-label': t('chart.aria'),
            children: [...ticks, ...bars, ...labels],
          }),
          jsxs('div', {
            className: 'tkd_legend',
            children: [
              jsxs('span', {
                children: [
                  jsx('span', { className: 'tkd_swatch', key: 's' }),
                  jsx('span', { key: 'l', children: ` ${t('chart.output')}` }),
                ],
              }),
              jsxs('span', {
                children: [
                  jsx('span', { className: 'tkd_swatch tkd_swatchAlt', key: 's' }),
                  jsx('span', { key: 'l', children: ` ${t('chart.input')}` }),
                ],
              }),
            ],
          }),
        ],
      })
    }

    /**
     * One generic table.
     * @param props - `{ columns, rows, t }` where a column is
     *   `{ key, label, mono?, render? }` and a row is a plain object.
     */
    function Table(props) {
      const { columns, rows } = props
      return jsx('div', {
        className: 'tkd_scroll',
        children: jsxs('table', {
          className: 'tkd_table',
          children: [
            jsx('thead', {
              children: jsx('tr', {
                children: columns.map((column) => jsx('th', { children: column.label }, column.key)),
              }),
            }),
            jsx('tbody', {
              children: rows.map((row, index) => jsx('tr', {
                children: columns.map((column) => {
                  const value = column.render ? column.render(row) : row[column.key]
                  return jsx('td', {
                    className: column.mono ? 'tkd_mono' : undefined,
                    children: value === undefined || value === null ? '—' : value,
                  }, column.key)
                }),
              }, `${index}-${row.key ?? ''}`)),
            }),
          ],
        }),
      })
    }

    /** A titled card wrapping one table, with an empty state. */
    function TableCard(props) {
      const { title, columns, rows, empty, t } = props
      return jsxs('section', {
        className: 'tkd_card',
        children: [
          jsx('h2', { className: 'tkd_cardTitle', children: title }),
          rows.length === 0 ? jsx('p', { className: 'tkd_note', children: empty }) : jsx(Table, { columns, rows, t }),
        ],
      })
    }

    /**
     * The dashboard page rendered into the `main` keyed slot.
     * @param props - `{ source, t }`.
     */
    function DashboardPage(props) {
      const { source, t } = props
      const snapshot = useSource(source)
      const page = snapshot.page
      const range = page.range
      const loadPage = React.useCallback((signal) => source.loadPage(range, signal), [source, range])
      usePoll(loadPage, PAGE_POLL_MS)

      const onSelectRange = React.useCallback((next) => {
        void source.loadPage(next)
      }, [source])
      const onRefresh = React.useCallback(() => {
        void source.loadPage(range)
        void source.loadToday()
      }, [source, range])

      // A payload that is not the shape this page renders is treated as no
      // payload at all: an unexpected response must degrade to a message, not
      // throw out of render and blank the whole shell.
      const data = isDashboard(page.data) ? page.data : null
      const meta = data?.meta
      const totals = data?.totals

      const head = jsxs('header', {
        className: 'tkd_head',
        children: [
          jsxs('div', {
            children: [
              jsx('h1', { className: 'tkd_title', children: t('page.title') }),
              jsxs('p', {
                className: 'tkd_intro',
                children: [
                  jsx('span', { children: t('page.subtitle') }),
                  meta?.firstDay
                    ? jsx('span', { children: ` · ${t('page.since')} ${meta.firstDay}` })
                    : null,
                  meta?.updatedAt
                    ? jsx('span', { children: ` · ${t('page.updated')} ${formatClock(meta.updatedAt)}` })
                    : null,
                ],
              }),
            ],
          }),
          jsxs('div', {
            className: 'tkd_headActions',
            children: [
              jsx(primitives.SegmentedControl, {
                id: 'tkd-range',
                value: range,
                label: t('range.label'),
                options: RANGES.map((value) => ({ value, label: t(`range.${value}`) })),
                onChange: onSelectRange,
              }),
              jsx('button', {
                type: 'button',
                className: 'tkd_ghost',
                onClick: onRefresh,
                disabled: page.status === 'loading',
                children: jsx(primitives.IconRefreshOutlineRegular, { size: 14 }),
              }),
            ],
          }),
        ],
      })

      let body
      if (snapshot.connection !== true) {
        body = jsx('div', { className: 'tkd_empty', children: t('state.noConnection') })
      } else if (page.status === 'error') {
        body = jsx('div', { className: 'tkd_error', children: `${t('state.error')} ${page.error}` })
      } else if (page.status === 'loading' && data === null) {
        body = jsx('div', { className: 'tkd_empty', children: t('state.loading') })
      } else if (data === null || (data.days.length === 0 && data.recent.length === 0)) {
        body = jsx('div', { className: 'tkd_empty', children: t('state.empty') })
      } else {
        body = jsxs('div', {
          className: 'tkd_body',
          children: [
            jsxs('div', {
              className: 'tkd_kpis',
              children: [
                jsx(Kpi, { label: t('kpi.total'), value: formatTokens(totals.totalTokens), sub: formatInt(totals.totalTokens) }, 'total'),
                jsx(Kpi, { label: t('kpi.input'), value: formatTokens(totals.inputTokens) }, 'input'),
                jsx(Kpi, { label: t('kpi.output'), value: formatTokens(totals.outputTokens) }, 'output'),
                jsx(Kpi, { label: t('kpi.cacheRead'), value: formatTokens(totals.cacheReadTokens), sub: formatRate(totals.cacheHitRate) }, 'cache'),
                jsx(Kpi, { label: t('kpi.reasoning'), value: formatTokens(totals.reasoningTokens) }, 'reasoning'),
                jsx(Kpi, { label: t('kpi.requests'), value: formatInt(totals.requests), sub: totals.errors > 0 ? `${formatInt(totals.errors)} ${t('kpi.errors')}` : undefined }, 'requests'),
                jsx(Kpi, { label: t('kpi.ttft'), value: formatMs(totals.avgTtftMs) }, 'ttft'),
                jsx(Kpi, { label: t('kpi.avgDuration'), value: formatMs(totals.avgDurationMs) }, 'duration'),
              ],
            }),
            jsxs('section', {
              className: 'tkd_card',
              children: [
                jsx('h2', { className: 'tkd_cardTitle', children: t('chart.title') }),
                jsx(Chart, { days: data.days, t }),
              ],
            }),
            jsx(TableCard, {
              title: t('table.models'),
              t,
              empty: t('table.empty'),
              rows: data.models,
              columns: [
                { key: 'model', label: t('col.model'), mono: true, render: (row) => row.model || row.provider },
                { key: 'provider', label: t('col.provider') },
                { key: 'totalTokens', label: t('col.total'), render: (row) => formatTokens(row.totalTokens) },
                { key: 'inputTokens', label: t('col.input'), render: (row) => formatTokens(row.inputTokens) },
                { key: 'outputTokens', label: t('col.output'), render: (row) => formatTokens(row.outputTokens) },
                { key: 'cacheReadTokens', label: t('col.cacheRead'), render: (row) => formatTokens(row.cacheReadTokens) },
                { key: 'requests', label: t('col.requests'), render: (row) => formatInt(row.requests) },
                { key: 'avgTtftMs', label: t('col.ttft'), render: (row) => formatMs(row.avgTtftMs) },
              ],
            }),
            jsx(TableCard, {
              title: t('table.projects'),
              t,
              empty: t('table.empty'),
              rows: data.projects,
              columns: [
                { key: 'cwd', label: t('col.project'), mono: true },
                { key: 'totalTokens', label: t('col.total'), render: (row) => formatTokens(row.totalTokens) },
                { key: 'requests', label: t('col.requests'), render: (row) => formatInt(row.requests) },
                { key: 'cacheReadTokens', label: t('col.cacheRead'), render: (row) => formatTokens(row.cacheReadTokens) },
              ],
            }),
            jsx(TableCard, {
              title: t('table.purposes'),
              t,
              empty: t('table.empty'),
              rows: data.purposes,
              columns: [
                { key: 'key', label: t('col.purpose') },
                { key: 'totalTokens', label: t('col.total'), render: (row) => formatTokens(row.totalTokens) },
                { key: 'requests', label: t('col.requests'), render: (row) => formatInt(row.requests) },
              ],
            }),
            jsxs('section', {
              className: 'tkd_card',
              children: [
                jsx('h2', { className: 'tkd_cardTitle', children: t('table.recent') }),
                data.recent.length === 0
                  ? jsx('p', { className: 'tkd_note', children: t('table.empty') })
                  : jsx('div', {
                    className: 'tkd_scroll',
                    children: jsxs('table', {
                      className: 'tkd_table',
                      children: [
                        jsx('thead', {
                          children: jsx('tr', {
                            children: [
                              jsx('th', { children: t('col.time') }),
                              jsx('th', { children: t('col.model') }),
                              jsx('th', { children: t('col.purpose') }),
                              jsx('th', { children: t('col.total') }),
                              jsx('th', { children: t('col.cacheRead') }),
                              jsx('th', { children: t('col.duration') }),
                              jsx('th', { children: t('col.status') }),
                            ],
                          }),
                        }),
                        jsx('tbody', {
                          children: data.recent.map((record, index) => jsxs('tr', {
                            children: [
                              jsx('td', { className: 'tkd_mono', children: formatClock(record.ts) }),
                              jsx('td', { className: 'tkd_mono', children: record.model || record.provider }),
                              jsx('td', { children: record.purpose }),
                              jsx('td', { children: formatTokens((record.inputTokens ?? 0) + (record.outputTokens ?? 0)) }),
                              jsx('td', { children: formatTokens(record.cacheReadTokens ?? 0) }),
                              jsx('td', { children: formatMs(record.durationMs) }),
                              jsx('td', {
                                className: record.ok ? 'tkd_ok' : 'tkd_err',
                                title: record.error ?? '',
                                children: record.ok ? t('status.ok') : t('status.error'),
                              }),
                            ],
                          }, `${record.ts}-${index}`)),
                        }),
                      ],
                    }),
                  }),
                jsx('p', { className: 'tkd_note', children: t('page.footnote') }),
              ],
            }),
          ],
        })
      }

      return jsxs('div', {
        className: 'tkd_page',
        children: [head, body],
      })
    }

    // ── copy ─────────────────────────────────────────────────────────────────

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'foot.trigger': 'Token 用量',
      'foot.today': '今日',
      'page.title': 'Token 用量',
      'page.subtitle': '本插件自安装后开始记录',
      'page.since': '起始',
      'page.updated': '更新于',
      'page.footnote': '按 UTC+8 计日；输入与输出分别统计，缓存命中单列，不折算价格。',
      'range.label': '统计区间',
      'range.today': '今日',
      'range.7d': '近 7 天',
      'range.30d': '近 30 天',
      'range.all': '全部',
      'chart.title': '每日用量',
      'chart.input': '输入',
      'chart.output': '输出',
      'chart.empty': '该区间内没有记录。',
      'chart.aria': '每日 token 用量柱状图',
      'kpi.total': '总 token',
      'kpi.input': '输入',
      'kpi.output': '输出',
      'kpi.cacheRead': '缓存读取',
      'kpi.reasoning': '推理',
      'kpi.requests': '请求数',
      'kpi.errors': '次失败',
      'kpi.ttft': '平均首字',
      'kpi.avgDuration': '平均耗时',
      'table.models': '按模型',
      'table.projects': '按项目',
      'table.purposes': '按用途',
      'table.recent': '最近调用',
      'table.empty': '暂无数据。',
      'col.model': '模型',
      'col.provider': '提供方',
      'col.total': '总量',
      'col.input': '输入',
      'col.output': '输出',
      'col.cacheRead': '缓存',
      'col.requests': '请求',
      'col.ttft': '首字',
      'col.project': '项目目录',
      'col.purpose': '用途',
      'col.time': '时间',
      'col.duration': '耗时',
      'col.status': '状态',
      'status.ok': '成功',
      'status.error': '失败',
      'state.loading': '正在读取…',
      'state.error': '读取失败：',
      'state.empty': '还没有记录到用量——本插件从安装之后开始记录，先发起一次对话即可看到数据。',
      'state.noConnection': '当前页面没有连接到 Host，无法读取用量数据。',
    }

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      'foot.trigger': 'Token usage',
      'foot.today': 'today',
      'page.title': 'Token usage',
      'page.subtitle': 'Recorded since this plugin was installed',
      'page.since': 'since',
      'page.updated': 'updated',
      'page.footnote': 'Days are cut at UTC+8. Input and output are counted separately and cache hits are listed on their own; no price is applied.',
      'range.label': 'Range',
      'range.today': 'Today',
      'range.7d': 'Last 7 days',
      'range.30d': 'Last 30 days',
      'range.all': 'All',
      'chart.title': 'Daily usage',
      'chart.input': 'input',
      'chart.output': 'output',
      'chart.empty': 'No records in this range.',
      'chart.aria': 'Daily token usage bar chart',
      'kpi.total': 'Total tokens',
      'kpi.input': 'Input',
      'kpi.output': 'Output',
      'kpi.cacheRead': 'Cache read',
      'kpi.reasoning': 'Reasoning',
      'kpi.requests': 'Requests',
      'kpi.errors': 'failed',
      'kpi.ttft': 'Avg first token',
      'kpi.avgDuration': 'Avg duration',
      'table.models': 'By model',
      'table.projects': 'By project',
      'table.purposes': 'By purpose',
      'table.recent': 'Recent calls',
      'table.empty': 'No data yet.',
      'col.model': 'Model',
      'col.provider': 'Provider',
      'col.total': 'Total',
      'col.input': 'Input',
      'col.output': 'Output',
      'col.cacheRead': 'Cache',
      'col.requests': 'Requests',
      'col.ttft': 'TTFT',
      'col.project': 'Project directory',
      'col.purpose': 'Purpose',
      'col.time': 'Time',
      'col.duration': 'Duration',
      'col.status': 'Status',
      'status.ok': 'ok',
      'status.error': 'failed',
      'state.loading': 'Loading…',
      'state.error': 'Read failed: ',
      'state.empty': 'Nothing recorded yet — this plugin records from the moment it was installed. Send one message and the numbers appear.',
      'state.noConnection': 'This page has no Host connection, so usage data cannot be read.',
    }

    // ── plugin ───────────────────────────────────────────────────────────────

    /** Required client services. `connection` is read opportunistically. */
    const inject = ['slots', 'locale', 'layout']

    /**
     * Register the foot entry and the dashboard panel.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-token-dashboard: dictionaries')
      const t = ctx.locale.bind(NS)
      const rpc = connectionRpc(ctx)
      const source = createSource(rpc)
      ctx.effect(() => () => source.dispose(), 'dsh-token-dashboard: source')

      // The `main` key must exist before the foot entry can select it: the
      // layout refuses `selectPanel` for an unregistered key, so this order is
      // load-bearing rather than cosmetic.
      ctx.slots.inject('main', () => ctx.slots.register(
        {
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ source, t }),
        },
        DashboardPage,
      ))

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        {
          name: 'sidebar.footer.action',
          id: PANEL_ID,
          order: 10,
          locale: NS,
          label: () => t('foot.trigger'),
          inject: () => ({
            source,
            t,
            onOpen: () => ctx.layout.selectPanel(PANEL_ID),
          }),
        },
        FooterTokenButton,
      ))
    }

    exports.apply = apply
    exports.inject = inject
    exports.PANEL_ID = PANEL_ID
    exports.NS = NS
    exports.ENDPOINT = ENDPOINT
    exports.connectionRpc = connectionRpc
    exports.createSource = createSource
    exports.FooterTokenButton = FooterTokenButton
    exports.DashboardPage = DashboardPage

    /** Test seam: pure helpers, exercised by test/client-check.cjs. */
    exports.__internal = {
      formatInt,
      formatTokens,
      formatRate,
      formatMs,
      formatClock,
      formatDayShort,
      chartPeak,
      bucketDays,
      zh,
      en,
      PANEL_ID,
      NS,
      RANGES,
    }

    return module.exports
  },
})
