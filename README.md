# Bundle Mop

> Explains every PR's Next.js bundle change: which import, through which chain, and how to fix it.

**Status: early.** The analyzer adapter, base-vs-PR diff, import-chain "why", rules engine, per-route budgets,
markdown PR comment and GitHub Action work. See an [example PR comment](packages/cli/test/golden/basic-before-to-basic.md).

**Budgets:** add a `bundle-mop.config.json` and PRs that push a route over its limit fail the check.
See [docs/budgets.md](docs/budgets.md).

```json
{ "budgets": [{ "route": "/", "firstLoad": "150 kB" }, { "route": "/**", "firstLoad": "300 kB" }] }
```

## GitHub Action

```yaml
on: pull_request
permissions: { contents: read, pull-requests: write }
jobs:
  bundle-mop:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22 }
      - run: npm ci
      - uses: yosuva-rv/bundle-mop@main
```

Inputs, outputs, forks and security: [docs/action.md](docs/action.md).

## CLI

```
/dashboard  first-load 569.3 kB → 630.5 kB  (+61.3 kB, +10.8%)
  + pkg:moment/moment.js   +61.3 kB first-load  (added)
      why: app/dashboard/page.tsx → components/DashboardClient.tsx ("use client") → components/DatePicker.tsx → moment/moment.js

Suggestions:
  ! [heavy-package] moment adds 61.3 kB to first-load JS  (/dashboard)
      → Use dayjs (similar API), date-fns (tree-shakeable; optimized by Next by default), or Intl.DateTimeFormat for plain formatting.
  i [lazy-load-candidate] Lazy-load components/DatePicker.tsx to keep moment out of first-load JS  (/dashboard)
        // components/DashboardClient.tsx
        const DatePicker = dynamic(() => import('./DatePicker'));
```

Rules are listed in [docs/rules.md](docs/rules.md).

```sh
# in your Next.js 16 app, on each side of the change:
next analyze --output --snapshot base && next analyze export --snapshot base > base.jsonl
next analyze --output --snapshot pr   && next analyze export --snapshot pr   > pr.jsonl

bundle-mop diff base.jsonl pr.jsonl                     # text summary
bundle-mop diff base.jsonl pr.jsonl --format markdown   # PR comment
bundle-mop diff base.jsonl pr.jsonl --format json       # full diff + findings
bundle-mop diff base.jsonl pr.jsonl --min-bytes 2000    # raise the noise floor (default 1000 B)
```

Bundle Mop compares `next analyze` snapshots (Next.js 16, Turbopack) between your base branch and
a pull request. It shows per-route client JS changes, traces the import chain behind each
regression, and suggests fixes through a deterministic rules engine.

## Repo layout

```
packages/cli/   the bundle-mop CLI (TypeScript, tsup, vitest)
fixtures/       small Next.js 16 apps with known regressions, plus committed analyzer snapshots
scripts/        snapshot-fixture.mjs: regenerate fixture snapshots
docs/           analyzer format notes
```

## Develop

```sh
pnpm install
pnpm typecheck && pnpm test && pnpm build
node scripts/snapshot-fixture.mjs basic base
```

## License

MIT
