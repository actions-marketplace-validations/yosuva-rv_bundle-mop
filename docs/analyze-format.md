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

## Files on disk (`.next/diagnostics/analyze/`)

- `history/history.json` lists snapshots: `name`, `createdAt`, `nextVersion`, `gitBranch`, `gitDirty`, `appDirOnly`, `noMangling`, `routeCount`.
- `history/snapshot-<name>/route-summaries.json` gives **per-route totals directly**:
  `{ route, size, compressed_size, client: { size, compressed_size } }`. The `client` numbers equal
  the sum of that route's `[client-fs]` `part` records (verified: `/` = 576,405 B / 214,764 B gz).
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

- `ident` is the unique node id: `<path> [<layer>] (<kind>)`. The same file shows up once per layer:
  - `[app-rsc]` server components (RSC)
  - `[app-ssr]` server-side render of client components
  - `[app-client]` **browser bundle** (what we measure)
  - `(client reference proxy)` marks a **`"use client"` boundary**
- `dependencies.sync` / `async` contain **edges to other `ident`s**, so the full import chain is
  available. `async` covers dynamic imports. `traced` was empty everywhere in this fixture.
- `path` is relative to **`[project]` = the workspace root** (monorepo root), not the app dir.
  So app files look like `[project]/fixtures/basic/app/page.tsx`.
- pnpm paths include a **machine-specific hash**:
  `node_modules/.pnpm/next@16.4.6_@types+node@22._1e2e5987…/node_modules/next/...`. The adapter
  must normalise to `package@version/subpath` before diffing base and PR.
- Other prefixes seen: `[externals]/path` (Node built-ins), `.next-internal/…/actions.js`.

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

Side observation: `moment.js [app-ssr]` has sync edges to every `moment/locale/*.js`, while
`moment.js [app-client]` has none. Layers can have different subgraphs, so always pick the
layer explicitly.

### `route`

`entries[]` items contain `route_entry_id`, `module_ident`, `module_path`, `role` (`route`),
and `entry_kind` (`server` | `client_bootstrap`). Entries are where chain searches end.
`coverage` was `{"entries":"exact","groups":"exact"}` for every route.

### `output`: chunks

One per emitted file per route. `filename` prefixes:
- `[client-fs]/_next/static/chunks/*.js` are browser chunks
- `[output]/fixtures/basic/.next/server/...` are server chunks
- `[project]/...` are non-chunk entries (`coverage: "not_a_chunk"`)

`coverage` is `exact` | `not_a_chunk` | `unsupported`. `modules[]` lists the module idents in the chunk.

### `part`: sizes (the numbers we diff)

A `part` is the contribution of one `source_path` (file) to one output `filename` for one route:
`size` (raw bytes) and `compressed_size` (bytes; gzip assumed, **not confirmed** by any field).

**Route client JS = sum of `part` records where `filename` starts with `[client-fs]`.**

| route | client raw | client compressed |
|---|---:|---:|
| `/` | 576,405 | 214,764 |
| `/dashboard` | 630,550 | 230,541 |
| moment part on `/dashboard` | 61,346 | 19,308 |

`part.source_path` is a plain path **without a layer tag**, so joining sizes to graph nodes is
by path, plus filtering to `[app-client]` idents.

### `group`

`kind`: `bootstrap` | `render_dependent`. `trigger_join`: `joined`. Each group lists the `outputs`
that a `trigger_module_ident` (for example `layout.tsx`) causes to load. This is probably how we
separate the shared/first-load set from per-route chunks.

## What this means for Bundle Mop

| Need | Available? |
|---|---|
| Per-route client JS (raw + compressed) | ✅ `route-summaries.json`, or sum `part` |
| Per-module size within a route | ✅ `part.source_path` |
| Import chain (why a module is included) | ✅ `module.dependencies` edges |
| `"use client"` boundary detection | ✅ `(client reference proxy)` ident |
| Server vs client vs SSR split | ✅ layer tag in `ident` |
| Package name + version | ✅ derivable from path (needs pnpm/npm/yarn normalisation) |
| Duplicate package versions | ✅ the same package under two `pkg@ver` paths |
| Dynamic imports (`next/dynamic`) | ⚠️ `dependencies.async` exists; not exercised yet |

## Open questions (next spikes)

1. Is `compressed_size` gzip or brotli? Check the Next source or compare with a real build.
2. Raw client JS on `/` is ~576 KB for a near-empty page. Does the analyzer measure unminified or
   non-mangled code (it says it does not produce an app build)? Compare against `next build` chunk sizes.
3. Are idents and paths stable between two captures of identical code (the `module_index_hash`)?
   Capture `base` twice and diff.
4. Do the shapes for npm and yarn match pnpm (path prefixes)?
5. Does `--route` filtering also filter `module` records? (It would shrink CI payloads.)
6. Add a fixture with `next/dynamic` and a barrel import to see the `async` edges.
