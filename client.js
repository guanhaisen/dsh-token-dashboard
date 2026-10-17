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
    /**
     * Half the tooltip's maximum width, in pixels.
     *
     * The tooltip is centred on its column, so the first and last columns would
     * push it past the plot edge; it is pulled inward by this much. Must match
     * the `.tkd_tip` `max-width` (220px) in the stylesheet — a half-width that
     * is smaller than the real one lets the tooltip overhang the edge.
     */
    const TIP_HALF_WIDTH = 110

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
.tkd_page{box-sizing:border-box;height:100%;color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;gap:24px;padding:0 clamp(24px,4vw,48px) 48px;display:flex;overflow:auto;container:tkd/inline-size;--tkd-op-cache:.18;--tkd-op-cacheWrite:.55;--tkd-op-in:.45;--tkd-op-out:1}
.tkd_head{box-sizing:border-box;justify-content:space-between;align-items:flex-start;gap:16px;padding-top:calc(28px + var(--dsh-frame-top-clearance,0px));width:100%;max-width:1100px;display:flex;flex-wrap:wrap}
.tkd_title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.tkd_intro{color:var(--dsw-alias-label-secondary);align-items:center;gap:4px;margin:4px 0 0;font-size:13px;line-height:20px;display:flex;flex-wrap:wrap}
.tkd_headActions{align-items:center;gap:8px;flex:none;display:flex}
.tkd_ghost{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);height:30px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;align-items:center;gap:6px;padding:0 10px;font-size:13px;display:inline-flex}
.tkd_ghost:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tkd_ghost:disabled{opacity:.5;cursor:default}
.tkd_body{width:100%;max-width:1100px;flex-direction:column;gap:20px;display:flex}
.tkd_kpis{flex-direction:column;gap:12px;display:flex}
.tkd_kpiPrimaryRow{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;display:grid}
.tkd_kpiSecondaryRow{grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;display:grid}
.tkd_kpi{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill);flex-direction:column;gap:4px;padding:12px 14px;display:flex}
.tkd_kpiLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
.tkd_kpiValue{font-variant-numeric:tabular-nums;font-size:17px;font-weight:600;line-height:24px}
.tkd_kpiSub{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;min-height:16px}
.tkd_kpiPrimary{padding:16px 18px}
.tkd_kpiPrimary .tkd_kpiValue{font-size:26px;line-height:34px}
.tkd_grid2{grid-template-columns:repeat(auto-fit,minmax(340px,1fr));align-items:start;gap:20px;display:grid}
.tkd_card{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill);flex-direction:column;gap:12px;padding:16px 20px;display:flex}
.tkd_cardTitle{margin:0;font-size:14px;font-weight:500;line-height:20px}
.tkd_chartBox{min-width:0;width:100%;position:relative}
.tkd_chart{width:100%;display:block;overflow:visible}
/* One opacity per segment, shared by its bar and its legend swatch. They were
   two parallel ladders before, and they drifted: the legend promised a shade the
   bar did not draw. Each segment now names its own variable, so a bar and the
   swatch beside it can only ever be the same colour. */
.tkd_bar,.tkd_swatch{fill:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);opacity:var(--tkd-op-out)}
.tkd_barAlt,.tkd_swatchAlt{fill:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);opacity:var(--tkd-op-in)}
.tkd_barCache,.tkd_swatchCache{fill:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);opacity:var(--tkd-op-cache)}
.tkd_barCacheWrite,.tkd_swatchCacheWrite{fill:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);opacity:var(--tkd-op-cacheWrite)}
.tkd_axis{stroke:var(--dsw-alias-border-l2);stroke-width:1}
/* Text and gridlines must not swallow the pointer: the column hit areas sit on
   top of the plot and are what drive the tooltip. */
.tkd_axis,.tkd_tick{pointer-events:none}
.tkd_tick{fill:var(--dsw-alias-label-caption);font-size:10px}
/* One full-height hit area per column, so the whole slot is hoverable rather
   than only the (often thin) bar itself. */
.tkd_hit{fill:transparent}
.tkd_track{fill:transparent;pointer-events:none}
.tkd_trackOn{fill:var(--dsw-alias-interactive-bg-hover)}
/* The tooltip follows the shell's own: same background and text colour, so it
   reads as the same surface as every other tooltip in the app.
   The max-width is load-bearing, not cosmetic: the tooltip is centred on its
   column and pulled inward at the edges using a fixed half-width, so the half
   width has to be a real upper bound. The figures stay nowrap (a broken number
   is unreadable) while a long label wraps instead of overflowing. */
.tkd_tip{position:absolute;z-index:100;pointer-events:none;transform:translate(-50%,0);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00);border-radius:var(--dsw-radius-sm);box-shadow:var(--dsw-shadow-lv2);padding:7px 10px;font-size:12px;line-height:18px;max-width:220px}
.tkd_tipTitle{font-weight:600;white-space:nowrap}
.tkd_tipNote{opacity:.7;font-weight:400;margin-left:6px}
.tkd_tipGrid{margin-top:5px;display:grid;grid-template-columns:auto auto;gap:2px 14px}
.tkd_tipKey{align-items:center;gap:6px;display:flex;opacity:.85}
.tkd_tipVal{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.tkd_tipTotal{border-top:.5px solid rgba(255,255,255,.22);margin-top:5px;padding-top:5px;display:grid;grid-template-columns:auto auto;gap:2px 14px}
.tkd_table{width:100%;border-collapse:collapse;font-size:13px}
.tkd_table th{color:var(--dsw-alias-label-tertiary);text-align:right;font-weight:500;padding:6px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:12px;white-space:nowrap}
.tkd_table thead th{position:sticky;top:0;background:var(--dsw-alias-settings-card-fill);z-index:1}
.tkd_table th:first-child,.tkd_table td:first-child{text-align:left}
.tkd_table td{text-align:right;font-variant-numeric:tabular-nums;padding:7px 8px;border-bottom:.5px solid var(--dsw-alias-border-l1);white-space:nowrap}
.tkd_table tbody tr:last-child td{border-bottom:none}
.tkd_trunc{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.tkd_mono{font-family:var(--ds-font-family-code,monospace);font-size:12px}
.tkd_err{color:var(--dsw-alias-state-error-primary)}
.tkd_ok{color:var(--dsw-alias-state-success-primary)}
.tkd_scroll{max-height:320px;overflow:auto}
.tkd_empty{border:.5px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-secondary);text-align:center;padding:32px 20px;font-size:13px;line-height:22px}
.tkd_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.tkd_error{border:.5px solid var(--dsw-alias-state-error-primary);border-radius:12px;color:var(--dsw-alias-state-error-primary);padding:12px 14px;font-size:13px;line-height:20px}
.tkd_legend{align-items:center;gap:12px;color:var(--dsw-alias-label-tertiary);font-size:12px;display:flex;flex-wrap:wrap}
.tkd_swatch{width:10px;height:10px;border-radius:2px;flex:none;display:inline-block}
.tkd_legendZero{opacity:.45}
/* Calendar heatmap. One square per day, shaded by the day's total against the
   window's own quartiles, so the shades compare days inside the window rather
   than pretending a fixed rate. Level 0 is "no record" and is drawn in the
   lightest border tone instead of the accent, so an empty day and a light day
   stay distinguishable. The shade is carried by fill-opacity, not opacity: the
   hovered cell is outlined with a stroke, and a plain opacity would fade that
   outline along with the fill. The legend swatch is an inline SVG using the
   same class, so a swatch cannot promise a shade the grid does not draw. */
.tkd_heat0{fill:var(--dsw-alias-border-l1)}
.tkd_heat1{fill:var(--dsw-alias-state-business-primary);fill-opacity:.25}
.tkd_heat2{fill:var(--dsw-alias-state-business-primary);fill-opacity:.48}
.tkd_heat3{fill:var(--dsw-alias-state-business-primary);fill-opacity:.72}
.tkd_heat4{fill:var(--dsw-alias-state-business-primary);fill-opacity:1}
.tkd_heatOn{stroke:var(--dsw-alias-label-primary);stroke-width:1}
.tkd_heatBox{min-width:0;width:100%;position:relative}
.tkd_heatLegend{align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);font-size:12px;display:flex;flex-wrap:wrap}
.tkd_heatGap{width:10px;flex:none}
.tkd_cardHead{justify-content:space-between;align-items:baseline;gap:4px 12px;display:flex;flex-wrap:wrap}
.tkd_cardNote{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px}
/* Breakpoints are container queries, not viewport ones: this panel lives in a
   resizable main pane, so a wide window with a narrow pane must reflow too. */
