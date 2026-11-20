# bundle-mop

> Explains every PR's Next.js bundle change: which import, through which chain, and how to fix it.

A CLI for **Next.js 16.4+** (App Router, Turbopack). It diffs two `next analyze export` snapshots, shows per-route
JS changes, traces the import chain behind each regression, checks per-route budgets, and suggests fixes through a
deterministic rules engine. No AI and no network calls.

```sh
npm i -D bundle-mop

# on the base branch and on your branch:
next analyze --output --snapshot base && next analyze export --snapshot base > base.jsonl
next analyze --output --snapshot pr   && next analyze export --snapshot pr   > pr.jsonl

npx bundle-mop diff base.jsonl pr.jsonl                    # text summary
npx bundle-mop diff base.jsonl pr.jsonl --format markdown  # PR comment
npx bundle-mop diff base.jsonl pr.jsonl --format json      # full diff, budgets and findings
```

```
/dashboard  first-load 569.3 kB → 630.5 kB  (+61.3 kB, +10.8%)
  + pkg:moment/moment.js   +61.3 kB first-load  (added)
      why: app/dashboard/page.tsx → components/DashboardClient.tsx ("use client") → components/DatePicker.tsx → moment/moment.js

Suggestions:
  ! [heavy-package] moment adds 61.3 kB to first-load JS  (/dashboard)
      → Use dayjs (similar API), date-fns (tree-shakeable; optimized by Next by default), or Intl.DateTimeFormat for plain formatting.
```

## Options

| Option | Default | |
|---|---|---|
| `--format text\|markdown\|json` | `text` | `markdown` is the GitHub PR comment |
| `--top <n>` | `10` | Changed modules listed per route |
| `--min-bytes <n>` | `1000` | Noise floor: smaller changes are hidden and never flagged |
| `--config <file>` | `./bundle-mop.config.json` | Per-route budgets |
| `--fail-on <level>` | `error` | Exit 1 on a finding at or above `none`/`info`/`warning`/`error`. Only exceeded budgets are errors |

## Budgets

```json
{
  "budgets": [
    { "route": "/", "firstLoad": "150 kB" },
    { "route": "/**", "firstLoad": "300 kB" }
  ]
}
```

## GitHub Action

The same analysis as a PR comment that updates itself on each push: `uses: yosuva-rv/bundle-mop@v0`.

Full docs (rules, budgets, Action, analyzer format): https://github.com/yosuva-rv/bundle-mop

## Library

```ts
import { analyze, parseNextAnalyzeExport, renderMarkdown } from 'bundle-mop';

const { diff, findings, budgets } = analyze(parseNextAnalyzeExport(baseText), parseNextAnalyzeExport(prText));
console.log(renderMarkdown(diff, { findings, budgets }));
```

MIT
