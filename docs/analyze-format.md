# `next analyze` output format (study notes)

Captured from `fixtures/basic` with **Next.js 16.4.6** (Turbopack), Node 22.17, Windows.
Raw data: `fixtures/basic/__snapshots__/analyze/base/` (regenerate with
`node scripts/snapshot-fixture.mjs basic base`).

The analyzer is **experimental**. Everything below is observed behaviour, not a documented
contract. All parsing must live in one adapter module so a format change touches one file.

## Commands (verified with `--help` on 16.4.6)

| Command | What it does |
|---|---|
| `next analyze --output [--snapshot <name>]` | Builds the module graph (no app build) and writes files to `.next/diagnostics/analyze/`. `--snapshot` saves a named copy under `history/snapshot-<name>/`, replacing an older one with the same name. Took ~4 s on this fixture. |
| `next analyze export [--snapshot <name>] [--route <route>] [--dist-dir <dir>]` | Streams a saved snapshot as JSON Lines to stdout. No rebuild. Defaults to the latest snapshot. |
| other flags | `--experimental-app-only`, `--no-mangling`, `--profile`, `--port` |

Base-vs-PR flow this enables: `--snapshot base` on the base branch, `--snapshot pr` on the PR,
then `export --snapshot base` / `export --snapshot pr` and diff.

`export` is plain JS: `next/dist/build/analyze/graph-dump.js` decodes the binary `*.data`
files and writes records with `writeSync`. Its own comment warns that a validation error
**may leave partial output**, so always check the exit code before using stdout.

## Files on disk (`.next/diagnostics/analyze/`)

- `history/history.json` lists snapshots: `name`, `createdAt`, `nextVersion`, `gitBranch`, `gitDirty`, `appDirOnly`, `noMangling`, `routeCount`.
- `history/snapshot-<name>/route-summaries.json` gives per-route totals:
  `{ route, size, compressed_size, client: { size, compressed_size } }`. The `client` numbers equal
  the sum of that route's `[client-fs]` `part` records. ⚠️ These totals **include lazily loaded
  (`next/dynamic`) chunks** and **overstate compressed size** (see below), so they are not first-load JS.
- `*.data` files are a binary/internal encoding. Don't parse them; use `export`.
- The rest (`*.html`, `_next/`) is the interactive UI.

## JSONL record types (schema_version 1)

The order is the `meta` record, then all `module` records, then for each route: `route`, its `output` records, its `part` records, its `group` records.

| type | count here | keys |
|---|---|---|
| `meta` | 1 | `schema_version`, `snapshot_name`, `module_index_hash`, `route_count`, `selected_routes` |
| `module` | 1,047 | `ident`, `path`, `dependencies: { sync[], async[], traced[] }` |
| `route` | 4 | `route`, `entries[]`, `coverage: { entries, groups }` |
| `output` | 540 | `route`, `filename`, `modules[]`, `async_loaders[]`, `coverage` |
| `part` | 2,420 | `route`, `filename`, `source_path`, `size`, `compressed_size` |
| `group` | 47 | `route`, `id`, `kind`, `trigger_module_ident`, `trigger_join`, `outputs[]` |

### `module`: the import graph

- `ident` is the unique node id: `<path> [<layer>] (<kind>)[ <suffix>]`. The same file shows up once per layer:
  - `[app-rsc]` server components (RSC)
  - `[app-ssr]` server-side render of client components
  - `[app-client]` **browser bundle** (what we measure)
  - `(client reference proxy)` marks a **`"use client"` boundary**
  - `(ecmascript, next/dynamic entry)` marks the target of a **`next/dynamic` import**
  - suffix ` <locals>` appears on barrel files (for example `ui/index.ts [app-client] (ecmascript) <locals>`)
- `dependencies.sync` / `async` contain **edges to other `ident`s**, so the full import chain is
  available. `async` holds dynamic imports (verified: `LazyClient.tsx` → async → `Heavy.tsx (… next/dynamic entry)`).
  `traced` was empty everywhere.
- ⚠️ **An edge does not mean bytes shipped.** A barrel's `<locals>` node has sync edges to every
  re-export, including ones that were tree-shaken. In `fixtures/dynamic-barrel`, an unused `Unused.tsx`
  re-export still had an edge but only contributed an **11-byte** part. Always weight chains by
  `part` sizes, never by edges alone.
- Paths are relative to **`[project]`**, the root Turbopack picked:
  - **pnpm monorepo**: the workspace root, so app files look like `[project]/fixtures/basic/app/page.tsx` and packages like
    `[project]/node_modules/.pnpm/next@16.4.6_@types+node@22._1e2e5987…/node_modules/next/...`
    (the **hash differs by machine and lockfile**)
  - **standalone npm app**: the app dir, so `[project]/app/page.tsx` and `[project]/node_modules/moment/moment.js`
  - The adapter must normalise both to `app:<relative path>` and `pkg:<name>@<version>/<subpath>`
    before diffing. It gets the version from the `.pnpm/<name>@<ver>` segment, or from the package's `package.json` for npm.