@container tkd (max-width:1080px){.tkd_kpiSecondaryRow{grid-template-columns:repeat(3,minmax(0,1fr))}}
@container tkd (max-width:680px){
.tkd_kpiPrimaryRow{grid-template-columns:minmax(0,1fr)}
.tkd_kpiSecondaryRow{grid-template-columns:repeat(2,minmax(0,1fr))}
.tkd_headActions{width:100%}
.tkd_trunc{max-width:160px}
}
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

    /**
     * Round a raw step up to the next `1 / 2 / 2.5 / 5 / 10 x 10^n` value.
     * @param raw - the ideal step, before rounding.
     * @returns the rounded step, or 0 when `raw` is not usable.
     */
    function niceStep(raw) {
      if (!Number.isFinite(raw) || raw <= 0) return 0
      const magnitude = 10 ** Math.floor(Math.log10(raw))
      const normalized = raw / magnitude
      const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
      return factor * magnitude
    }

    /**
     * The chart's axis top and step: round ticks that cover the peak.
     *
     * Dividing the peak by four and labelling those exact values is what made
     * the axis read as noise — a 141.37M peak produced
     * `35.34M / 70.68M / 106.02M / 141.37M`. Rounding the *step* up to a nice
     * number instead gives `0 / 50M / 100M / 150M / 200M`, so the gridlines
     * land on values a reader can hold in their head. The axis top is therefore
     * normally a little above the peak, and the tallest bar stops just short of
     * the top gridline — which is how a scaled axis is meant to look.
     * @param peak - the largest stacked column total.
     * @param steps - how many intervals the axis is divided into.
     * @returns `{ max, step }`; both 0 for a non-positive peak.
     */
    function axisScale(peak, steps = 4) {
      if (!Number.isFinite(peak) || peak <= 0) return { max: 0, step: 0 }
      const step = niceStep(peak / steps)
      return { max: step * steps, step }
    }

    /**
     * One axis tick, labelled against the axis's own step.
     *
     * `formatTokens` is right for a KPI card, where the exact figure is the
     * point, but wrong on an axis: it always spends two decimals, so a scale
     * reads `33.02M / 66.05M / 99.07M / 132.09M`. The precision here comes from
     * the step, so a round step prints as a round label (`50M`, `1,000`) and
     * only a genuinely fractional one keeps a decimal (`2.5M`).
     * @param value - the tick's token value.
     * @param step - the axis step the ticks advance by.
     * @returns a short label, or an em dash for a non-number.
     */
    function formatAxisTick(value, step) {
      if (!Number.isFinite(value)) return '—'
      // The baseline is a plain zero, not `0M`/`0K`: a unit on the origin reads
      // as if the axis were offset from it.
      if (value === 0) return '0'
      const size = Number.isFinite(step) ? Math.abs(step) : 0
      let unit = 1
      let suffix = ''
      if (size >= 1e9) {
        unit = 1e9
        suffix = 'B'
      } else if (size >= 1e6) {
        unit = 1e6
        suffix = 'M'
      } else if (size >= 1e3) {
        unit = 1e3
        suffix = 'K'
      }
      // Below the smallest unit the axis is in raw tokens, grouped.
      if (unit === 1) return Math.round(value).toLocaleString('en-US')
      const scaled = size / unit
      const decimals = Number.isInteger(scaled) ? 0 : Number.isInteger(scaled * 10) ? 1 : 2
      return `${(value / unit).toFixed(decimals)}${suffix}`
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

    /** Fill `{name}` placeholders in one localized template. */
    function template(text, values) {
      return String(text ?? '').replace(/\{(\w+)\}/g, (match, key) => (
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
      ))
    }

    /**
     * Render a fixed day-boundary offset as a UTC label.
     *
     * The offset is configurable (`utcOffsetMinutes`), so the page cannot state
     * a constant: a hardcoded "UTC+8" caption was wrong for every user who had
     * changed the setting, and the day the numbers are cut at is exactly what
     * that caption exists to tell them.
     * @param minutes - offset in minutes; 480 for UTC+8.
     * @returns `UTC+8`, `UTC+5:30`, `UTC-5`, `UTC±0`, or `UTC` when unknown.
     */
    function formatUtcOffset(minutes) {
      if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return 'UTC'
      const total = Math.trunc(minutes)
      const sign = total > 0 ? '+' : total < 0 ? '-' : '±'
      const abs = Math.abs(total)
      const hours = Math.floor(abs / 60)
      const rest = abs % 60
      return `UTC${sign}${hours}${rest === 0 ? '' : `:${String(rest).padStart(2, '0')}`}`
    }

    /**
     * The four stacked segments in stack order, bottom first.
     *
     * Declared once so the chart's tooltip and its legend cannot disagree about
     * a segment's colour or name — the two drew them from separate literals
     * before, and drifted.
     */
    const LEGEND = [
      { key: 'cache', swatch: 'tkd_swatchCache', label: 'chart.cache' },
      { key: 'cacheWrite', swatch: 'tkd_swatchCacheWrite', label: 'chart.cacheWrite' },
      { key: 'in', swatch: 'tkd_swatchAlt', label: 'chart.input' },
      { key: 'out', swatch: 'tkd_swatch', label: 'chart.output' },
    ]

    /** Swatch class per segment key. */
    const LEGEND_SWATCH = Object.fromEntries(LEGEND.map((item) => [item.key, item.swatch]))
    /** Locale key per segment key. */
    const LEGEND_LABEL = Object.fromEntries(LEGEND.map((item) => [item.key, item.label]))

    /**
     * The stacked segments of one chart column, bottom to top.
     *
     * Cache reads sit at the bottom because they dominate a warm workload —
     * on a cache-heavy day they are over 99% of the bar. Drawing them last
     * would push the input and output segments off the top of the plot and
     * make the one thing the chart is for invisible.
     *
     * The four segments sum to exactly the `totalTokens` the KPI card reports,
     * because the bars are scaled against that same figure: omitting cache
     * writes here (as an earlier version did) made the bar shorter than the
     * number printed directly above it on any provider that reports them.
     * @param column - one bucketed column.
     * @returns `{ key, className, value }[]` bottom-first.
     */
    function columnSegments(column) {
      return [
        { key: 'cache', className: 'tkd_barCache', value: column.cacheReadTokens ?? 0 },
        { key: 'cacheWrite', className: 'tkd_barCacheWrite', value: column.cacheWriteTokens ?? 0 },
        { key: 'in', className: 'tkd_barAlt', value: column.inputTokens ?? 0 },
        { key: 'out', className: 'tkd_bar', value: column.outputTokens ?? 0 },
      ]
    }

    /** The stacked height of one column, in tokens. */
    function columnTotal(column) {
      return (column.cacheReadTokens ?? 0)
        + (column.cacheWriteTokens ?? 0)
        + (column.inputTokens ?? 0)
        + (column.outputTokens ?? 0)
    }

    /**
     * Peak of one day list, used to scale the chart.
     * @param days - derived day rows.
     * @returns the largest stacked total, or 0.
     */
    function chartPeak(days) {
      let peak = 0
      for (const day of days ?? []) {
        const total = columnTotal(day)
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
     * @returns `{ label, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, requests, days }[]`.
     */
    function bucketDays(days, maxColumns = 30) {
      const list = days ?? []
      if (list.length <= maxColumns) {
        return list.map((day) => ({
          label: formatDayShort(day.day),
          inputTokens: day.inputTokens ?? 0,
          outputTokens: day.outputTokens ?? 0,
          cacheReadTokens: day.cacheReadTokens ?? 0,
          cacheWriteTokens: day.cacheWriteTokens ?? 0,
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
        let cacheReadTokens = 0
        let cacheWriteTokens = 0
        let requests = 0
        for (const day of slice) {
          inputTokens += day.inputTokens ?? 0
          outputTokens += day.outputTokens ?? 0
          cacheReadTokens += day.cacheReadTokens ?? 0
          cacheWriteTokens += day.cacheWriteTokens ?? 0
          requests += day.requests ?? 0
        }
        out.push({
          label: formatDayShort(slice[0].day),
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          requests,
          days: slice.length,
        })
      }
      return out
    }

    /** Series the page indexes unconditionally; each must be an array. */
    const DASHBOARD_SERIES = ['days', 'models', 'purposes', 'projects', 'recent']

    // ── calendar heatmap helpers ─────────────────────────────────────────────

    /** Days a heatmap window covers: a year to the day, as the copied idiom is. */
    const HEAT_WINDOW_DAYS = 365

    /** Cell geometry, in CSS pixels. */
    const HEAT_CELL = 13
    const HEAT_GAP = 3
    /** Widest pitch (cell plus gap) a column is allowed to take. */
    const HEAT_STRIDE_MAX = 18
    /**
     * Width of the weekday gutter to the left of the grid.
     *
     * Wide enough for the longest localized name at the tick font size: `Mon`
     * is about 21px at 10px, and a narrower gutter clips it at the panel edge
     * (the first preview of this card did exactly that).
     */
    const HEAT_LABEL = 32
    /** Band above the grid holding the month labels. */
    const HEAT_HEAD = 18
    /** Right padding, so the last column does not touch the card edge. */
    const HEAT_PAD_RIGHT = 2
    /** Rows of the grid: one per weekday, Monday first. */
    const HEAT_ROWS = 7

    /**
     * Parse one `YYYY-MM-DD` key into UTC parts.
     *
     * The key is a calendar day, not an instant, so it is parsed as UTC and kept
     * there: doing arithmetic in local time would shift a key by a day either
     * side of midnight, and the whole point of the key is that the Host already
     * decided which day a call belongs to.
     * @param day - a day key.
     * @returns `{ y, m, d, ms }`, or `undefined` when the key is unusable.
     */
    function parseDayKey(day) {
      if (typeof day !== 'string') return undefined
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
      if (match === null) return undefined
      const y = Number(match[1])
      const m = Number(match[2])
      const d = Number(match[3])
      const ms = Date.UTC(y, m - 1, d)
      // Reject a key that does not survive the round trip: `2026-02-30` parses as
      // 2 March, and rendering it under February would mislabel the column.
      if (dayKeyOf(ms) !== day) return undefined
      return { y, m, d, ms }
    }

    /** The `YYYY-MM-DD` key of one epoch-millisecond instant, in UTC. */
    function dayKeyOf(ms) {
      const date = new Date(ms)
      const month = String(date.getUTCMonth() + 1).padStart(2, '0')
      const d = String(date.getUTCDate()).padStart(2, '0')
      return `${date.getUTCFullYear()}-${month}-${d}`
    }

    /**
     * The five shades a cell can take, lightest first.
     *
     * Four steps rather than a continuous ramp: at 11px a reader cannot resolve
     * more, and a quantized scale is what lets the legend name a level instead
     * of hinting at a gradient.
     */
    const HEAT_LEVELS = ['tkd_heat0', 'tkd_heat1', 'tkd_heat2', 'tkd_heat3', 'tkd_heat4']

    /**
     * The bucket boundaries that give one window its five shades.
     *
     * Buckets are the window's own quartiles of the days that actually have
     * tokens, not fixed thresholds. A fixed scale would draw every day of a
     * light user at level 1 and every day of a heavy one at level 4; ranking
     * inside the window is what makes the picture say "which days were heavier",
     * which is the question a heatmap answers.
     *
     * Days with zero tokens are excluded from the quartiles on purpose: they
     * have their own level (0, "nothing recorded") and would otherwise drag the
     * low boundary to zero, flattening every real day into the top shade.
     * @param days - the window's days, each `{ totalTokens }`.
     * @returns `[low, mid, high]` ascending; empty when nothing to rank.
     */
    function heatBreaks(days) {
      const values = (days ?? [])
        .map((day) => day?.totalTokens)
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b)
      if (values.length === 0) return []
      const at = (fraction) => values[Math.min(values.length - 1, Math.floor(fraction * values.length))]
      const breaks = [at(0.25), at(0.5), at(0.75)]
      // A window where every day is identical yields three equal breaks; keeping
      // them as-is puts every day at level 4, which overstates a flat workload.
      // Collapsing to the median puts every day at level 2 instead — the honest
      // reading of "all these days are typical for this window".
      if (breaks[0] === breaks[2]) return [breaks[1]]
      return breaks
    }

    /**
     * Which of the five shades one day's total takes.
     * @param total - the day's total tokens.
     * @param breaks - boundaries from {@link heatBreaks}.
     * @returns an index into {@link HEAT_LEVELS}.
     */
    function heatLevel(total, breaks) {
      if (!Number.isFinite(total) || total <= 0) return 0
      if (!Array.isArray(breaks) || breaks.length === 0) return 4
      // A single collapsed boundary marks the flat window described above.
      if (breaks.length === 1) return total >= breaks[0] ? 2 : 1
      if (total <= breaks[0]) return 1
      if (total <= breaks[1]) return 2
      if (total <= breaks[2]) return 3
      return 4
    }

    /**
     * Lay one trailing window of days out as calendar columns.
     *
     * Columns are weeks, top to bottom Monday..Sunday, the way a contribution
     * graph is read. The window ends on the Host's current day and starts
     * `HEAT_WINDOW_DAYS - 1` days earlier, so it is exactly a year to the day.
     *
     * Every cell in the window is emitted whether or not the Host recorded it:
     * an absent day in the middle of a year is a fact about the workload, and
     * skipping it would compress the calendar and misstate the gaps.
     * @param calendar - `{ day, totalTokens, requests }[]` from the Host.
     * @param options - `{ now, utcOffsetMinutes?, windowDays? }`.
     * @returns `{ columns, breaks, totals, levelOf }`, where `totals` carries the
     *   window's token sum and its recorded-day count, and `levelOf` maps a day
     *   key to its shade index.
     */
    function heatmapWindow(calendar, options = {}) {
      const windowDays = Number.isFinite(options.windowDays) && options.windowDays > 0
        ? Math.trunc(options.windowDays)
        : HEAT_WINDOW_DAYS
      const byDay = new Map()
      let recordedDays = 0
      let total = 0
      for (const row of calendar ?? []) {
        if (row === null || typeof row !== 'object') continue
        if (typeof row.day !== 'string' || parseDayKey(row.day) === undefined) continue
        const tokens = Number.isFinite(row.totalTokens) ? row.totalTokens : 0
        byDay.set(row.day, { totalTokens: tokens, requests: Number.isFinite(row.requests) ? row.requests : 0 })
        if (tokens > 0) recordedDays += 1
        total += tokens
      }
      const nowMs = Number.isFinite(options.now) ? options.now : Date.now()
      // The window ends on the day the Host calls today, which is cut at its own
      // configured offset — not at UTC. Anchoring to the UTC day instead dropped
      // today's records for the first eight hours of a UTC+8 day, because the
      // UTC day was still yesterday while the Host had already started a new one.
      const offset = Number.isFinite(options.utcOffsetMinutes) ? Math.trunc(options.utcOffsetMinutes) : 0
      const end = parseDayKey(dayKeyOf(nowMs + offset * 60_000))
      const endMs = end === undefined
        ? Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate())
        : end.ms
      const startMs = endMs - (windowDays - 1) * 86_400_000
      // Pad the front so the first column starts on a Monday: without it the
      // rows would not line up with the weekday labels.
      const startWeekday = (new Date(startMs).getUTCDay() + 6) % 7
      const paddedStart = startMs - startWeekday * 86_400_000
      const cellCount = Math.ceil((endMs - paddedStart) / 86_400_000) + 1

      const window = []
      // The grid is a whole number of weeks: the front is padded back to Monday
      // and the tail is padded forward to Sunday, so every column has seven
      // cells. Padding is marked `inside: false` and drawn as nothing — it is
      // geometry, not a day, and painting it as "no record" would add up to six
      // fake empty days to the right of today.
      for (let offsetDays = 0; offsetDays < cellCount; offsetDays += 1) {
        const ms = paddedStart + offsetDays * 86_400_000
        const day = dayKeyOf(ms)
        const inside = ms >= startMs && ms <= endMs
        const recorded = byDay.get(day)
        window.push({
          day,
          inside,
          totalTokens: recorded?.totalTokens ?? 0,
          requests: recorded?.requests ?? 0,
        })
      }
      while (window.length % HEAT_ROWS !== 0) {
        const last = window[window.length - 1]
        window.push({
          day: dayKeyOf(parseDayKey(last.day).ms + 86_400_000),
          inside: false,
          totalTokens: 0,
          requests: 0,
        })
      }
      const breaks = heatBreaks(window.filter((cell) => cell.inside))
      const columns = []
      for (let index = 0; index < window.length; index += HEAT_ROWS) {
        columns.push(window.slice(index, index + HEAT_ROWS))
      }
      const levelOf = new Map()
      for (const cell of window) {
        if (cell.inside) levelOf.set(cell.day, heatLevel(cell.totalTokens, breaks))
      }
      return {
        columns,
        breaks,
        totals: { totalTokens: total, recordedDays },
        levelOf,
      }
    }

    /**
     * Normalize one payload into the shape the page renders, or `null`.
     *
     * The page indexes the series arrays directly and reads `totals` as a
     * record, so a payload missing either would throw mid-render and blank the
     * whole shell. Checking once here turns that into the ordinary "no data"
     * path — including a missing `totals`, which renders every KPI as an em
     * dash rather than raising `Cannot read properties of undefined`.
     * @param value - whatever the endpoint returned.
     * @returns a renderable payload, or `null` when the shape is wrong.
     */
    function normalizeDashboard(value) {
      if (value === null || typeof value !== 'object') return null
      for (const key of DASHBOARD_SERIES) {
        if (!Array.isArray(value[key])) return null
      }
      const totals = value.totals
      const meta = value.meta
      return {
        ...value,
        // `calendar` is the one series this page can do without: it is newer
        // than the other five, and a Host that predates it answers without the
        // key. Defaulting to an empty list keeps that Host renderable (the card
        // then shows only the empty cells) instead of rejecting the whole
        // payload over a series the rest of the page does not need.
        calendar: Array.isArray(value.calendar) ? value.calendar : [],
        totals: totals !== null && typeof totals === 'object' && !Array.isArray(totals) ? totals : {},
        meta: meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta : {},
      }
    }

    /**
     * Whether one payload is the shape the page renders.
     * @param value - whatever the endpoint returned.
     * @returns true only for a renderable dashboard payload.
     */
    function isDashboard(value) {
      return normalizeDashboard(value) !== null
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
      // One monotonically increasing generation per slot. A boolean "in flight"
      // flag could only drop a request: with the page polling every 30s, a range
      // click that landed while a poll was open was silently discarded, so the
      // control snapped back and the click appeared to do nothing. A generation
      // lets a newer request supersede an older one instead, and lets the older
      // one's late response be recognised as stale.
      let todayGeneration = 0
      let pageGeneration = 0
      let disposed = false

      const publish = (next) => {
        if (disposed) return
        snapshot = next
        for (const listener of [...listeners]) listener()
      }

      const fail = (error) => (error instanceof Error ? error.message : String(error))

      /**
       * Whether one thrown value is a deliberate abort rather than a failure.
       *
       * A fetch abort surfaces as a `DOMException` in the browser and an `Error`
       * in Node — and `DOMException` is not an `Error` subclass everywhere — so
       * this reads the name off whatever was thrown rather than testing the
       * prototype chain.
       */
      const isAbort = (error) => error !== null && typeof error === 'object' && error.name === 'AbortError'

      /**
       * Fetch one slot through the shared caller.
       *
       * The response is applied only while its generation is still the newest
       * for that slot, so a slow earlier request can never overwrite the result
       * of the one that superseded it.
       * @param slot - `today` or `page`.
       * @param range - range to request.
       * @param generation - the generation this request belongs to.
       * @param signal - abort signal from the caller.
       */
      async function fetchInto(slot, range, generation, signal) {
        const current = () => (slot === 'today' ? todayGeneration : pageGeneration) === generation
        if (!rpc.available) {
          if (current()) publish({ ...snapshot, [slot]: { ...snapshot[slot], status: 'unavailable', error: 'no-connection' } })
          return
        }
        publish({ ...snapshot, [slot]: { ...snapshot[slot], status: 'loading', error: '' } })
        try {
          const data = await rpc.call('dashboard', { range }, signal)
          if (current()) publish({ ...snapshot, [slot]: { ...snapshot[slot], status: 'ready', data, error: '' } })
        } catch (error) {
          // An abort is the caller's own doing (unmount, or a superseding
          // navigation), not a failure of the endpoint: surfacing it would draw
          // a red error box for a request nobody is waiting for any more.
          if (isAbort(error) || !current()) return
          publish({ ...snapshot, [slot]: { ...snapshot[slot], status: 'error', error: fail(error) } })
        }
      }

      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        /** Refresh the foot row's today figure, superseding any older read. */
        async loadToday(signal) {
          const generation = (todayGeneration += 1)
          await fetchInto('today', 'today', generation, signal)
        },
        /**
         * Refresh the page at one range.
         *
         * The requested range is published before the read so the control
         * reflects the click immediately, and the newest call wins.
         */
        async loadPage(range, signal) {
          const generation = (pageGeneration += 1)
          publish({ ...snapshot, page: { ...snapshot.page, range } })
          await fetchInto('page', range, generation, signal)
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

    /**
     * Measure an element's content width, falling back to a constant.
     *
     * The chart used to draw into a fixed `0 0 1000 190` viewBox stretched to
     * the panel with `preserveAspectRatio="none"`. Non-uniform scaling distorts
     * everything that is not a rectangle: tick labels and day labels came out
     * squeezed at 0.87x on a narrow panel and stretched at 1.6x on a wide one.
     * Measuring lets the viewBox match the rendered pixel width, so the scale
     * factor is exactly 1 and the text is drawn at its intended size.
     *
     * The fallback keeps a single render pass deterministic — in a test stub
     * (no `ResizeObserver`) and before the first measurement, the chart is
     * drawn exactly as it was before.
     * @param fallback - width to use until a measurement arrives.
     * @returns `[ref, width]`.
     */
    function useMeasuredWidth(fallback) {
      const ref = React.useRef(null)
      const [width, setWidth] = React.useState(0)
      // Layout effect where available so the real width is known before paint;
      // the test stubs carry only `useEffect`, hence the fallback.
      const useIso = React.useLayoutEffect ?? React.useEffect
      useIso(() => {
        const node = ref.current
        if (node === null || typeof node === 'undefined') return undefined
        if (typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver((entries) => {
          const next = Math.round(entries[0]?.contentRect?.width ?? 0)
          setWidth(next >= 240 ? next : 0)
        })
        observer.observe(node)
        return () => observer.disconnect()
      }, [])
      return [ref, width >= 240 ? width : fallback]
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

    /**
     * One labelled reading.
     *
     * The sub-line renders unconditionally, even when empty. Only some cards
     * carry one, and a card without it was shorter than its neighbours — so on
     * a row of mixed cards the big figures sat at different heights and the
     * grid read as ragged. An always-present `min-height` line keeps every card
     * in a row the same height and every value on the same baseline.
     * @param props - `{ label, value, sub?, tier? }`, `tier` being
     *   `primary` (headline figure) or `secondary` (compact reading).
     */
    function Kpi(props) {
      const primary = props.tier === 'primary'
      return jsxs('div', {
        className: `tkd_kpi ${primary ? 'tkd_kpiPrimary' : 'tkd_kpiSecondary'}`,
        children: [
          jsx('span', { className: 'tkd_kpiLabel', children: props.label }),
          jsx('span', { className: 'tkd_kpiValue', children: props.value }),
          jsx('span', { className: 'tkd_kpiSub', children: props.sub ?? '' }),
        ],
      })
    }

    /**
     * Stacked daily bar chart, with a hover tooltip per column.
     *
     * The viewBox tracks the measured pixel width so the scale factor is 1: at
     * a fixed 1000-wide viewBox stretched to the panel, every glyph was scaled
     * by however wide the panel happened to be.
     *
     * Hover is tracked in React state rather than left to the browser's native
     * `title`, because a native tooltip cannot show the four-segment breakdown
     * and lags the pointer by about a second.
     * @param props - `{ days, t }`.
     */
    function Chart(props) {
      const { days, t } = props
      const columns = bucketDays(days, 30)
      const peak = chartPeak(columns)
      const [boxRef, width] = useMeasuredWidth(1000)
      // The index of the hovered column, or -1. Kept as an index (not an object)
      // so a re-measure that rebuilds `columns` cannot leave stale figures on
      // screen: the tooltip always reads the current column at that index.
      const [hover, setHover] = React.useState(-1)
      const height = 190
      const padLeft = 52
      const padBottom = 22
      const plotWidth = width - padLeft - 8
      const plotHeight = height - padBottom - 8
      const slot = columns.length > 0 ? plotWidth / columns.length : plotWidth
      const barWidth = Math.max(2, Math.min(48, slot * 0.62))
      // Bars are scaled against the rounded axis top, not the raw peak: the top
      // gridline is labelled with the axis top, so a bar drawn against the peak
      // would reach the top line while reading as a smaller number.
      const axis = axisScale(peak)
      const scaleMax = axis.max > 0 ? axis.max : peak

      // Per-segment totals across the whole plot. A segment that is zero
      // everywhere has nothing to show, so its legend entry is dimmed rather
      // than removed: the four keys stay present for the aria description and
      // the reader learns that the segment exists but is unused.
      const segmentTotals = {}
      for (const column of columns) {
        for (const segment of columnSegments(column)) {
          segmentTotals[segment.key] = (segmentTotals[segment.key] ?? 0) + segment.value
        }
      }

      const bars = []
      const tracks = []
      const hits = []
      columns.forEach((column, index) => {
        const x = padLeft + slot * index + (slot - barWidth) / 2
        const total = columnTotal(column)
        const scaled = scaleMax > 0 ? (total / scaleMax) * plotHeight : 0
        const baseY = 8 + plotHeight
        const active = index === hover
        // A faint full-height track marks the hovered column, so a day whose bar
        // is a hairline (or zero) is still visibly selected.
        tracks.push(jsx('rect', {
          className: active ? 'tkd_track tkd_trackOn' : 'tkd_track',
          x: padLeft + slot * index,
          y: 8,
          width: slot,
          height: plotHeight,
        }, `track-${index}`))
        // Stack bottom-up so each segment sits on the one before it.
        let cursor = baseY
        for (const segment of columnSegments(column)) {
          const height = total > 0 ? (segment.value / total) * scaled : 0
          if (height <= 0) continue
          cursor -= height
          bars.push(jsx('rect', {
            className: segment.className,
            x,
            y: cursor,
            width: barWidth,
            height: Math.max(0, height),
            rx: 2,
          }, `${segment.key}-${index}`))
        }
        // One hit area per column spanning the full slot and plot height, so the
        // pointer does not have to find a narrow bar.
        hits.push(jsx('rect', {
          className: 'tkd_hit',
          x: padLeft + slot * index,
          y: 0,
          width: slot,
          height,
          onMouseEnter: () => setHover(index),
          onMouseLeave: () => setHover((current) => (current === index ? -1 : current)),
        }, `hit-${index}`))
      })

      const ticks = []
      // The axis top is `step * 4`, so tick `i` sits at `step * i` and every
      // label is a multiple of the step itself.
      const tickStep = axis.step > 0 ? axis.step : scaleMax / 4
      for (let i = 0; i <= 4; i += 1) {
        const y = 8 + plotHeight - (plotHeight / 4) * i
        ticks.push(jsx('line', { className: 'tkd_axis', x1: padLeft, x2: width - 8, y1: y, y2: y }, `grid-${i}`))
        ticks.push(jsx('text', {
          className: 'tkd_tick',
          x: padLeft - 8,
          y: y + 3,
          textAnchor: 'end',
          children: formatAxisTick(tickStep * i, tickStep),
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

      const hovered = hover >= 0 && hover < columns.length ? columns[hover] : undefined
      // The tooltip is positioned against the hovered slot's centre, clamped so
      // it cannot hang past either edge of the plot.
      const tip = hovered === undefined ? null : (() => {
        const centre = padLeft + slot * hover + slot / 2
        const half = TIP_HALF_WIDTH
        const left = Math.max(half, Math.min(width - half, centre))
        const rows = columnSegments(hovered)
          .map((segment) => ({
            key: segment.key,
            swatch: LEGEND_SWATCH[segment.key],
            label: t(LEGEND_LABEL[segment.key]),
            value: segment.value,
          }))
          .reverse()
        return jsxs('div', {
          className: 'tkd_tip',
          // Anchored at the top of the plot, over the tall columns and clear of
          // the day labels underneath: a bar-anchored tooltip sat on the x-axis
          // label it belonged to, which read as though the label were wrong.
          style: { left: `${left}px`, top: '6px' },
          children: [
            jsxs('div', {
              children: [
                jsx('span', { className: 'tkd_tipTitle', children: hovered.label }),
                hovered.days > 1
                  ? jsx('span', { className: 'tkd_tipNote', children: `· ${hovered.days} ${t('chart.tipDays')}` })
                  : null,
              ],
            }),
            jsx('div', {
              className: 'tkd_tipGrid',
              children: rows.flatMap((row) => [
                jsxs('span', {
                  className: 'tkd_tipKey',
                  children: [
                    jsx('span', { className: `tkd_swatch ${row.swatch}`, key: 's' }),
                    jsx('span', { key: 'l', children: row.label }),
                  ],
                }, `${row.key}-k`),
                jsx('span', { className: 'tkd_tipVal', children: formatInt(row.value) }, `${row.key}-v`),
              ]),
            }),
            jsxs('div', {
              className: 'tkd_tipTotal',
              children: [
                jsx('span', { className: 'tkd_tipKey', children: t('chart.tipTotal') }),
                jsx('span', { className: 'tkd_tipVal', children: formatInt(columnTotal(hovered)) }),
              ],
            }),
          ],
        })
      })()

      return jsxs('div', {
        children: [
          jsxs('div', {
            className: 'tkd_chartBox',
            ref: boxRef,
            // The tooltip is a CHILD of the positioned box, not a sibling: an
            // absolutely positioned sibling resolves against the nearest
            // positioned ancestor further up the tree, which put the tooltip
            // over the KPI cards above the chart instead of over the chart.
            children: [
              jsxs('svg', {
                className: 'tkd_chart',
                width,
                height,
                viewBox: `0 0 ${width} ${height}`,
                role: 'img',
                'aria-label': t('chart.aria'),
                // Hovering is inherently pointer-driven; the equivalent for a
                // keyboard or screen reader is the by-day data itself, which the
                // cards and tables already carry, so nothing here is focusable.
                children: [...ticks, ...tracks, ...bars, ...labels, ...hits],
              }),
              tip,
            ],
          }),
          jsx('div', {
            className: 'tkd_legend',
            children: LEGEND.map((item) => jsxs('span', {
              className: (segmentTotals[item.key] ?? 0) > 0 ? undefined : 'tkd_legendZero',
              children: [
                jsx('span', { className: `tkd_swatch ${item.swatch}`, key: 's' }),
                jsx('span', { key: 'l', children: ` ${t(item.label)}` }),
              ],
            }, item.key)),
          }),
        ],
      })
    }

    /** Weekday rows of the heatmap, top to bottom; indices are `(getUTCDay()+6)%7`. */
    const HEAT_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

    /**
     * One month tick per column that starts a new month.
     *
     * A tick is drawn on the first column whose week contains the 1st, which is
     * how a contribution graph labels months without a run of duplicate label
     * collisions on weeks that straddle a boundary.
     * @param columns - week columns, each seven cells of `{ day, inside }`.
     * @returns `{ index, month }[]`, `month` being `1..12`.
     */
    function heatMonthTicks(columns) {
      const ticks = []
      let previous = null
      ;(columns ?? []).forEach((column, index) => {
        for (const cell of column ?? []) {
          const parsed = cell?.inside ? parseDayKey(cell.day) : undefined
          if (parsed === undefined || parsed.d !== 1) continue
          if (previous === parsed.m) continue
          previous = parsed.m
          ticks.push({ index, month: parsed.m })
          return
        }
      })
      return ticks
    }

    /**
     * The calendar heatmap: one square per day, one column per week.
     *
     * The window is a fixed trailing year, not the page's range, and the range
     * control says so in the card's sub-line. A contribution graph answers
     * "when was I busy" — which needs a stable window a reader can compare
     * against week over week — whereas the bar chart above answers "how much in
     * the range I picked". Letting the range drive both would leave the calendar
     * with a single square under "Today" and a year's worth under "All".
     * @param props - `{ calendar, meta, t }`.
     */
    function Heatmap(props) {
      const { calendar, meta, t } = props
      const [boxRef, width] = useMeasuredWidth(720)
      const model = React.useMemo(() => heatmapWindow(calendar, {
        now: meta?.now,
        utcOffsetMinutes: meta?.utcOffsetMinutes,
      }), [calendar, meta?.now, meta?.utcOffsetMinutes])
      const [hover, setHover] = React.useState('')

      if (model.totals.recordedDays === 0) {
        return jsx('p', { className: 'tkd_note', children: t('heat.empty') })
      }

      const plotWidth = Math.max(HEAT_CELL, width - HEAT_LABEL - HEAT_PAD_RIGHT)
      const columnWidth = plotWidth / Math.max(1, model.columns.length)
      // A hairline between cells reads as a fence, not as separation, so the gap
      // gives way before the cell does on a narrow pane, and the pitch is capped
      // on a wide one. Both ends are deliberate: a fixed 3px gap against an 8px
      // column dissolved the grid into hairlines at 520px, and letting 53
      // columns stretch across a 1000px panel grew them into chunky blocks that
      // read as a different chart. Cells stay 11-13px wherever there is room.
      const stride = Math.min(columnWidth, HEAT_STRIDE_MAX)
      const gap = Math.max(1, Math.min(HEAT_GAP, stride * 0.24))
      const cell = Math.max(3, Math.min(HEAT_CELL, stride - gap))
      const rowHeight = cell + gap
      const gridHeightTotal = HEAT_HEAD + HEAT_ROWS * rowHeight - gap + 4
      const plotLeft = HEAT_LABEL

      const monthLabels = heatMonthTicks(model.columns).map((tick) => (
        jsx('text', {
          className: 'tkd_tick',
          x: plotLeft + stride * tick.index,
          y: 9,
          children: t(`heat.month.${tick.month}`),
        }, `month-${tick.index}`)
      ))

      const weekdayLabels = HEAT_WEEKDAYS.map((name, row) => (
        jsx('text', {
          className: 'tkd_tick',
          x: plotLeft - 6,
          y: HEAT_HEAD + row * rowHeight + cell - 1,
          textAnchor: 'end',
          children: t(`heat.day.${name}`),
        }, `weekday-${row}`)
      ))

      const cells = []
      model.columns.forEach((column, columnIndex) => {
        column.forEach((cellData, rowIndex) => {
          if (!cellData.inside) return
          const level = model.levelOf.get(cellData.day) ?? 0
          const className = HEAT_LEVELS[level]
          cells.push(jsx('rect', {
            className: hover === cellData.day ? `${className} tkd_heatOn` : className,
            x: plotLeft + stride * columnIndex + (stride - cell) / 2,
            y: HEAT_HEAD + rowIndex * rowHeight,
            width: cell,
            height: cell,
            rx: 2,
            onMouseEnter: () => setHover(cellData.day),
            onMouseLeave: () => setHover((current) => (current === cellData.day ? '' : current)),
          }, cellData.day))
        })
      })

      const hovered = hover === '' ? undefined : model.columns
        .flat()
        .find((cellData) => cellData.inside && cellData.day === hover)
      const tip = hovered === undefined ? null : (() => {
        const weekday = HEAT_WEEKDAYS[(new Date(parseDayKey(hovered.day).ms).getUTCDay() + 6) % 7]
        // Anchored to the top of the hovered week's column, like the bar chart's
        // tooltip is anchored to its column. The alternative — one fixed corner
        // for the whole card — would leave the tooltip up to a year of columns
        // away from the cell it describes on a wide pane.
        const columnIndex = model.columns.findIndex((column) => column.some((cellData) => cellData.day === hovered.day))
        const centre = plotLeft + stride * columnIndex + stride / 2
        const half = TIP_HALF_WIDTH
        const left = Math.max(half, Math.min(width - half, centre))
        return jsxs('div', {
          className: 'tkd_tip',
          style: { left: `${left}px`, top: '0px' },
          children: [
            jsxs('div', {
              children: [
                jsx('span', { className: 'tkd_tipTitle', children: hovered.day }),
                jsx('span', { className: 'tkd_tipNote', children: `· ${t(`heat.day.${weekday}`)}` }),
              ],
            }),
            jsx('div', {
              className: 'tkd_tipGrid',
              children: [
                jsx('span', { className: 'tkd_tipKey', children: t('heat.total') }, 'k'),
                jsx('span', { className: 'tkd_tipVal', children: formatInt(hovered.totalTokens) }, 'v'),
                jsx('span', { className: 'tkd_tipKey', children: t('col.requests') }, 'rk'),
                jsx('span', { className: 'tkd_tipVal', children: formatInt(hovered.requests) }, 'rv'),
              ],
            }),
          ],
        })
      })()

      const legend = jsxs('div', {
        className: 'tkd_heatLegend',
        children: [
          jsx('span', { children: t('heat.less') }, 'less'),
          ...HEAT_LEVELS.map((className, level) => jsx('svg', {
            className: 'tkd_swatch',
            width: 10,
            height: 10,
            // An inline <svg>, not a <span>: the very same fill classes the grid
            // uses carry the swatch's shade. A span would need a parallel set of
            // background rules, and this project has already had two colour
            // ladders drift apart once.
            viewBox: '0 0 10 10',
            'aria-hidden': 'true',
            children: jsx('rect', { className: className, width: 10, height: 10, rx: 2 }),
          }, `level-${level}`)),
          jsx('span', { children: t('heat.more') }, 'more'),
          jsx('span', { className: 'tkd_heatGap' }, 'gap'),
          jsxs('span', {
            children: [
              t('heat.window'),
              ' · ',
              template(t('heat.days'), { count: formatInt(model.totals.recordedDays) }),
            ],
          }, 'window'),
        ],
      })

      return jsxs('div', {
        children: [
          jsxs('div', {
            className: 'tkd_heatBox',
            ref: boxRef,
            children: [
              jsxs('svg', {
                className: 'tkd_chart',
                width,
                height: gridHeightTotal,
                viewBox: `0 0 ${width} ${gridHeightTotal}`,
                role: 'img',
                'aria-label': t('heat.aria'),
                children: [
                  ...monthLabels,
                  ...weekdayLabels,
                  ...cells,
                ],
              }),
              tip,
            ],
          }),
          legend,
        ],
      })
    }

    /**
     * One generic table.
     * @param props - `{ columns, rows, t }` where a column is
     *   `{ key, label, mono?, truncate?, render? }` and a row is a plain
     *   object. `truncate` clips a long value with an ellipsis and keeps the
     *   full text in `title` — a project path is long and unbreakable, and
     *   `white-space:nowrap` on the cell turned it into a horizontal scrollbar
     *   that pushed the numeric columns out of view.
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
                  const text = value === undefined || value === null ? '—' : value
                  return jsx('td', {
                    className: column.mono ? 'tkd_mono' : undefined,
                    children: column.truncate
                      ? jsx('span', { className: 'tkd_trunc', title: String(text), children: text })
                      : text,
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
      // throw out of render and blank the whole shell. Normalizing (rather than
      // only testing) also supplies the `totals`/`meta` records the KPI cards
      // read, so a payload that carries the series but no totals renders em
      // dashes instead of throwing on `totals.totalTokens`.
      const data = normalizeDashboard(page.data)
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
                // The button is icon-only, so without these it has no
                // accessible name at all and announces as just "button".
                title: t('page.refresh'),
                'aria-label': t('page.refresh'),
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
                jsxs('div', {
                  className: 'tkd_kpiPrimaryRow',
                  children: [
                    jsx(Kpi, {
                      tier: 'primary',
                      label: t('kpi.total'),
                      value: formatTokens(totals.totalTokens),
                      sub: formatInt(totals.totalTokens),
                    }, 'total'),
                    jsx(Kpi, {
                      tier: 'primary',
                      label: t('kpi.nonCached'),
                      value: formatTokens(totals.nonCachedTokens),
                      sub: t('kpi.nonCachedHint'),
                    }, 'nonCached'),
                    jsx(Kpi, {
                      tier: 'primary',
                      label: t('kpi.cacheRead'),
                      value: formatTokens(totals.cacheReadTokens),
                      sub: formatRate(totals.cacheHitRate),
                    }, 'cache'),
                  ],
                }),
                jsxs('div', {
                  className: 'tkd_kpiSecondaryRow',
                  children: [
                    jsx(Kpi, { tier: 'secondary', label: t('kpi.input'), value: formatTokens(totals.inputTokens) }, 'input'),
                    jsx(Kpi, { tier: 'secondary', label: t('kpi.output'), value: formatTokens(totals.outputTokens) }, 'output'),
                    jsx(Kpi, { tier: 'secondary', label: t('kpi.reasoning'), value: formatTokens(totals.reasoningTokens) }, 'reasoning'),
                    jsx(Kpi, {
                      tier: 'secondary',
                      label: t('kpi.requests'),
                      value: formatInt(totals.requests),
                      sub: totals.errors > 0 ? `${formatInt(totals.errors)} ${t('kpi.errors')}` : undefined,
                    }, 'requests'),
                    jsx(Kpi, { tier: 'secondary', label: t('kpi.ttft'), value: formatMs(totals.avgTtftMs) }, 'ttft'),
                    jsx(Kpi, { tier: 'secondary', label: t('kpi.avgDuration'), value: formatMs(totals.avgDurationMs) }, 'duration'),
                  ],
                }),
              ],
            }),
            jsxs('section', {
              className: 'tkd_card',
              children: [
                jsx('h2', { className: 'tkd_cardTitle', children: t('chart.title') }),
                jsx(Chart, { days: data.days, t }),
              ],
            }),
            jsxs('section', {
              className: 'tkd_card',
              children: [
                jsxs('div', {
                  className: 'tkd_cardHead',
                  children: [
                    jsx('h2', { className: 'tkd_cardTitle', children: t('heat.title') }),
                    // The card states its own window: it is not the page's range,
                    // and a reader who assumed it followed the range control would
                    // read a year of history as a week of it.
                    jsx('span', { className: 'tkd_cardNote', children: t('heat.subtitle') }),
                  ],
                }),
                jsx(Heatmap, { calendar: data.calendar, meta, t }),
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
            jsxs('div', {
              className: 'tkd_grid2',
              children: [
                jsx(TableCard, {
                  title: t('table.projects'),
                  t,
                  empty: t('table.empty'),
                  rows: data.projects,
                  columns: [
                    { key: 'cwd', label: t('col.project'), mono: true, truncate: true },
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
                jsx('p', {
                  className: 'tkd_note',
                  children: template(t('page.footnote'), { zone: formatUtcOffset(meta?.utcOffsetMinutes) }),
                }),
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
      'page.refresh': '刷新',
      'page.footnote': '按 {zone} 计日；输入与输出分别统计，缓存命中与缓存写入单列，不折算价格。',
      'range.label': '统计区间',
      'range.today': '今日',
      'range.7d': '近 7 天',
      'range.30d': '近 30 天',
      'range.all': '全部',
      'chart.title': '每日用量',
      'chart.input': '输入',
      'chart.output': '输出',
      'chart.cache': '缓存读取',
      'chart.cacheWrite': '缓存写入',
      'chart.empty': '该区间内没有记录。',
      'chart.aria': '每日 token 用量柱状图，自下而上依次为缓存读取、缓存写入、输入、输出；悬停某一天可看当天明细',
      'chart.tipTotal': '合计',
      'chart.tipDays': '天合计',
      'heat.title': '用量日历',
      'heat.subtitle': '近一年，与上方区间无关',
      'heat.total': '合计',
      'heat.less': '少',
      'heat.more': '多',
      'heat.window': '近一年',
      'heat.days': '记录到 {count} 天',
      'heat.empty': '近一年内还没有记录。',
      'heat.aria': '近一年每日 token 用量日历热力图，每格一天，颜色越深当天用量越大；悬停某天可看当天合计',
      'heat.day.mon': '一',
      'heat.day.tue': '二',
      'heat.day.wed': '三',
      'heat.day.thu': '四',
      'heat.day.fri': '五',
      'heat.day.sat': '六',
      'heat.day.sun': '日',
      'heat.month.1': '1月',
      'heat.month.2': '2月',
      'heat.month.3': '3月',
      'heat.month.4': '4月',
      'heat.month.5': '5月',
      'heat.month.6': '6月',
      'heat.month.7': '7月',
      'heat.month.8': '8月',
      'heat.month.9': '9月',
      'heat.month.10': '10月',
      'heat.month.11': '11月',
      'heat.month.12': '12月',
      'kpi.total': '总 token',
      'kpi.nonCached': '非缓存 token',
      'kpi.nonCachedHint': '未命中缓存的输入 + 输出',
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
      'page.refresh': 'Refresh',
      'page.footnote': 'Days are cut at {zone}. Input and output are counted separately and cache reads and writes are listed on their own; no price is applied.',
      'range.label': 'Range',
      'range.today': 'Today',
      'range.7d': 'Last 7 days',
      'range.30d': 'Last 30 days',
      'range.all': 'All',
      'chart.title': 'Daily usage',
      'chart.input': 'input',
      'chart.output': 'output',
      'chart.cache': 'cache read',
      'chart.cacheWrite': 'cache write',
      'chart.empty': 'No records in this range.',
      'chart.aria': 'Daily token usage bar chart, bottom to top: cache reads, cache writes, input, output; hover a day for its detail',
      'chart.tipTotal': 'Total',
      'chart.tipDays': 'day bucket',
      'heat.title': 'Usage calendar',
      'heat.subtitle': 'last 12 months, independent of the range above',
      'heat.total': 'Total',
      'heat.less': 'less',
      'heat.more': 'more',
      'heat.window': 'last 12 months',
      'heat.days': 'recorded on {count} days',
      'heat.empty': 'Nothing recorded in the last 12 months.',
      'heat.aria': 'Calendar heatmap of daily token usage over the last 12 months: one cell per day, darker for a heavier day; hover a day for its total',
      'heat.day.mon': 'Mon',
      'heat.day.tue': 'Tue',
      'heat.day.wed': 'Wed',
      'heat.day.thu': 'Thu',
      'heat.day.fri': 'Fri',
      'heat.day.sat': 'Sat',
      'heat.day.sun': 'Sun',
      'heat.month.1': 'Jan',
      'heat.month.2': 'Feb',
      'heat.month.3': 'Mar',
      'heat.month.4': 'Apr',
      'heat.month.5': 'May',
      'heat.month.6': 'Jun',
      'heat.month.7': 'Jul',
      'heat.month.8': 'Aug',
      'heat.month.9': 'Sep',
      'heat.month.10': 'Oct',
      'heat.month.11': 'Nov',
      'heat.month.12': 'Dec',
      'kpi.total': 'Total tokens',
      'kpi.nonCached': 'Non-cached tokens',
      'kpi.nonCachedHint': 'uncached input + output',
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
    exports.Heatmap = Heatmap

    /** Test seam: pure helpers, exercised by test/client-check.cjs. */
    exports.__internal = {
      formatInt,
      formatTokens,
      formatRate,
      formatMs,
      formatClock,
      formatDayShort,
      formatUtcOffset,
      formatAxisTick,
      niceStep,
      axisScale,
      template,
      normalizeDashboard,
      isDashboard,
      chartPeak,
      columnSegments,
      columnTotal,
      bucketDays,
      parseDayKey,
      dayKeyOf,
      heatBreaks,
      heatLevel,
      heatmapWindow,
      heatMonthTicks,
      HEAT_LEVELS,
      HEAT_WINDOW_DAYS,
      TIP_HALF_WIDTH,
      CSS,
      zh,
      en,
      PANEL_ID,
      NS,
      RANGES,
    }

    return module.exports
  },
})
