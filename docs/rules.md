# Rules

`runRules(diff, base, pr, options)` (`packages/cli/src/rules/`) runs deterministic rules over every changed or added
route (Next-internal `/_…` routes are skipped unless `includeInternalRoutes`). Findings with the same
`ruleId + subject` merge across routes, keeping the worst route's numbers and chain. They're sorted by severity, then bytes.
No AI and no network: same input, same output.

| Rule | Severity | Fires when | Suggests |
|---|---|---|---|
| `heavy-package` | warning | A catalog package (moment, moment-timezone, full lodash build, underscore, jquery) is added to or grows first-load by ≥ `minBytes` | A lighter alternative |
| `lost-lazy-loading` | warning | A package or app file moved from lazy (async group) to first-load by ≥ `minBytes` | Check for a removed `next/dynamic` or a new static import |
| `duplicate-package` | warning | A package ships in ≥ 2 versions on a route **and that's new in this PR** (pnpm layouts only, since npm paths carry no version) | `pnpm why`, align versions or add an override |
| `server-candidate` | info | A formatting/parsing library (date, markdown, highlighting, YAML…) reaches first-load through a `"use client"` boundary, not via dynamic import | Do the work in a Server Component and pass props |
| `lazy-load-candidate` | info | Any package grows first-load by ≥ `largeBytes` through a client boundary, with an app importer | `next/dynamic` snippet for the importer's parent file |
| `optimize-package-imports` | info | ≥ `moduleThreshold` modules of one package ship, and Next doesn't already optimize it | Subpath imports or `experimental.optimizePackageImports` |

Options (defaults): `minBytes` 1,000 (noise floor), `largeBytes` 30,000, `moduleThreshold` 10, `includeInternalRoutes` false.
Custom rules: pass `rules: Rule[]` (`{ id, description, check(ctx) → RouteFinding[] }`).

## Guardrails

- **Framework packages are never flagged**: `next`, `react`, `react-dom`, `scheduler`, `styled-jsx`, `@swc/helpers`,
  `client-only`, `server-only`. On a newly added route, every package is "added" (`next` alone is ~562 kB / 164 modules).
- **lodash**: Next 16.4.6 rewrites `import { x } from 'lodash'` to per-method imports (`modularizeImports`), so only the
  full build `lodash/lodash.js` (from `import _ from 'lodash'`) is flagged.
- **Next's default `optimizePackageImports` list** is copied from `next/dist/server/config.js` (16.4.6) and matches the
  docs page: lucide-react, date-fns, lodash-es, @mui/*, react-icons/*, @effect/*, and others. Re-check on Next upgrades.
- Only first-load growth counts. Lazy-only growth produces no findings.

Docs links were checked live on 2026-11-19:
[lazy loading](https://nextjs.org/docs/app/guides/lazy-loading),
[Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components),
[optimizePackageImports](https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports) (experimental).

## Verified on fixtures

`basic-before → basic` (moment added via `DatePicker`): `heavy-package`, `lazy-load-candidate` (snippet:
`const DatePicker = dynamic(() => import('./DatePicker'))` in `components/DashboardClient.tsx`), `server-candidate`.
The reverse diff, identical snapshots, and `basic-before → dynamic-barrel` (an added route with only lazy moment) give no findings.
