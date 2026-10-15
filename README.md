# dsh-token-dashboard

English | [中文](README.zh.md)

Know where your tokens actually go. This plugin records **every model call** in
DeepSeek Harness from the moment it mounts, aggregates the usage by day, model,
purpose and project, and puts a dashboard one click away — in the sidebar foot,
directly above your account row.

```
sidebar foot                    dashboard panel
┌──────────────────────┐        ┌──────────────────────────────────────┐
│  📊 Token usage 12.3K │  ───▶  │  8 KPI cards                          │
├──────────────────────┤        │  daily stacked bar chart              │
│  G  Greye            │        │  by model / project / purpose tables  │
└──────────────────────┘        │  recent calls                         │
                                └──────────────────────────────────────┘
```

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
- **Every field is recorded exactly as the provider reported it.** Cache hits stay
  in their own counter rather than being folded into `inputTokens`, and nothing is
  normalized or guessed — the two totals the dashboard shows are arithmetic on the
  reported numbers, not an interpretation of them.
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
stacks three segments — cache reads (bottom), input, then output — so the bar's
height is the same total the card reports. Cache is drawn lowest deliberately: at
99% of the bar it would otherwise push input and output off the top of the plot.

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
- The chart buckets by week once a range is long enough that one bar per day
  would be a hairline. The bucket's label is its first day.

## Data file

```
<dsh-home>/token-dashboard/ledger.json
```

`<dsh-home>` is normally `~/.dsh`. Override the directory with the
`DSH_TOKEN_DASHBOARD_STATE_DIR` environment variable.

- **Atomic writes** (`ledger.json.tmp` → `rename`), debounced by 2 seconds, with
  a synchronous flush when the plugin unloads — so the last calls before a quit
  are not lost to the debounce window.
- **Safe across processes.** Every flush re-reads the current file and folds in
  only the delta since this process last wrote. Two profiles (say `desktop` and
  `headless`) writing the same ledger therefore add to each other's counts
  instead of overwriting them.
- **Corruption is survivable.** A truncated, malformed, mis-schema'd or
  wrong-shaped file is treated as an empty ledger with one warning logged. The
  plugin keeps working and the dashboard shows its empty state.
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

188 assertions across seven files:

| File | Covers |
|---|---|
| `ledger-check.cjs` | UTC+8 day boundary (one millisecond either side of midnight), bucket accumulation and clamping, derived figures, delta merging, retention, defensive parsing, payload assembly |
| `store-check.cjs` | Debounced flush, atomic write, **reading the whole day back after a restart**, repeated reads not accumulating, **interleaved flushes from two stores losing no counts**, retention trimming, detail dedup and cap, write-failure and throwing-logger containment |
| `recorder-check.cjs` | Chunks pass through unchanged (same object identity), laziness, exactly one record per call, errors rethrown unchanged, consumer abandonment, a throwing sink never reaching the model lane |
| `route-check.cjs` | 405 / 415 / 400, envelope validation, rpcId echo, unknown method, a throwing store not escaping, all four ranges, the empty ledger |
| `client-check.cjs` | Bundle load under a stub facade, slot registration and ordering, no-connection degradation, the source state machine, formatting, chart bucketing, matching zh/en key sets |
| `integration-check.cjs` | The real `apply()` end to end: one model call → ledger → read back through the route; cwd and purpose dimensions; a failed call counted as an error; flush on unload and continued counts on a second mount |
| `render-check.cjs` | Every branch of both components rendered: wide and rail states, loading/error/no-connection/empty states, chart geometry and zero-height bars, missing `meta`/`totals` not crashing |

Every test seam is exported from the Host half as `__internal` and exercised
directly.

## License

MIT
