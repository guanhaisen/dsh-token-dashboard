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
/* ── sidebar foot ──────────────────────────────────────────────────────────
   The entry above the account row. The icon sits on a tinted tile so the row
   reads as a destination rather than as another label, and the day's figure is
   a pill: a bare number at 12px was indistinguishable from the timestamp
   beside it. */
.tkd_foot{flex:none;align-items:center;width:100%;display:flex;position:relative}
.tkd_footRail{width:36px;height:36px;margin:0}
.tkd_footButton{box-sizing:border-box;width:calc(100% + 4px);height:42px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:10px;align-items:center;gap:9px;margin:0 -2px;padding:0 10px 0 8px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}
.tkd_footButton:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tkd_footButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.tkd_footRail .tkd_footButton{corner-shape:round;border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;margin:0;padding:0}
.tkd_footIcon{flex:none;justify-content:center;align-items:center;width:22px;height:22px;border-radius:7px;color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);display:inline-flex}
.tkd_footLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.tkd_footValue{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;font-variant-numeric:tabular-nums;flex:none;margin-left:auto;padding:1px 7px;font-size:11px;line-height:18px}

/* ── page frame ────────────────────────────────────────────────────────────
   A column container, because the panel is resizable inside the main pane:
   every breakpoint below queries this container, never the viewport. The four
   segment opacities live here so the chart, its legend and its tooltip all read
   one ladder. */
.tkd_page{box-sizing:border-box;height:100%;color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;gap:0;padding:0 clamp(20px,3.6vw,44px) 48px;display:flex;overflow:auto;container:tkd/inline-size;--tkd-op-cache:.26;--tkd-op-cacheWrite:.52;--tkd-op-in:.7;--tkd-op-out:1;--tkd-line:var(--dsw-alias-border-l1)}
.tkd_head{box-sizing:border-box;justify-content:space-between;align-items:flex-end;gap:14px 24px;padding-top:calc(26px + var(--dsh-frame-top-clearance,0px));width:100%;max-width:1180px;display:flex;flex-wrap:wrap}
.tkd_headMain{min-width:0;flex-direction:column;gap:4px;display:flex}
.tkd_eyebrow{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;letter-spacing:.09em;line-height:16px;text-transform:uppercase}
.tkd_title{margin:0;font-size:26px;font-weight:600;letter-spacing:-.015em;line-height:34px}
.tkd_intro{color:var(--dsw-alias-label-secondary);align-items:center;margin:2px 0 0;font-size:12.5px;line-height:20px;display:flex;flex-wrap:wrap}
.tkd_metaItem{align-items:center;display:inline-flex}
/* A drawn separator rather than a typed middot: the dot then disappears with
   its item instead of doubling when a timestamp is missing. */
.tkd_metaItem+.tkd_metaItem:before{content:"";background:currentColor;border-radius:50%;width:3px;height:3px;margin:0 8px;opacity:.45;display:inline-block}
.tkd_headActions{align-items:center;gap:8px;flex:none;display:flex}
.tkd_ghost{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);height:30px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;align-items:center;gap:6px;padding:0 10px;font-size:13px;display:inline-flex}
.tkd_ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.tkd_ghost:disabled{opacity:.5;cursor:default}
.tkd_body{width:100%;max-width:1180px;flex-direction:column;gap:18px;display:flex;margin-top:22px}

/* ── readings ──────────────────────────────────────────────────────────────
   Three headline surfaces over one compact strip. The headline row carries the
   tinted fill because those are the figures the page exists to answer; the
   strip is a single surface cut into cells by 1px gaps, so six small readings
   cost one border instead of six. */
.tkd_kpis{flex-direction:column;gap:12px;display:flex}
.tkd_kpiPrimaryRow{grid-template-columns:1.3fr 1fr 1fr;gap:12px;display:grid}
.tkd_kpiSecondaryRow{grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;background:var(--tkd-line);border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg);display:grid;overflow:hidden}
.tkd_kpi{box-sizing:border-box;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill);flex-direction:column;gap:5px;padding:16px 18px;display:flex;min-width:0}
.tkd_kpiTop{justify-content:space-between;align-items:baseline;gap:10px;display:flex;min-width:0}
.tkd_kpiLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:16px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.tkd_kpiValue{font-variant-numeric:tabular-nums;font-size:20px;font-weight:600;line-height:26px;letter-spacing:-.01em;align-items:baseline;gap:2px;display:flex;min-width:0}
.tkd_unit{color:var(--dsw-alias-label-tertiary);font-size:.66em;font-weight:500;line-height:1}
.tkd_kpiSub{color:var(--dsw-alias-label-caption);font-size:11px;line-height:17px;min-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tkd_kpiPrimary{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 3.5%,var(--dsw-alias-settings-card-fill));border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 15%,var(--dsw-alias-settings-card-stroke));border-radius:var(--dsw-radius-xl);padding:18px 20px}
.tkd_kpiPrimary .tkd_kpiValue{font-size:28px;line-height:34px;letter-spacing:-.02em}
.tkd_kpiPrimary .tkd_kpiLabel{color:var(--dsw-alias-label-secondary)}
.tkd_kpiHero{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6.5%,var(--dsw-alias-settings-card-fill));gap:6px}
.tkd_kpiSecondary{background:var(--dsw-alias-settings-card-fill);border:none;border-radius:0;gap:3px;padding:12px 14px}
.tkd_kpiSecondary .tkd_kpiValue{font-size:16px;line-height:22px}
.tkd_kpiSecondary .tkd_kpiLabel{color:var(--dsw-alias-label-tertiary)}
/* The period-over-period chip. Up is not bad and down is not good here — this
   is consumption, not a target — so the colour is neutral for both directions
   and only the arrow carries the direction. */
.tkd_trend{font-size:11px;line-height:16px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums;flex:none}
.tkd_trendUp,.tkd_trendDown,.tkd_trendFlat,.tkd_trendNew{color:var(--dsw-alias-label-secondary)}
/* The arrow is the only thing carrying direction, so it is drawn with a gap
   rather than as part of the number. */
.tkd_trendUp:before{content:"↑";margin-right:3px}
.tkd_trendDown:before{content:"↓";margin-right:3px}
.tkd_trendFlat:before{content:"→";margin-right:3px}

/* The composition bar: the one figure the page is about, split into the same
   four segments the chart stacks. Widths are flex-grow ratios, so the bar is
   exact at any width without a second layout pass. */
