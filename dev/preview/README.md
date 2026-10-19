# Local preview

Renders the real `client.js` — not a mock, not a screenshot of a mock — against
the real React, the shell's real design tokens, and a payload built from the
live ledger. It exists because a page that only looks right in a component test
can still be wrong on screen: the KPI cards were once the right *shape* while
their figures sat on four different baselines.

The plugin itself still ships with no build step. Nothing here is packaged:
`dev/` is outside the `files` list in `package.json`.

## Run it

```bash
node dev/preview/build-data.cjs     # ledger -> dev/preview/data.json
node dev/preview/build.cjs          # data + tokens + client.js -> dev/preview/app.js
node dev/serve.cjs 8137             # no-store server, http://127.0.0.1:8137/
```

`build.cjs` needs two things this checkout does not vendor:

- **esbuild + React**, from any local `node_modules`. Set `PREVIEW_MODULES` to
  a directory that has both; the default points at the author's machine.
- **the shell's design tokens**, extracted from the installed app's theme
  bundle. Set `PREVIEW_ASAR` to `resources/app.asar`; `dev/lib/asar.cjs` reads
  it without Electron.

The server sends `cache-control: no-store`. That is deliberate: a heuristic
cache once served a stale bundle and every visual judgement in that round was
made on the previous page.

## Query parameters

Every state is a URL, so one build covers all of them:

| Parameter | Meaning |
|---|---|
| `w` | pane width in CSS px — the layout is a container query, not a viewport one |
| `h` | pane height in CSS px |
| `scroll` | scroll this many px after mount |
| `theme=dark` | set the shell's dark-theme attribute |
| `locale=en` | English copy |
| `range=today\|7d\|30d\|all` | which captured payload to show |
| `foot` / `footw` | render the sidebar foot rail (`foot=rail`) at a given width |

Examples:

```
/?w=1120&h=1200                 a wide pane
/?w=620&h=1900                  a narrow one: the container query reflows it
/?w=1120&theme=dark&locale=en   dark mode, English
/?w=1120&h=4300&scroll=99999    the page foot, with the sidebar entry under it
```

## What it found that the tests could not

- The cache card's hit-rate chip was rendered into the sub-line, which put it
  below a hint that already described the figure — moved onto the label line.
- The composition legend wrapped 3 + 1 in English and 4 + 0 in Chinese, so the
  same card had two different shapes; it is a two-column grid now.
- The ranking tables sat in a 330px scroll box inside cards only ~220px tall:
  the scrollbar existed and could never be reached.
- Two cards in the project/purpose row ended at different heights unless the
  row stretched them, and stretching left a hole under the short one. They are
  content-sized, and the pair is read as two cards rather than one region.