- Other prefixes seen: `[externals]/<builtin>` (Node built-ins), `.next-internal/…/actions.js`.

**Verified chain** for the intentional regression on `/dashboard`:

```
fixtures/basic/app/dashboard/page.tsx            [app-rsc] (Server Component)
→ components/DashboardClient.tsx                 [app-rsc] (client reference proxy)   ← "use client" boundary
→ components/DashboardClient.tsx                 [app-client]
→ components/DatePicker.tsx                      [app-client]
→ node_modules/moment/moment.js                  [app-client]
```

Finding the chain means a reverse BFS from the heavy `[app-client]` module to the route's
entry modules. That's feasible with this data.

Layers have different subgraphs: `moment.js [app-ssr]` has sync edges to every
`moment/locale/*.js`, while `moment.js [app-client]` has none. Always pick the layer explicitly.

### `route`

`entries[]` items contain `route_entry_id`, `module_ident`, `module_path`, `role` (`route`),
and `entry_kind` (`server` | `client_bootstrap`). Entries are where chain searches end.
`coverage.entries` / `coverage.groups` are `exact` or (per the reader source) `unknown`.
Treat `unknown` as "don't trust per-route attribution".

### `output`: chunks

One per emitted file per route. `filename` prefixes:
- `[client-fs]/_next/static/chunks/*.js` are browser chunks
- `[output]/<app>/.next/server/...` are server chunks
- `[project]/...` are non-chunk entries (`coverage: "not_a_chunk"`)

`coverage` is `exact` | `not_a_chunk` | `unsupported`. `modules[]` lists the module idents in the chunk.
`async_loaders[]` lists `next/dynamic entry` idents whose loader code sits in this chunk.

Chunk **filenames are content hashes**. They're identical across captures of identical code, but
they will change whenever code changes, and they don't match `next build` filenames. **Never key
diffs on filename.** Key on `route` + normalised `source_path`.

### `part`: sizes (the numbers we diff)

A `part` is the contribution of one `source_path` (file) to one output `filename` for one route.

- **`size` = minified production bytes.** It matches the real build: moment part 61,346 B,
  `moment.min.js` 60,887 B, and the `next build` chunk containing moment 61,976 B. Per-file raw
  sums are within ~0.1% of the matching `next build` chunk.
- **`compressed_size` ≈ gzip of each part compressed on its own.** A one-part file matches gzip of the
  real file exactly (`0cz1d0mv5g_q7.js`: 39,434 vs 39,627; moment chunk: 19,679 vs 19,759); brotli
  would be ~10% smaller (moment: 17,646). But summing parts **overstates** whole-file gzip
  because each small part loses the shared dictionary: 1.06× to **1.89×** on multi-part chunks.
  `/dashboard` client: sum of parts 230,541 vs ~198 KB real gzip of all built chunks.

| route | client raw | client compressed (part sum) |
|---|---:|---:|
| `/` | 576,405 | 214,764 |
| `/dashboard` | 630,550 | 230,541 |
| moment part on `/dashboard` | 61,346 | 19,308 |

The ~576 KB raw on a near-empty page is real: it's the minified React DOM + Next client runtime
(the largest framework chunk alone is ~229 KB). Bundle Mop should report **deltas**, not absolute
"your page is huge" warnings.

`part.source_path` is a plain path **without a layer tag**, so joining sizes to graph nodes is
by path, plus filtering to `[app-client]` idents.

### `group`

`kind`: `bootstrap` | `render_dependent` | `async`. `trigger_join`: `joined`.
Each group lists the `outputs` that a `trigger_module_ident` causes to load.
- `bootstrap` is the runtime every page loads.
- `render_dependent` is triggered by a layout, page or client component the route renders.
- `async` is triggered by a `next/dynamic entry`. Its outputs are **lazy**.