.tkd_comp{background:var(--dsw-alias-border-l1);border-radius:999px;height:8px;gap:1.5px;flex-direction:row;display:flex;overflow:hidden;margin-top:3px}
.tkd_compSeg{background:var(--dsw-alias-state-business-primary);flex-basis:0;flex-shrink:0;min-width:0;display:block;border-radius:999px}
.tkd_compCache{opacity:var(--tkd-op-cache)}
.tkd_compCacheWrite{opacity:var(--tkd-op-cacheWrite)}
.tkd_compIn{opacity:var(--tkd-op-in)}
.tkd_compOut{opacity:var(--tkd-op-out)}
/* Two fixed columns rather than a wrapping run: the four segment names differ in
   width between locales, and a free wrap broke 3+1 in English and 4+0 in
   Chinese. A grid is the same shape in every language. */
.tkd_compLegend{grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 10px;display:grid}
.tkd_compItem{align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;display:flex;min-width:0}
.tkd_compName{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tkd_compVal{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;flex:none;margin-left:auto}

/* ── cards ─────────────────────────────────────────────────────────────────
   One surface, one title row, one rhythm. Cards are the quiet layer: the
   tinted readings above them are the only things that shout. */
.tkd_card{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill);flex-direction:column;gap:14px;padding:18px 20px;display:flex;min-width:0}
.tkd_cardTitle{margin:0;font-size:14px;font-weight:600;line-height:20px;letter-spacing:-.005em}
.tkd_cardHead{justify-content:space-between;align-items:baseline;gap:4px 16px;display:flex;flex-wrap:wrap}
.tkd_cardNote{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11.5px;line-height:18px}
.tkd_grid2{grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start;gap:18px;display:grid}
.tkd_chartBox{min-width:0;width:100%;position:relative}
.tkd_chart{width:100%;display:block;overflow:visible}

/* ── stacked bars ──────────────────────────────────────────────────────────
   One opacity per segment, shared by its bar, its legend swatch and its row in
   the tooltip. They were parallel ladders once and drifted, so a legend
   promised a shade the bar never drew; each segment now names its own variable
   and the surfaces can only ever agree. */
.tkd_bar,.tkd_swatch{fill:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);opacity:var(--tkd-op-out)}
.tkd_barAlt,.tkd_swatchAlt{fill:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);opacity:var(--tkd-op-in)}
.tkd_barCache,.tkd_swatchCache{fill:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);opacity:var(--tkd-op-cache)}
.tkd_barCacheWrite,.tkd_swatchCacheWrite{fill:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);opacity:var(--tkd-op-cacheWrite)}
/* Gridlines are hairline dashes so the bars, not the rules, carry the contrast.
   The baseline is the one rule that stays solid: it is the axis's zero. */
.tkd_axis{stroke:var(--dsw-alias-border-l1);stroke-width:1;stroke-dasharray:2 4}
.tkd_axisBase{stroke:var(--dsw-alias-border-l3);stroke-dasharray:none}
/* Text and gridlines must not swallow the pointer: the column hit areas sit on
   top of the plot and are what drive the tooltip. */
.tkd_axis,.tkd_tick{pointer-events:none}
.tkd_tick{fill:var(--dsw-alias-label-caption);font-size:10px;font-variant-numeric:tabular-nums}
/* One full-height hit area per column, so the whole slot is hoverable rather
   than only the (often thin) bar itself. */
.tkd_hit{fill:transparent}
.tkd_track{fill:transparent;pointer-events:none}
.tkd_trackOn{fill:color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,transparent)}
/* The column for the Host's own current day, marked even when nothing else is
   hovered: on a day still in progress its bar is the shortest of the range. */
.tkd_trackToday{fill:color-mix(in srgb,var(--dsw-alias-state-business-primary) 4%,transparent)}
/* The tooltip follows the shell's own: same background and text colour, so it
   reads as the same surface as every other tooltip in the app.
   The max-width is load-bearing, not cosmetic: the tooltip is centred on its
   column and pulled inward at the edges using a fixed half-width, so the half
   width has to be a real upper bound. The figures stay nowrap (a broken number
   is unreadable) while a long label wraps instead of overflowing. */
