# dsh-token-dashboard

English | [中文](README.zh.md)

Know where your tokens actually go. This plugin records **every model call** in
DeepSeek Harness from the moment it mounts, aggregates the usage by day, model,
purpose and project, and puts a dashboard one click away — in the sidebar foot,
directly above your account row.

```
sidebar foot                    dashboard panel
┌──────────────────────┐        ┌──────────────────────────────────────┐
│  📊 Token usage 12.3K │  ───▶  │  3 headline + 6 compact KPI cards     │
├──────────────────────┤        │  daily stacked bar chart              │
│  G  Greye            │        │  usage calendar (a year of days)      │
└──────────────────────┘        │  by model, then project | purpose     │
                                │  recent calls                         │
                                └──────────────────────────────────────┘
```

The layout is built for the pane it is given rather than for the window: the
KPI rows, the two-column table row and the truncation of long project paths all
key off the **panel** width (a container query), so a narrow main pane reflows
even when the window is wide. The chart measures its own width and draws its
viewBox to match, so its labels are never scaled by whatever the panel happened
to be.

> **Third-party, non-invasive plugin.** It mounts from your DSH profile, never
> touches `app.asar`, and leaves every shipped component exactly as it is.

- [Install](#install) — one command, or the Plugins page
- [What it records](#what-it-records) — and the accounting choices behind it
- [Reading the numbers](#reading-the-numbers) — what each figure means
- [Data file](#data-file) — where it lives, how it is written
- [Configuration](#configuration)
- [Known limitations](#known-limitations) — read before filing an issue
- [Development](#development)

## Install

The plugin is a third-party **bundle**: it loads from your DSH profile, not from
`app.asar`. Nothing in the installed application is modified, so uninstalling is
exact and an app update cannot clobber it.

### Option A — one command (CLI)

```bash
dsh plugin --profile desktop add github:guanhaisen/dsh-token-dashboard
```

**Fully quit DeepSeek Harness first.** The CLI refuses to touch a profile the
running application owns; options B and C work while it runs.

### Option B — the Plugins page (no terminal)

1. Open the sidebar's **Plugins** entry.
2. Choose install, and paste the same spec:
   `github:guanhaisen/dsh-token-dashboard`.
3. Watch pnpm's output, then confirm.

### Option C — ask the agent

Tell the model to install `github:guanhaisen/dsh-token-dashboard` in the
`desktop` profile; it uses the `plugin_manager` tool. Every tool action needs
`danger-full-access` or an approval.

### Pin a version (recommended once tagged)

The specs above track the default branch. To stay on a release:

```bash
dsh plugin --profile desktop add 'github:guanhaisen/dsh-token-dashboard#v0.1.0'
```

### What the installer does for you

You do not have to write any of this by hand:

- adds the dependency to `<dsh-home>/profiles/desktop/package.json`,
- **appends the bundle to `dsh.profile.bundles` automatically** — a freshly
  installed package that declares `dsh.bundle` is reconciled into that list,
  which is what actually mounts it,
- runs the bundled pnpm (no separate install step),
- and, because the Desktop composition includes HMR, **applies the change
  live** — no restart.

Reload the page afterwards. The client bundle's revision is derived from
`client.js`'s mtime and size, so a fresh revision is served on reload.

If the entry does not appear, the bundle was not selected: add
`"dsh-token-dashboard"` to `dsh.profile.bundles` in
`<dsh-home>/profiles/desktop/package.json` and restart.

### Confirm it is running

Ask the agent for `plugin_manager { action: "list_plugins" }`. You should see a
`dsh-token-dashboard` entry with `enabled: true` and `fiberPhase: "active"`.

## What it records

Usage comes from `llm/stream` — the one waterfall every provider call passes
through (`LlmRuntime.streamWithRegistration`). Main turns, subagents,
compaction and session-title generation all cross it, so the totals are
complete rather than a sample of them.

Each call contributes:

| Field | Meaning |
|---|---|
| `inputTokens` / `outputTokens` | as reported by the provider |
| `cacheReadTokens` / `cacheWriteTokens` | prompt-cache hits and writes, listed separately |
| `reasoningTokens` | reasoning tokens, when the provider reports them |
| `provider` / `model` | the exact route that served the call |
| `purpose` | `chat`, `compaction` or `session-title` |
| `sessionId` / `cwd` | the session and project directory |
| `durationMs` / `ttftMs` | total latency and time to first token |
| `ok` / `error` | whether the call succeeded |

Aggregated by **day** (boundary at UTC+8 by default), **model**, **purpose** and
**project**, plus a newest-first list of recent calls.

### The accounting choices, stated plainly

- **Forward-only. Nothing is backfilled.** Calls made before the plugin mounted
  are not imported. The dashboard says "since install" and means it. If you want
  history, that is a separate one-shot importer, not this.
- **It does not read `~/.dsh/channel-pack/token-ledger.json`.** That file belongs
  to `dsh-our-free-model`: it covers only the adapters that plugin wraps, and it
  is pruned on a 90-day window. The two ledgers are independent, and neither
  affects the other.
- **Every field is recorded exactly as the provider reported it.** Cache reads and
  cache writes stay in their own counters rather than being folded into
  `inputTokens`, and nothing is normalized or guessed — the two totals the
  dashboard shows are arithmetic on the reported numbers, not an interpretation
  of them. The chart's stack uses those same four counters, so a bar and the card
  above it can never disagree.
- **No price conversion.** There is no reliable per-route price source available
  to the plugin, so the dashboard reports tokens, not money. A cost figure built
  on a guessed rate would be worse than no figure.

## Reading the numbers

Two totals are shown, because one number cannot answer both questions:

- **Total tokens** = `inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens`.
  Every token the provider actually processed. Cache reads belong here: they are
  real tokens that occupied the context window and were billed, merely at a lower
  rate. On a warm workload they dominate — a measured session was 99.6% cache
  reads, so leaving them out would have understated the day by **257×**.
- **Non-cached tokens** = `inputTokens + outputTokens`. The part of the work that
  missed the prompt cache: uncached input plus output.

> **This is not a billing figure, and it is deliberately not labelled as one.**
> Cache reads are billed too — usually at roughly a tenth of the uncached input
> rate, but billed. Calling `input + output` the "billable" total (an earlier
> version of this plugin did) tells the reader that cached tokens were free,
> which is false. The plugin does no price conversion, so it reports composition,
> never cost.

Note that the provider's `inputTokens` means *uncached* input: DSH names the same
quantity `uncachedInputTokens` internally. That is why `inputTokens` alone is much
smaller than the cache figure on a warm session.

Both totals are always on screen, so neither has to be inferred. The daily chart
stacks four segments — cache reads (bottom), cache writes, input, then output —
so the bar's height is the same total the card reports. Cache is drawn lowest
deliberately: at 99% of the bar it would otherwise push input and output off the
top of the plot.

The chart's vertical axis is scaled to round numbers rather than to the raw peak:
the step is rounded up to a `1 / 2 / 2.5 / 5 / 10` value, so a 143M peak draws
gridlines at `0 / 50M / 100M / 150M / 200M` instead of
`35.8M / 71.6M / 107.5M / 143.3M`. The tallest bar therefore stops just below the
top gridline, and the gridline it stops under is the number it is drawn against —
the bars are scaled to the rounded axis top, not to the peak, so the bar and the
label can never disagree.

**Hovering a bar shows that day's breakdown.** The tooltip lists all four
segments at their exact values (not the compact `K`/`M` form the cards use) plus
the column total, so a figure can be read off the chart without switching to the
tables. The whole column is the hover target rather than the bar itself — on a
cache-heavy day a barely-used day is a hairline — and the hovered column is
tinted so a zero-height day is still visibly selected. A column that buckets
several days says so (`· 7 day bucket`) instead of passing a week's figure off as
one day's. The tooltip is drawn from the same declaration as the legend, so a row
and its swatch cannot disagree about a segment's colour.

### The usage calendar

Below the bar chart is a **calendar heatmap**: one square per day, one column per
week, Monday to Sunday, shaded by that day's total. It answers a different
question from the chart above it — *when* was I busy, rather than *how much* in
the range I picked — so **it deliberately ignores the range control** and always
shows the trailing year ending today. The card says so in its own sub-line, and
the number of days that actually have records is printed beside the legend. A
range-driven calendar would be a single square under "Today" and a year under
"All", which is why it is pinned.

- **Shades are the window's own quartiles**, not fixed token rates. A fixed scale
  would paint every day of a light user at the palest shade and every day of a
  heavy one at the darkest, which says nothing about which days differed. Days
  with zero tokens are excluded from the quartiles and keep their own level
  (the empty cell), so an idle day cannot drag the low boundary to zero and
  flatten every real day into the darkest shade.
- **A flat week reads as typical, not as maximal.** When every recorded day in
  the window has the same total, the quartiles collapse; rather than painting all
  of them at level 4, they land on the middle shade.
- **The square is the same total the bar chart draws** — cache reads included —
  so the two charts cannot disagree about what a day cost in tokens.
- **Every day in the window is drawn, recorded or not.** Gaps are information;
  skipping absent days would compress the year and misstate them.
- **Hovering a square** shows the full date, its weekday, the exact total and the
  request count. The hovered square keeps its own shade and gains an outline,
  so the shade being explained is never hidden by the highlight.
- The window ends on the day the Host calls today, cut at the same configurable
  offset as the rest of the ledger — not at UTC, which would drop today's records
  for the first eight hours of a UTC+8 day.

The grid is sized by the pane, not by the window: the cell stays 11–13px while
there is room and the gap shrinks first, so a narrow main pane still shows a year
of squares rather than dissolving into hairlines.

Other figures:

- **Cache hit rate** = `cacheReadTokens / (inputTokens + cacheReadTokens)`. When
  the denominator is 0 the dashboard shows `—`, not `0%`: "nothing was sent" and
  "nothing was cached" are different facts.
- **Average first token** is the mean over calls that actually produced a first
  token. A call that failed before emitting anything contributes no sample
  rather than a 0 ms one.
- **A call that reported no usage** is still counted as a request (and as an
  error if it failed), but contributes no tokens — so a failing route cannot
  quietly dilute your averages toward zero.
- **The recent-calls table lists exactly the day range you selected.** Nothing
  outside the range is shown, so the table can never disagree with the cards and
  the chart above it — including when the range is empty, which shows an empty
  table rather than the last thing that happened to be recorded.
- The chart buckets by week once a range is long enough that one bar per day
  would be a hairline. The bucket's label is its first day. Only days that have
  records are drawn, so the axis is a sequence of recorded days rather than a
  strictly linear calendar.

## Data file

```
<dsh-home>/token-dashboard/ledger.json
```

`<dsh-home>` is normally `~/.dsh`. Override the directory with the
`DSH_TOKEN_DASHBOARD_STATE_DIR` environment variable.

- **Atomic writes** (`ledger.json.tmp` → `rename`), debounced by 2 seconds, with
  a synchronous flush when the plugin unloads — so the last calls before a quit
  are not lost to the debounce window.
- **A failed write is retried, not forgotten.** If the write throws (a read-only
  disk, a full volume), the pending delta stays marked dirty and the unload flush
  attempts it again; the records are kept in memory rather than dropped on the
  floor.
- **Safe across processes.** Every flush re-reads the current file and folds in
  only the delta since this process last wrote. Two profiles (say `desktop` and
  `headless`) writing the same ledger therefore add to each other's counts
  instead of overwriting them.
- **Corruption is survivable.** A truncated, malformed, mis-schema'd or
  wrong-shaped file is treated as an empty ledger with one warning logged. The
  plugin keeps working and the dashboard shows its empty state.
- **The calendar costs two fields per day on the wire.** It is built on the Host
  from the whole ledger, not from the selected range, so the response carries a
  `calendar` series of `{ day, totalTokens, requests }` — about 60 bytes a day,
  roughly 45 KB across a full 730-day retention window. The card reads only those
  two figures, so sending the full derived breakdown for a year would have been
  ~20× larger for data nothing draws.
- **To reset the data, delete the file.** There is no clear-data button by design.

## Configuration

Edit the row in `cordis.patch.yml` (or override it from your profile's
`cordis.patch.yml`):

| Field | Default | Meaning |
|---|---|---|
| `retentionDays` | `730` | Days of daily aggregation kept; older days are dropped whole |
| `recentLimit` | `300` | Detail records kept, newest first |
| `utcOffsetMinutes` | `480` | Fixed day-boundary offset; `480` = UTC+8 |
| `trackProjects` | `true` | Record the `cwd` dimension |
| `flushDebounceMs` | `2000` | Debounce before a dirty ledger reaches disk |

**A value that cannot be used is rejected, not clamped.** Each numeric field must
be a finite number in a sane range (`retentionDays` 1–36500, `recentLimit`
0–10000, `utcOffsetMinutes` ±720/840, `flushDebounceMs` 0–60000) and
`trackProjects` must be a real boolean; anything else falls back to the default
and logs one warning naming the key. This matters more than it sounds: a
`retentionDays` of `null` or a typo like `"730"` used to be coerced to `0`, which
made the retention cutoff *tomorrow* and deleted every recorded day on the next
flush. A configuration typo must not be able to destroy your history, so an
unusable value is ignored rather than reinterpreted.

The day boundary also drives what the page says: the dashboard's footnote names
the offset actually in use (`UTC+8`, `UTC±0`, `UTC+5:30`, …) rather than assuming
the default.

## Known limitations

- **Records forward only.** See the accounting choices above.
- **The day boundary is a fixed offset, not your system timezone.** It defaults
  to UTC+8 and is configurable, but it will not follow a laptop across time
  zones. This is deliberate: a moving boundary would silently split or merge
  already-recorded days.
- **No cost, budget or alerting.** Tokens only.
- **Usage is whatever the provider reported.** Providers that do not report
  usage produce requests with zero tokens; the dashboard shows them as requests
  and does not invent numbers.
- **A superseded attempt counts as its own request, and is not counted as an
  error.** `llm/stream` is entered once per provider attempt, and DSH retries a
  failed attempt as a fresh attempt inside the same step. An attempt that ends
  without reporting usage therefore contributes one `requests` and no tokens, and
  lands in the recent-calls table as a zero-token row marked `ok`. Measured
  against the session logs, its fingerprint is unmistakable: `ttftMs ===
  durationMs` (the only chunk arrives as the stream ends, so the first-token
  sample equals the total duration), `usageReported: false`, a `llm/retry` event
  inside its span on the same session, and a transport failure. The consequence
  is that `requests` counts *attempts*, tracking but slightly exceeding the
  number of billed calls, and that `errors` does not reflect retries. Token
  totals are unaffected: a superseded attempt reports no usage, so it adds none.
  In a measured day the plugin's token total reconciled with the logs to within
  0.06%, and 294 of 295 calls matched field for field.
- **Desktop profile is what this was developed and tested against.** It should
  work in any profile whose composition provides `llm` and a `connection`
  carrier, but only the Desktop composition has been exercised.

## Development

Zero dependencies, zero build step — `index.js` and `client.js` are shipped as
authored. That is a deliberate constraint: a plugin that needs a toolchain is a
plugin most users cannot audit.

```
index.js           Host half: the llm/stream recorder, the ledger store, the RPC route
client.js          Browser half: the sidebar-foot entry and the dashboard panel
cordis.patch.yml   Mounts the Host half into the Loader tree
test/              Zero-dependency test suite
```

```bash
npm test          # or: node test/run-all.cjs
```

316 assertions across seven files:

| File | Covers |
|---|---|
| `ledger-check.cjs` | UTC+8 day boundary (one millisecond either side of midnight), bucket accumulation and clamping, derived figures, delta merging, retention, defensive parsing, payload assembly, **the recent table agreeing with the selected range**, **the calendar series carrying every recorded day whatever the range and the same total the KPI card reports**, **configuration values that cannot be used** |
| `store-check.cjs` | Debounced flush, atomic write, **reading the whole day back after a restart**, repeated reads not accumulating, **interleaved flushes from two stores losing no counts**, retention trimming, detail dedup and cap, write-failure and throwing-logger containment, **a failed write being retried on unload instead of dropping its delta** |
| `recorder-check.cjs` | Chunks pass through unchanged (same object identity), laziness, exactly one record per call, errors rethrown unchanged, consumer abandonment, a throwing sink never reaching the model lane |
| `route-check.cjs` | 405 / 415 / 400, envelope validation, rpcId echo, unknown method, a throwing store not escaping, all four ranges, the empty ledger |
| `client-check.cjs` | Bundle load under a stub facade, slot registration and ordering, no-connection degradation, the source state machine, **a range switch superseding an in-flight read and aborting without an error state**, formatting, **the axis step rounding to a nice number and every tick printing at one precision**, chart bucketing, **cache-write parity between bar and card**, **the panel-width container queries and the absence of a viewport breakpoint**, **the tooltip's half-width being a real bound on the tooltip and the gridlines not swallowing the pointer**, **the calendar window being a year to the day, ending on the Host's day rather than UTC's, padded to whole weeks, with quartile shades that ignore empty days and a flat window landing mid-scale**, **the five heat shades being one ladder shared by the grid and its legend**, **no dead stylesheet rule**, payload normalization, matching zh/en key sets and every month/weekday label the calendar indexes |
| `integration-check.cjs` | The real `apply()` end to end: one model call → ledger → read back through the route; cwd and purpose dimensions; a failed call counted as an error; flush on unload and continued counts on a second mount; **a recorded call reaching the calendar series under all four ranges**; **an existing ledger surviving a bad retention setting**; an aborted request |
| `render-check.cjs` | Every branch of both components rendered: wide and rail states, loading/error/no-connection/empty states, **the KPI split into a 3-card headline row and a 6-card compact row with a sub-line on every card**, **a chart whose viewBox matches its rendered width and no `preserveAspectRatio` stretch**, **round axis ticks**, chart geometry and zero-height bars, **a bar scaled to the rounded axis top**, **a bar reaching the card's total with cache writes present**, **the calendar card sitting between the chart and the tables, drawing one cell per day rather than per recorded day, starting on Monday with all seven weekday rows, keeping its window note, and staying a year wide under a one-day range**, **calendar hover through real component state: no tooltip until a hover, the date, weekday, exact total and request count of the hovered day, one outline that moves rather than accumulates and rides on top of the cell's shade, the tooltip inside the positioned box, and a payload with no `calendar` series still rendering**, **the project and purpose cards sharing a row**, **a long project path clipped with its full text kept in `title`**, **an unused segment dimmed in the legend but not dropped**, **chart hover driven through real component state**, **a payload with no `totals` at all**, missing `meta`/`totals` not crashing, accessible names, the footnote's zone |

Every test seam is exported from the Host half as `__internal` and exercised
directly.

The harness itself awaits every test: an async body's promise is tracked and
`report` waits for it before exiting. That is load-bearing — an earlier version
recorded "ok" the instant an async test's promise was created, so the assertions
after the first `await` were still queued when `process.exit` fired and never
ran. The async half of the suite was passing vacuously.

## License

MIT
