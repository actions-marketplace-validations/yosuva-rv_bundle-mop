# Budgets

Put a `bundle-mop.config.json` next to your Next.js app (or at the repository root):

```json
{
  "$schema": "https://raw.githubusercontent.com/yosuva-rv/bundle-mop/main/schema/bundle-mop.config.schema.json",
  "budgets": [
    { "route": "/", "firstLoad": "150 kB" },
    { "route": "/dashboard/**", "firstLoad": "250 kB", "lazy": "400 kB" },
    { "route": "/**", "firstLoad": "300 kB" }
  ]
}
```

- **Metrics** (minified bytes, the exact numbers from `next analyze`): `firstLoad` (JS needed before the page is
  interactive), `lazy` (`next/dynamic` chunks), `client` (both together). There are no gzip budgets on purpose:
  the analyzer's gzip numbers are per-part estimates that overstate real gzip by up to ~1.9×.
- **Sizes:** `"150 kB"` (1 kB = 1000 B, like Next.js), `"146.5 KiB"`, `"1.5 MB"`, or a number of bytes.
- **Route patterns:** exact (`/`, `/blog/[slug]`), `*` = one segment (`/blog/*`), `**` = any number of segments
  including none (`/dashboard/**` also matches `/dashboard`). **The first matching entry wins**, so put specific
  routes before catch-alls. Wildcards never match Next-internal routes (`/_not-found`, `/_global-error`).
- **JSON, not JS:** loading a PR's config never runs code.

## What happens

| Status | When | Severity |
|---|---|---|
| ❌ over | Over budget in the PR, and either newly over, a new route, or grew by ≥ `min-bytes` while over | **error** |
| ⚠️ still over | Already over on the base branch and didn't grow | warning (an unrelated PR isn't blocked) |
| ✅ back under | Over on base, under now | none |
| ✅ N% used | Under budget | none |

Errors fail the check by default (`fail-on: error` in the Action, `--fail-on error` in the CLI). Rules never
produce errors, so without a budgets file nothing fails. The PR comment gets a **Budgets** table and a headline
like "❌ 1 budget exceeded", explaining what grew (with its import chain) and how to fix it or raise the budget.

## Where it's read

- **Action:** the `config` input, otherwise `bundle-mop.config.json` in `working-directory`, then the repository root.
  It's read from the PR's checkout, so a PR can raise its own budget, and that change shows in the diff for review.
- **CLI:** `bundle-mop diff base.jsonl pr.jsonl --config path`, otherwise `./bundle-mop.config.json` if present.