.tkd_tip{position:absolute;z-index:100;pointer-events:none;transform:translate(-50%,0);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00);border-radius:var(--dsw-radius-sm);box-shadow:var(--dsw-shadow-lv2,0 6px 20px #00000026);padding:8px 11px;font-size:12px;line-height:18px;max-width:220px}
.tkd_tipTitle{font-weight:600;white-space:nowrap}
.tkd_tipNote{opacity:.7;font-weight:400;margin-left:6px}
.tkd_tipGrid{margin-top:6px;grid-template-columns:auto auto;gap:2px 16px;display:grid}
.tkd_tipKey{align-items:center;gap:6px;display:flex;opacity:.85}
.tkd_tipVal{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.tkd_tipTotal{border-top:.5px solid rgba(255,255,255,.22);margin-top:6px;padding-top:6px;display:grid;grid-template-columns:auto auto;gap:2px 16px}

/* ── chart legend ──────────────────────────────────────────────────────────
   Chips, not a run of loose dots: each segment carries its total for the range,
   so the legend doubles as the four parts of the headline total above. */
.tkd_legend{align-items:center;gap:6px;flex-wrap:wrap;display:flex}
.tkd_legendItem{align-items:center;gap:6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px 3px 8px;font-size:11.5px;line-height:16px;display:inline-flex}
.tkd_legendName{color:var(--dsw-alias-label-secondary)}
.tkd_legendVal{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:600}
.tkd_legendZero{opacity:.45}
.tkd_swatch{border-radius:2px;flex:none;width:9px;height:9px;display:inline-block}

/* ── usage calendar ────────────────────────────────────────────────────────
   One square per day, shaded by the day's total against the window's own
   quartiles. The shade is carried by fill-opacity rather than opacity: the
   hovered cell is outlined with a stroke, and a plain opacity would fade that
   outline along with the fill. Level 0 is drawn in the lightest border tone,
   so an empty day and a light day stay distinguishable. */
.tkd_heat0{fill:var(--dsw-alias-border-l1)}
.tkd_heat1{fill:var(--dsw-alias-state-business-primary);fill-opacity:.25}
.tkd_heat2{fill:var(--dsw-alias-state-business-primary);fill-opacity:.48}
.tkd_heat3{fill:var(--dsw-alias-state-business-primary);fill-opacity:.72}
.tkd_heat4{fill:var(--dsw-alias-state-business-primary);fill-opacity:1}
.tkd_heatOn{stroke:var(--dsw-alias-label-primary);stroke-width:1}
.tkd_heatBox{min-width:0;width:100%;position:relative}
.tkd_heatLegend{align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;flex-wrap:wrap;display:flex}
.tkd_heatGap{width:12px;flex:none}
/* The grid answers "when"; this rail answers "how much of the year" without
   making the reader count squares. Two columns rather than one: as a single
   stack the four readings were taller than the grid beside them, so the card
   grew to the rail's height and left a band of empty space under the calendar.
   It gives way entirely on a narrow pane — the grid is the card, the rail is
   the annotation. */
.tkd_heatLayout{grid-template-columns:minmax(0,1fr) 236px;align-items:start;gap:22px;display:grid}
.tkd_heatMain{min-width:0;flex-direction:column;gap:10px;display:flex}
.tkd_heatStats{grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px;display:grid;min-width:0;border-left:.5px solid var(--tkd-line);padding-left:18px;align-content:start}
.tkd_heatStat{border-bottom:.5px solid var(--tkd-line);flex-direction:column;gap:1px;padding:7px 0;display:flex;min-width:0}
.tkd_heatStat:first-child,.tkd_heatStat:nth-child(2){padding-top:0}
.tkd_heatStat:nth-last-child(-n+2){border-bottom:none}
.tkd_heatStatLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tkd_heatStatValue{font-variant-numeric:tabular-nums;font-size:15px;font-weight:600;line-height:22px;align-items:baseline;gap:2px;display:flex;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tkd_heatStatSub{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── tables ────────────────────────────────────────────────────────────────
   Numerals are tabular and right-aligned so columns of figures line up; rows
   are separated by a hairline and lit on hover, because a long call log is read
   by following one line across, not by scanning every cell. */
.tkd_table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.tkd_table th{color:var(--dsw-alias-label-tertiary);text-align:right;font-weight:500;padding:6px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:11.5px;white-space:nowrap}
.tkd_table thead th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-settings-card-fill)}
.tkd_table th:first-child,.tkd_table td:first-child{text-align:left;padding-left:4px}
.tkd_table th:last-child,.tkd_table td:last-child{padding-right:4px}
.tkd_table td{text-align:right;font-variant-numeric:tabular-nums;padding:8px;border-bottom:.5px solid var(--tkd-line);white-space:nowrap;transition:background .12s ease}
.tkd_table tbody tr:last-child td{border-bottom:none}
.tkd_table tbody tr:hover td{background:var(--dsw-alias-interactive-bg-hover)}
.tkd_table tbody tr:hover td:first-child{border-radius:6px 0 0 6px}
.tkd_table tbody tr:hover td:last-child{border-radius:0 6px 6px 0}
/* A cell that carries two lines: the value a reader scans for, and the context
   that made it unique. Both clip; the full text stays in the cell's title. */
.tkd_cellStack{text-align:left;flex-direction:column;gap:1px;display:flex;min-width:0;max-width:320px}
.tkd_trunc{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.tkd_cellMain{text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tkd_cellSub{color:var(--dsw-alias-label-caption);font-family:inherit;font-size:11px;line-height:15px;overflow:hidden;text-overflow:ellipsis}
.tkd_mono{font-family:var(--ds-font-family-code,monospace);font-size:12px}
.tkd_scroll{margin:0 -4px;padding:0 4px;max-height:330px;overflow:auto;scrollbar-width:thin;
  mask-image:linear-gradient(to bottom,#000 calc(100% - 14px),transparent 100%);
  -webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 14px),transparent 100%)}
/* The ranking tables are short and sit in cards that size to their content, so
   they scroll with the page instead of inside a 330px box: an inner scrollbar
   in a card shorter than the box can never be reached, and the mask above would
   fade a table that has nothing below it. */
.tkd_noScroll{max-height:none;overflow:visible;mask-image:none;-webkit-mask-image:none}
/* The share bar turns a column of totals into a ranking: the figure stays the
   reading, the track behind it is the comparison. */
.tkd_share{justify-content:flex-end;align-items:center;width:100%;min-width:112px;display:inline-flex;position:relative}
.tkd_shareFill{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 13%,transparent);border-radius:3px;height:19px;position:absolute;inset:0 auto 0 0}
.tkd_shareValue{font-variant-numeric:tabular-nums;position:relative;z-index:1}

/* ── status and states ─────────────────────────────────────────────────────*/
.tkd_ok{color:var(--dsw-alias-state-success-primary)}
.tkd_err{color:var(--dsw-alias-state-error-primary)}
.tkd_pill{border-radius:999px;padding:1px 8px;font-size:11px;line-height:18px;display:inline-block}
.tkd_pillOk{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent)}
.tkd_pillErr{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 11%,transparent)}
.tkd_state{box-sizing:border-box;width:100%;max-width:1180px;margin-top:22px;border:.5px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xl);color:var(--dsw-alias-label-secondary);text-align:center;flex-direction:column;align-items:center;gap:6px;padding:56px 28px;font-size:13px;line-height:21px;display:flex}
.tkd_stateTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:22px}
.tkd_stateText{margin:0;max-width:52ch}
.tkd_stateDetail{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,monospace);text-align:left;max-width:60ch;padding:5px 9px;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.tkd_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.tkd_colophon{border-top:.5px solid var(--tkd-line);width:100%;max-width:1180px;padding-top:14px;margin-top:18px}

/* ── breakpoints ───────────────────────────────────────────────────────────
   Container queries, not viewport ones: this panel lives in a resizable main
   pane, so a wide window with a narrow pane must reflow too. */