**First-load JS for a route = all `[client-fs]` parts, minus parts in outputs that appear
only in `async` groups.** Don't compute it as "outputs reachable from non-async groups":
some outputs belong to **no group at all** (for example framework chunk `0cz1d0mv5g_q7.js`, 112,594 B,
loaded by the route's `client_bootstrap` entry). That approach would drop them.

Verified in `fixtures/dynamic-barrel` (see its `EXPECTED.md`): `/lazy` total 635,263 B includes
a 61,657 B lazy-only chunk (moment + `Heavy.tsx`), so first-load is 573,606 B.

## Adapter (`packages/cli/src/adapter/`)

`parseNextAnalyzeExport(text)` / `parseNextAnalyzeLines(lines)` → `AnalyzeSnapshot`:

- **Validates** each record. A schema version it doesn't know, malformed JSON (with the line number), wrongly typed
  fields, or a missing `meta` all throw `AdapterError`. Unknown record types, coverage gaps and a route count that
  doesn't match `meta` go into `warnings`. `allowUnknownSchema` parses a newer schema anyway, with a warning.
- **Normalises** every module path and part `source_path` to a `SourceRef` whose `key` is stable across machines and
  package managers: `app:<path in app>`, `pkg:<name>/<subpath>` (version kept separately; pnpm only),
  `workspace:<path>`, `internal:<path>`, `external:<name>`. The app root is detected from the root `app/layout.*`.
- **Annotates** modules (`layer`, `isClientBoundary`, `isDynamicEntry`, `isServerComponent`, `modifier: 'locals'`)
  and parts/outputs (`isClient`, `isLazy` / `isLazyOnly` from async-only groups).
- `routeSizes()` in `src/model/sizes.ts` derives `client` / `firstLoad` / `lazy` sizes. Tests check `client` against
  Next's own `route-summaries.json` for every route of every fixture.

Verified against both committed fixtures (pnpm monorepo) and a scratch npm app (`appRoot` `''`, same keys, no versions).

## Diff (`packages/cli/src/model/diff.ts`)

`diffSnapshots(base, pr)` compares routes by path and sources by `SourceRef.key` (never chunk filename).
For each route it reports `client` / `firstLoad` / `lazy` deltas (raw exact, compressed estimated) and the changed
modules plus a per-package rollup, sorted by first-load impact. Module statuses: `added`, `removed`, `changed`
(size, gzip estimate or version set differs). It also flags `movedTo: 'lazy' | 'firstLoad'` and version changes (pnpm).
CLI: `bundle-mop diff <base.jsonl[.gz]> <pr.jsonl[.gz]> [--json] [--top n]`.

**Noise is real.** Source that didn't change can still shift by a few bytes, because of minifier name mangling:
`DashboardClient.tsx` −29 B in the `basic-before → basic` pair, and Next framework modules ±2–105 B between two different apps.
The diff reports everything exactly. Thresholds and filtering belong in the report layer.

## What this means for Bundle Mop

| Need | Available? |
|---|---|
| Per-route client JS (raw) | ✅ sum `part.size`. Use raw as the primary, exact metric. |
| Per-route compressed size | ⚠️ part sums overstate by up to ~1.9×. Label it "est." or compress per file ourselves |
| First-load vs lazy split | ✅ via `group.kind` (`async` = lazy). `route-summaries.json` mixes them. |
| Per-module size within a route | ✅ `part.source_path` |
| Import chain (why a module is included) | ✅ `module.dependencies` edges, weighted by part size |
| `"use client"` boundary detection | ✅ `(client reference proxy)` ident |
| `next/dynamic` detection | ✅ `(… next/dynamic entry)` ident + `async` edges + `async` groups |
| Barrel file detection | ✅ ` <locals>` suffix; check part sizes to see what was really shipped |
| Server vs client vs SSR split | ✅ layer tag in `ident` |
| Package name + version | ✅ derivable from path (pnpm hash or npm plain path) |
| Duplicate package versions | ✅ the same package under two `name@ver` paths (pnpm). For npm, nested `node_modules` |
| Deterministic captures | ✅ byte-identical export from a clean `.next` (same `module_index_hash`) |

## Answered questions (2026-11-18)

1. **gzip or brotli?** gzip-like, computed per part. Matches whole-file gzip for one-part files;
   overstates for multi-part files (see `part`).
2. **Why ~576 KB raw on `/`?** It's real minified framework code (matches `next build` within ~0.1%), not unminified output.
3. **Stable between captures?** Yes. Two captures of identical code, the second after deleting `.next`,
   are byte-identical except `snapshot_name`. Chunk filenames are stable for identical code but change with any code change.
4. **npm / yarn shapes?** npm (standalone app): `[project]` = app dir, plain `node_modules/<pkg>/…`
   paths with no hash. yarn is **not tested** (not installed here), so check Yarn PnP before claiming support.
5. **Does `--route` filter `module` records?** No. The reader always writes every `module` record
   and filters only `route`/`output`/`part`/`group`. CI payload size is dominated by modules anyway.
6. **`next/dynamic` and barrels?** See `module` / `group` above. Committed as
   `fixtures/dynamic-barrel` with its facts in `fixtures/dynamic-barrel/EXPECTED.md`.

## Still open

- Yarn (classic and PnP) path shapes.
- How `compressed_size` behaves with `--no-mangling` (probably irrelevant for CI).
- Route groups, parallel routes and `layout.tsx` sharing across routes (shared-chunk attribution).
- Duplicate package versions: needs a fixture to confirm the path shape.