@container tkd (max-width:980px){
.tkd_kpiPrimaryRow{grid-template-columns:repeat(3,minmax(0,1fr))}
.tkd_kpiPrimary .tkd_kpiValue{font-size:23px;line-height:30px}
/* The six-cell strip stays six across here: wrapping it to three would leave
   two rows of three and a hole under the shorter one. It only splits when the
   cells genuinely cannot hold a label, at 640px. */
.tkd_kpiSecondary .tkd_kpiValue{font-size:15px}
}
@container tkd (max-width:860px){
.tkd_heatLayout{grid-template-columns:minmax(0,1fr)}
.tkd_heatStats{flex-direction:row;flex-wrap:wrap;border-left:none;border-top:.5px solid var(--tkd-line);padding-left:0;padding-top:4px;gap:0 18px}
.tkd_heatStat{border-bottom:none;flex:1 1 110px;padding:6px 0}
.tkd_heatStat:first-child{padding-top:6px}
}
@container tkd (max-width:640px){
.tkd_kpiPrimaryRow{grid-template-columns:minmax(0,1fr)}
.tkd_kpiSecondaryRow{grid-template-columns:repeat(2,minmax(0,1fr))}
.tkd_headActions{width:100%}
.tkd_intro{font-size:12px}
.tkd_trunc{max-width:160px}
.tkd_card{padding:16px}
.tkd_kpiPrimary{padding:16px 18px}
.tkd_compLegend{gap:2px 10px}
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

    /**
     * Split a project path into its last segment and the directory above it.
     *
     * A Windows `D:\\VibeCoding\\Deepseek\\dsh001` and a POSIX
     * `/home/me/src/app` both end in the folder a reader recognises; the
     * separators in front of it are what made the column unreadable, because
     * every row shared the first thirty characters. The full path stays in the
     * row's `title`, so nothing is lost.
     * @param cwd - the recorded working directory.
     * @returns `{ name, parent }`; both empty for a non-string.
     */
    function splitProject(cwd) {
      const value = typeof cwd === 'string' ? cwd.replace(/[\\/]+$/, '') : ''
      if (value === '') return { name: '', parent: '' }
      const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'))
      if (index === -1) return { name: value, parent: '' }
      return { name: value.slice(index + 1), parent: value.slice(0, index) }
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
      { key: 'cache', field: 'cacheReadTokens', swatch: 'tkd_swatchCache', label: 'chart.cache' },
      { key: 'cacheWrite', field: 'cacheWriteTokens', swatch: 'tkd_swatchCacheWrite', label: 'chart.cacheWrite' },
      { key: 'in', field: 'inputTokens', swatch: 'tkd_swatchAlt', label: 'chart.input' },
      { key: 'out', field: 'outputTokens', swatch: 'tkd_swatch', label: 'chart.output' },
    ]

    /** Swatch class per segment key. */
    const LEGEND_SWATCH = Object.fromEntries(LEGEND.map((item) => [item.key, item.swatch]))
    /** Locale key per segment key. */
    const LEGEND_LABEL = Object.fromEntries(LEGEND.map((item) => [item.key, item.label]))
    /**
     * Counter field per segment key.
     *
     * Declared beside the label rather than derived from the key: `cache` reads
     * from `cacheReadTokens`, so a `${key}Tokens` template silently produced
     * `cacheTokens`, which the payload does not carry — the share line then
     * rendered em dashes for a reason no reader could act on.
     */
    const LEGEND_FIELD = Object.fromEntries(LEGEND.map((item) => [item.key, item.field]))
    /**
     * Fill class per segment key, for the composition bar on the headline card.
     *
     * Spelled out rather than built from the key: the same ladder as the chart's
     * bars, so the thin slice under the total and the tall stack in the chart
     * read as the same four things.
     */
    const COMPOSE_FILL = {
      cache: 'tkd_compCache',
      cacheWrite: 'tkd_compCacheWrite',
      in: 'tkd_compIn',
      out: 'tkd_compOut',
    }

    /** The shared class every slice of the composition bar carries. */
    const COMPOSE_SEG = 'tkd_compSeg'

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
     * @param props - `{ label, value, unit?, sub?, tier?, trend?, extra? }`,
     *   `tier` being `primary` (headline figure), `hero` (the first of them) or
     *   `secondary` (one cell of the compact strip).
     */
    function Kpi(props) {
      const tier = props.tier ?? 'secondary'
      // The trend chip rides on the label line, not the sub-line: the sub-line
      // is the card's caption and the comparison belongs to the figure, so a
      // reader pairing them does not have to look past an intervening string.
      const labelLine = jsxs('span', {
        className: 'tkd_kpiTop',
        children: [
          jsx('span', { className: 'tkd_kpiLabel', children: props.label }),
          props.trend ?? null,
        ],
      })
      return jsxs('div', {
        className: `tkd_kpi tkd_kpi${tier.charAt(0).toUpperCase()}${tier.slice(1)}`,
        children: [
          labelLine,
          jsxs('span', {
            className: 'tkd_kpiValue',
            children: [
              props.value,
              props.unit === undefined ? null : jsx('span', { className: 'tkd_unit', children: props.unit }),
            ],
          }),
          jsx('span', { className: 'tkd_kpiSub', children: props.sub ?? '' }),
          props.extra ?? null,
        ],
      })
    }

    /**
     * Split one compact value into its figure and its unit.
     *
     * The unit is set smaller and in the tertiary tone: `952.59M` at one size
     * makes the reader parse five glyphs to find a three-digit number, and on a
     * narrow pane the whole string was what pushed a headline card into
     * truncating. Splitting is purely presentational — the value is still one
     * formatted string.
     * @param text - output of {@link formatTokens} or {@link formatInt}.
     * @returns `{ figure, unit? }`; `unit` is undefined when there is none.
     */
    function splitUnit(text) {
      const value = String(text ?? '')
      const match = /^(-?[\d.,]+)([KMB])$/.exec(value)
      if (match === null) return { figure: value }
      return { figure: match[1], unit: match[2] }
    }

    /** A headline reading in the split-value form the cards use. */
    function kpiValue(text) {
      const { figure, unit } = splitUnit(text)
      return { value: figure, unit }
    }

    /** Direction class per sign, spelled out so the stylesheet's classes stay literal. */
    const TREND_CLASS = { up: 'tkd_trend tkd_trendUp', down: 'tkd_trend tkd_trendDown' }

    /**
     * The period-over-period chip.
     *
     * Consumption is not a target, so a rise is not painted as a problem and a
     * fall is not painted as a win: the colour stays neutral and only the arrow
     * carries direction. A previous period of zero yields no percentage at all —
     * dividing by it produced `Infinity%` — and says "new" instead.
     * @param props - `{ current, previous, t }`.
     * @returns the chip element, or null when there is nothing to compare.
     */
    function Trend(props) {
      const { current, previous, t } = props
      if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
      if (previous <= 0) {
        if (current <= 0) return null
        return jsx('span', { className: 'tkd_trend tkd_trendNew', children: t('kpi.trendNew') })
      }
      const ratio = (current - previous) / previous
      // Below half a percent the arrow would claim a movement the numbers do
      // not support; rounding to "0.0%" beside an up arrow reads as a bug.
      if (!Number.isFinite(ratio) || Math.abs(ratio) < 0.005) {
        return jsx('span', { className: 'tkd_trend tkd_trendFlat', children: t('kpi.trendFlat') })
      }
      const percent = Math.abs(ratio * 100).toFixed(ratio >= 1 ? 0 : 1)
      return jsx('span', {
        className: ratio > 0 ? TREND_CLASS.up : TREND_CLASS.down,
        children: `${percent}%`,
      })
    }

    /**
     * The period before the one on screen, for the comparison chips.
     *
     * Only the calendar series can answer this: it carries every recorded day
     * whatever the range is, so "the seven days before these seven" is a slice
     * of it rather than a second round trip. It is compared on total tokens,
     * which is the figure the headline card leads with.
     * @param calendar - every recorded day, from the Host.
     * @param range - one of {@link RANGES}.
     * @param meta - the payload's `meta`, for `now` and the day boundary.
     * @returns the previous period's token sum, or undefined when the range has
     *   no comparable predecessor (Today and All do not).
     */
    function previousPeriodTokens(calendar, range, meta) {
      if (range !== '7d' && range !== '30d') return undefined
      if (!Number.isFinite(meta?.now)) return undefined
      const span = range === '7d' ? 7 : 30
      const offset = Number.isFinite(meta?.utcOffsetMinutes) ? Math.trunc(meta.utcOffsetMinutes) : 0
      const today = parseDayKey(dayKeyOf(meta.now + offset * 60_000))
      if (today === undefined) return undefined
      const dayMs = 86_400_000
      // The window is [end - (span-1), end]; the one before it ends the day
      // before it starts, so the two never share a day and neither is counted
      // twice. Both are absolute day keys, so the comparison does not depend on
      // the browser's own timezone.
      const previousEnd = dayKeyOf(today.ms - span * dayMs)
      const previousStart = dayKeyOf(today.ms - (span * 2 - 1) * dayMs)
      let total = 0
      for (const row of calendar ?? []) {
        if (typeof row?.day !== 'string') continue
        if (row.day >= previousStart && row.day <= previousEnd) {
          total += Number.isFinite(row.totalTokens) ? row.totalTokens : 0
        }
      }
      return total
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
     * @param props - `{ days, meta, t }`.
     */
    function Chart(props) {
      const { days, meta, t } = props
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
      // The bar is a fraction of its slot, but capped: one day across a wide
      // pane would otherwise draw a 650px slab, and a 30-day range would draw
      // hairline-thin bars. The cap is generous enough that a single-day range
      // still reads as a bar rather than as a tick.
      const barWidth = Math.max(2, Math.min(96, slot * 0.62))
      // Bars are scaled against the rounded axis top, not the raw peak: the top
      // gridline is labelled with the axis top, so a bar drawn against the peak
      // would reach the top line while reading as a smaller number.
      const axis = axisScale(peak)
      const scaleMax = axis.max > 0 ? axis.max : peak
      // The day the Host calls today, as a day key, so the chart can mark it in
      // the column it actually belongs to rather than trusting the last column
      // (a bucketed range puts several days in one).
      const todayKey = Number.isFinite(meta?.now)
        ? dayKeyOf(meta.now + (Number.isFinite(meta?.utcOffsetMinutes) ? meta.utcOffsetMinutes : 0) * 60_000)
        : ''

      // Per-segment totals across the whole plot. The legend prints these, so a
      // reader gets the four parts of the headline total without hovering; a
      // segment that is zero everywhere is dimmed rather than removed, because
      // the four keys stay present for the aria description.
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
        // The host's current day keeps a faint wash even without a pointer: on
        // a day still in progress its bar is the shortest of the range, and
        // without the mark the last column reads as a collapse.
        const isToday = column.lastDay === todayKey
        const trackClass = active
          ? 'tkd_track tkd_trackOn'
          : isToday ? 'tkd_track tkd_trackToday' : 'tkd_track'
        tracks.push(jsx('rect', {
          className: trackClass,
          x: padLeft + slot * index,
          y: 8,
          width: slot,
          height: plotHeight,
          rx: 4,
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
        ticks.push(jsx('line', {
          className: i === 0 ? 'tkd_axis tkd_axisBase' : 'tkd_axis',
          x1: padLeft,
          x2: width - 8,
          y1: y,
          y2: y,
        }, `grid-${i}`))
        // The baseline is drawn by the axis line itself; a `0` label beside it
        // is still the scale's anchor, so it stays.
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
            children: LEGEND.map((item) => {
              const total = segmentTotals[item.key] ?? 0
              return jsxs('span', {
                className: total > 0 ? 'tkd_legendItem' : 'tkd_legendItem tkd_legendZero',
                children: [
                  jsx('span', { className: `tkd_swatch ${item.swatch}`, key: 's' }),
                  jsx('span', { className: 'tkd_legendName', key: 'n', children: t(item.label) }),
                  jsx('span', { className: 'tkd_legendVal', key: 'v', children: formatTokens(total) }),
                ],
              }, item.key)
            }),
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
     * The calendar's own summary figures.
     *
     * The grid answers "when", but a nearly empty year of squares is a poor
     * answer on its own: five busy days look like an empty page. The rail beside
     * it turns the same data into the four readings a reader actually asks for —
     * how much in total, on how many days, the busiest day, and the current
     * streak — without adding a second chart.
     *
     * Everything is derived from the supplied calendar series, so the rail can
     * never disagree with the grid it sits beside.
     * @param calendar - `{ day, totalTokens, requests }[]` from the Host.
     * @param meta - the payload's `meta`, for `now` and the day boundary.
     * @returns `{ total, recordedDays, average, busiest, streak }`.
     */
    function calendarStats(calendar, meta) {
      const rows = (calendar ?? []).filter((row) => row !== null && typeof row === 'object' && typeof row.day === 'string')
      const byDay = new Map()
      let total = 0
      let recordedDays = 0
      let busiest = null
      for (const row of rows) {
        const tokens = Number.isFinite(row.totalTokens) ? row.totalTokens : 0
        byDay.set(row.day, tokens)
        total += tokens
        if (tokens > 0) {
          recordedDays += 1
          if (busiest === null || tokens > busiest.totalTokens) busiest = { day: row.day, totalTokens: tokens }
        }
      }
      // The streak counts back from the Host's today. A day with no record yet
      // does not break it — the day is still running — so an empty today starts
      // the count at yesterday.
      let streak = 0
      if (Number.isFinite(meta?.now)) {
        const offset = Number.isFinite(meta?.utcOffsetMinutes) ? Math.trunc(meta.utcOffsetMinutes) : 0
        const today = dayKeyOf(meta.now + offset * 60_000)
        const todayMs = Date.parse(`${today}T00:00:00Z`)
        let cursor = todayMs
        if ((byDay.get(today) ?? 0) <= 0) cursor -= 86_400_000
        // Bounded by the series itself, so a ledger with one day cannot report
        // a streak longer than the history behind it.
        for (let guard = 0; guard <= byDay.size + 1; guard += 1) {
          const key = new Date(cursor).toISOString().slice(0, 10)
          if ((byDay.get(key) ?? 0) <= 0) break
          streak += 1
          cursor -= 86_400_000
        }
      }
      return {
        total,
        recordedDays,
        average: recordedDays > 0 ? Math.round(total / recordedDays) : 0,
        busiest,
        streak,
      }
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
      const stats = React.useMemo(
        () => calendarStats(calendar, meta),
        [calendar, meta?.now, meta?.utcOffsetMinutes],
      )
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
          jsx('span', {
            children: template(t('heat.days'), { count: formatInt(model.totals.recordedDays) }),
          }, 'window'),
        ],
      })

      /** One reading in the rail beside the grid. */
      const stat = (key, label, value, sub) => jsxs('div', {
        className: 'tkd_heatStat',
        children: [
          jsx('span', { className: 'tkd_heatStatLabel', children: label }),
          jsx('span', { className: 'tkd_heatStatValue', children: value }),
          sub === undefined ? null : jsx('span', { className: 'tkd_heatStatSub', children: sub }),
        ],
      }, key)

      const rail = jsxs('div', {
        className: 'tkd_heatStats',
        children: [
          stat('total', t('heat.windowTotal'), formatTokens(stats.total)),
          stat('average', t('heat.average'), formatTokens(stats.average), t('heat.averageHint')),
          stat(
            'busiest',
            t('heat.busiest'),
            stats.busiest === null ? '—' : formatTokens(stats.busiest.totalTokens),
            stats.busiest === null ? undefined : formatDayShort(stats.busiest.day),
          ),
          stat('streak', t('heat.streak'), template(t('heat.streakValue'), { count: formatInt(stats.streak) })),
        ],
      })

      return jsxs('div', {
        className: 'tkd_heatLayout',
        children: [
          jsxs('div', {
            className: 'tkd_heatMain',
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
          }),
          rail,
        ],
      })
    }

    /**
     * One generic table.
     *
     * @param props - `{ columns, rows, t }` where a column is
     *   `{ key, label, mono?, truncate?, share?, cellClass?, render? }` and a row
     *   is a plain object. `truncate` clips a long value with an ellipsis and
     *   keeps the full text in `title` — a project path is long and unbreakable,
     *   and `white-space:nowrap` on the cell turned it into a horizontal
     *   scrollbar that pushed the numeric columns out of view. `share` paints a
     *   proportional bar behind the figure, which is what turns a sorted column
     *   of totals into a ranking the eye can read without arithmetic.
     */
    function Table(props) {
      const { columns, rows, scroll } = props
      // The largest value of a share column, so each bar is scaled to the leader
      // rather than to the range total: the leader then fills its track, and the
      // rest are read against it.
      const shareMax = {}
      for (const column of columns) {
        if (column.share !== true) continue
        let max = 0
        for (const row of rows) {
          const value = Number(row[column.key])
          if (Number.isFinite(value) && value > max) max = value
        }
        shareMax[column.key] = max
      }
      return jsx('div', {
        // Only the call log is long enough to need its own scroll box. A short
        // ranking table inside a content-sized card was given a 330px box that
        // the card then clipped, so its scrollbar could never be reached.
        className: scroll === true ? 'tkd_scroll' : 'tkd_scroll tkd_noScroll',
        children: jsxs('table', {
          className: 'tkd_table',
          children: [
            jsx('thead', {
              children: jsx('tr', {
                children: columns.map((column) => jsx('th', {
                  className: column.cellClass,
                  children: column.label,
                }, column.key)),
              }),
            }),
            jsx('tbody', {
              children: rows.map((row, index) => jsx('tr', {
                children: columns.map((column) => {
                  const value = column.render ? column.render(row) : row[column.key]
                  const text = value === undefined || value === null ? '—' : value
                  if (column.share === true) {
                    const number = Number(row[column.key])
                    const max = shareMax[column.key] ?? 0
                    const percent = max > 0 && Number.isFinite(number) ? Math.max(2, (number / max) * 100) : 0
                    return jsx('td', {
                      className: column.cellClass,
                      children: jsxs('span', {
                        className: 'tkd_share',
                        children: [
                          jsx('span', { className: 'tkd_shareFill', style: { width: `${percent}%` } }),
                          jsx('span', { className: 'tkd_shareValue', children: text }),
                        ],
                      }),
                    }, column.key)
                  }
                  return jsx('td', {
                    className: [column.mono ? 'tkd_mono' : '', column.cellClass ?? ''].join(' ').trim() || undefined,
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
      const { title, note, columns, rows, empty, t } = props
      return jsxs('section', {
        className: 'tkd_card',
        children: [
          jsxs('div', {
            className: 'tkd_cardHead',
            children: [
              jsx('h2', { className: 'tkd_cardTitle', children: title }),
              note === undefined ? null : jsx('span', { className: 'tkd_cardNote', children: note }),
            ],
          }),
          rows.length === 0
            ? jsx('p', { className: 'tkd_note', children: empty })
            : jsx(Table, { columns, rows, t, scroll: props.scroll }),
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
            className: 'tkd_headMain',
            children: [
              jsx('p', { className: 'tkd_eyebrow', children: t('page.eyebrow') }),
              jsx('h1', { className: 'tkd_title', children: t('page.title') }),
              jsxs('p', {
                className: 'tkd_intro',
                children: [
                  jsx('span', { className: 'tkd_metaItem', children: t('page.subtitle') }),
                  meta?.firstDay
                    ? jsxs('span', {
                      className: 'tkd_metaItem',
                      children: [t('page.since'), '\u00a0', meta.firstDay],
                    })
                    : null,
                  meta?.updatedAt
                    ? jsxs('span', {
                      className: 'tkd_metaItem',
                      children: [t('page.updated'), '\u00a0', formatClock(meta.updatedAt)],
                    })
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

      /**
       * One full-panel state: an icon, a title and a line of explanation.
       *
       * The previous states were a single centred sentence inside a dashed box,
       * which on a wide pane read as an unrendered region rather than as a
       * deliberate answer.
       * @param title - the heading, in the primary label tone.
       * @param text - the explanation.
       * @param detail - an optional machine detail (an error message), set in
       *   the code face so it is copyable and visibly not prose. The caption is
       *   not repeated here: the title already says the read failed.
       */
      const statePanel = (title, text, detail) => jsxs('div', {
        className: 'tkd_state',
        children: [
          jsx(primitives.IconDataOutlineRegular, { size: 22 }),
          jsx('p', { className: 'tkd_stateTitle', children: title }),
          jsx('p', { className: 'tkd_stateText', children: text }),
          detail === undefined ? null : jsx('code', { className: 'tkd_stateDetail', children: detail }),
        ],
      })

      let body
      if (snapshot.connection !== true) {
        body = statePanel(t('state.noConnectionTitle'), t('state.noConnection'))
      } else if (page.status === 'error') {
        body = statePanel(t('state.errorTitle'), t('state.error'), page.error)
      } else if (page.status === 'loading' && data === null) {
        body = statePanel(t('state.loadingTitle'), t('state.loading'))
      } else if (data === null || (data.days.length === 0 && data.recent.length === 0)) {
        body = statePanel(t('state.emptyTitle'), t('state.empty'))
      } else {
        const previous = previousPeriodTokens(data.calendar, range, meta)
        const comparison = range === '7d' || range === '30d'
        const totalValue = kpiValue(formatTokens(totals.totalTokens))
        const nonCachedValue = kpiValue(formatTokens(totals.nonCachedTokens))
        const cacheValue = kpiValue(formatTokens(totals.cacheReadTokens))
        // The share of the total that each of the four segments holds. Shown as
        // a list under the headline row, so the one figure the page is about
        // also says what it was made of, without a third chart.
        // The share of the total that each of the four segments holds, shown as
        // a stacked bar under the headline figure: the one number the page is
        // about also says what it was made of, without a third chart.
        const composition = LEGEND.map((item) => {
          const value = totals[LEGEND_FIELD[item.key]]
          const share = Number.isFinite(value) && (totals.totalTokens ?? 0) > 0 ? value / totals.totalTokens : null
          return { key: item.key, value, share }
        })
        body = jsxs('div', {
          className: 'tkd_body',
          children: [
            jsxs('div', {
              className: 'tkd_kpis',
              children: [
                jsxs('div', {
                  className: 'tkd_kpiPrimaryRow',
                  children: [
                    jsxs('div', {
                      className: 'tkd_kpi tkd_kpiHero',
                      children: [
                        jsxs('div', {
                          className: 'tkd_kpiTop',
                          children: [
                            jsx('span', { className: 'tkd_kpiLabel', children: t('kpi.total') }),
                            comparison
                              ? jsx(Trend, { current: totals.totalTokens, previous, t })
                              : null,
                          ],
                        }),
                        jsxs('span', {
                          className: 'tkd_kpiValue',
                          children: [
                            totalValue.value,
                            totalValue.unit === undefined
                              ? null
                              : jsx('span', { className: 'tkd_unit', children: totalValue.unit }),
                          ],
                        }),
                        jsx('span', { className: 'tkd_kpiSub', children: formatInt(totals.totalTokens) }),
                        jsxs('div', {
                          className: 'tkd_comp',
                          role: 'img',
                          'aria-label': t('kpi.composition'),
                          children: composition.map((item) => jsxs('span', {
                            className: `${COMPOSE_SEG} ${COMPOSE_FILL[item.key]}`,
                            style: { flexGrow: item.value > 0 ? item.value : 0 },
                          }, item.key)),
                        }),
                        jsxs('div', {
                          className: 'tkd_compLegend',
                          children: composition.map((item) => jsxs('span', {
                            className: 'tkd_compItem',
                            children: [
                              jsx('span', { className: `tkd_swatch ${LEGEND_SWATCH[item.key]}`, children: null }),
                              jsx('span', { className: 'tkd_compName', children: t(LEGEND_LABEL[item.key]) }),
                              jsx('span', {
                                className: 'tkd_compVal',
                                children: item.share === null ? '—' : formatRate(item.share),
                              }),
                            ],
                          }, item.key)),
                        }),
                      ],
                    }, 'total'),
                    jsx(Kpi, {
                      tier: 'primary',
                      label: t('kpi.nonCached'),
                      value: nonCachedValue.value,
                      unit: nonCachedValue.unit,
                      sub: t('kpi.nonCachedHint'),
                    }, 'nonCached'),
                    jsx(Kpi, {
                      tier: 'primary',
                      label: t('kpi.cacheRead'),
                      value: cacheValue.value,
                      unit: cacheValue.unit,
                      sub: t('kpi.cacheHitRate'),
                      trend: jsx('span', {
                        className: 'tkd_trend',
                        children: formatRate(totals.cacheHitRate),
                      }),
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
                jsxs('div', {
                  className: 'tkd_cardHead',
                  children: [
                    jsx('h2', { className: 'tkd_cardTitle', children: t('chart.title') }),
                    jsx('span', { className: 'tkd_cardNote', children: t('chart.subtitle') }),
                  ],
                }),
                jsx(Chart, { days: data.days, meta, t }),
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
              note: template(t('table.shareNote'), { count: formatInt(data.models.length) }),
              t,
              empty: t('table.empty'),
              rows: data.models,
              columns: [
                {
                  key: 'model',
                  label: t('col.model'),
                  render: (row) => jsxs('span', {
                    className: 'tkd_cellStack',
                    children: [
                      jsx('span', { className: 'tkd_cellMain tkd_mono', children: row.model || row.provider }),
                      row.model === '' || row.model === undefined
                        ? null
                        : jsx('span', { className: 'tkd_cellSub', children: row.provider }),
                    ],
                  }),
                },
                { key: 'totalTokens', label: t('col.total'), share: true, render: (row) => formatTokens(row.totalTokens) },
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
                    {
                      key: 'cwd',
                      label: t('col.project'),
                      // The folder name leads and the directory above it sits
                      // underneath: every path in this column shares its first
                      // thirty characters, and a single clipped line of those
                      // told the reader nothing. The whole path stays in `title`.
                      render: (row) => {
                        const full = String(row.cwd ?? '')
                        const { name, parent } = splitProject(full)
                        return jsxs('span', {
                          className: 'tkd_cellStack',
                          title: full,
                          children: [
                            jsx('span', { className: 'tkd_cellMain', children: name === '' ? '—' : name }),
                            parent === ''
                              ? null
                              : jsx('span', { className: 'tkd_cellSub', children: parent }),
                          ],
                        })
                      },
                    },
                    { key: 'totalTokens', label: t('col.total'), share: true, render: (row) => formatTokens(row.totalTokens) },
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
                    {
                      key: 'key',
                      label: t('col.purpose'),
                      render: (row) => jsx('span', {
                        className: 'tkd_cellMain',
                        children: t(`purpose.${row.key}`) === `purpose.${row.key}` ? row.key : t(`purpose.${row.key}`),
                      }),
                    },
                    { key: 'totalTokens', label: t('col.total'), share: true, render: (row) => formatTokens(row.totalTokens) },
                    { key: 'requests', label: t('col.requests'), render: (row) => formatInt(row.requests) },
                    { key: 'avgDurationMs', label: t('col.duration'), render: (row) => formatMs(row.avgDurationMs) },
                  ],
                }),
              ],
            }),
            jsxs('section', {
              className: 'tkd_card',
              children: [
                jsxs('div', {
                  className: 'tkd_cardHead',
                  children: [
                    jsx('h2', { className: 'tkd_cardTitle', children: t('table.recent') }),
                    jsx('span', {
                      className: 'tkd_cardNote',
                      children: template(t('table.recentNote'), { count: formatInt(data.recent.length) }),
                    }),
                  ],
                }),
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
                              jsxs('td', {
                                children: [
                                  jsx('span', { className: 'tkd_cellMain tkd_mono', children: record.model || record.provider }),
                                ],
                              }),
                              jsx('td', {
                                children: t(`purpose.${record.purpose}`) === `purpose.${record.purpose}`
                                  ? record.purpose
                                  : t(`purpose.${record.purpose}`),
                              }),
                              // The same cache-inclusive total the cards and the chart
                              // report. Summing only input + output here would have
                              // printed a number two orders of magnitude below the
                              // day it belongs to, in a column labelled "total".
                              jsx('td', {
                                children: formatTokens(
                                  (record.inputTokens ?? 0) + (record.outputTokens ?? 0)
                                  + (record.cacheReadTokens ?? 0) + (record.cacheWriteTokens ?? 0),
                                ),
                              }),
                              jsx('td', { children: formatTokens(record.cacheReadTokens ?? 0) }),
                              jsx('td', { children: formatMs(record.durationMs) }),
                              jsx('td', {
                                children: jsx('span', {
                                  className: [
                                    'tkd_pill',
                                    record.ok ? 'tkd_pillOk tkd_ok' : 'tkd_pillErr tkd_err',
                                  ].join(' '),
                                  title: record.error ?? '',
                                  children: record.ok ? t('status.ok') : t('status.error'),
                                }),
                              }),
                            ],
                          }, `${record.ts}-${index}`)),
                        }),
                      ],
                    }),
                  }),
              ],
            }),
          ],
        })
      }

      return jsxs('div', {
        className: 'tkd_page',
        children: [
          head,
          body,
          jsx('footer', {
            className: 'tkd_colophon',
            children: jsx('p', {
              className: 'tkd_note',
              children: template(t('page.footnote'), { zone: formatUtcOffset(meta?.utcOffsetMinutes) }),
            }),
          }),
        ],
      })
    }

    // ── copy ─────────────────────────────────────────────────────────────────

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'foot.trigger': 'Token 用量',
      'foot.today': '今日',
      'page.eyebrow': '用量概览',
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
      'chart.subtitle': '按天堆叠，自下而上：缓存读取、缓存写入、输入、输出',
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
      'heat.windowTotal': '近一年合计',
      'heat.average': '有记录日均',
      'heat.averageHint': '只算有记录的天',
      'heat.busiest': '最高单日',
      'heat.streak': '连续记录',
      'heat.streakValue': '{count} 天',
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
      'kpi.cacheRead': '缓存读取',
      'kpi.cacheHitRate': '命中率',
      'kpi.input': '输入',
      'kpi.output': '输出',
      'kpi.reasoning': '推理',
      'kpi.requests': '请求数',
      'kpi.errors': '次失败',
      'kpi.ttft': '平均首字',
      'kpi.avgDuration': '平均耗时',
      'kpi.trendNew': '新增',
      'kpi.trendFlat': '持平',
      'table.models': '按模型',
      'table.projects': '按项目',
      'table.purposes': '按用途',
      'table.recent': '最近调用',
      'table.shareNote': '{count} 个模型，条长表示相对占比',
      'table.recentNote': '本区间最近 {count} 次',
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
      'purpose.chat': '对话',
      'purpose.compaction': '上下文压缩',
      'purpose.session-title': '会话标题',
      'status.ok': '成功',
      'status.error': '失败',
      'state.loadingTitle': '正在读取用量',
      'state.loading': '正在读取…',
      'state.errorTitle': '读取失败',
      'state.error': '无法从 Host 读取用量数据，稍后会自动重试，也可以点右上角刷新。',
      'state.emptyTitle': '还没有记录',
      'state.empty': '还没有记录到用量——本插件从安装之后开始记录，先发起一次对话即可看到数据。',
      'state.noConnectionTitle': '未连接到 Host',
      'state.noConnection': '当前页面没有连接到 Host，无法读取用量数据。',
    }

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      'foot.trigger': 'Token usage',
      'foot.today': 'today',
      'page.eyebrow': 'Usage overview',
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
      'chart.subtitle': 'stacked by day, bottom to top: cache read, cache write, input, output',
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
      'heat.windowTotal': '12-month total',
      'heat.average': 'Per active day',
      'heat.averageHint': 'recorded days only',
      'heat.busiest': 'Busiest day',
      'heat.streak': 'Streak',
      'heat.streakValue': '{count} days',
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
      'kpi.cacheHitRate': 'hit rate',
      'kpi.reasoning': 'Reasoning',
      'kpi.requests': 'Requests',
      'kpi.errors': 'failed',
      'kpi.ttft': 'Avg first token',
      'kpi.avgDuration': 'Avg duration',
      'kpi.trendNew': 'new',
      'kpi.trendFlat': 'flat',
      'table.models': 'By model',
      'table.projects': 'By project',
      'table.purposes': 'By purpose',
      'table.recent': 'Recent calls',
      'table.shareNote': '{count} models, bar length is relative share',
      'table.recentNote': 'the last {count} in this range',
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
      'purpose.chat': 'chat',
      'purpose.compaction': 'compaction',
      'purpose.session-title': 'session title',
      'status.ok': 'ok',
      'status.error': 'failed',
      'state.loadingTitle': 'Reading usage',
      'state.loading': 'Loading…',
      'state.errorTitle': 'Read failed',
      'state.error': 'The usage data could not be read from the Host. It retries on its own; the refresh button forces it.',
      'state.emptyTitle': 'Nothing recorded yet',
      'state.empty': 'Nothing recorded yet — this plugin records from the moment it was installed. Send one message and the numbers appear.',
      'state.noConnectionTitle': 'No Host connection',
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
