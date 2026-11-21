# Changelog

All notable changes to Bundle Mop. The CLI (`bundle-mop` on npm) and the GitHub Action (`yosuva-rv/bundle-mop`)
are versioned together. Until 1.0, minor versions may change output formats and defaults.

## Unreleased

- **New: `bundle-mop compare`.** One command, run inside your Next.js app, compares your branch (uncommitted changes
  included) with `main` from the merge base, like a pull request. The base is analyzed in a temporary git worktree
  with its own lockfile and cached by commit in `node_modules/.cache/bundle-mop`, so repeat runs take seconds.
  Options: `--base`, `--dir`, `--install-command`, `--no-cache`, `--verbose`, plus all report options. Progress goes
  to stderr, so `--format json > out.json` stays clean.
- Reports always print to stdout, even when a budget fails the run (exit code 1); only errors go to stderr.
- Next.js is now looked up only in the app's own `node_modules` folders, never through `NODE_PATH` (which pnpm sets).
- The GitHub Action and the CLI share one implementation for checking out, installing and analyzing the base.
- Docs: a simpler README with a logo, a screenshot of a real PR comment, a one-file quick start and an FAQ;
  developer notes moved to CONTRIBUTING.md. The npm page shows the logo and screenshot too.

## 0.1.1 (2026-11-20)

Polish found while building the [demo app](https://github.com/yosuva-rv/bundle-mop-demo).

- Sizes of 1 MB and over print as MB with two decimals (`1.00 MB`, `1.04 MB`) instead of `1000.0 kB`.
- `server-candidate` no longer says "Imported by X" when X is the `"use client"` file it already named.
- Text report: routes whose JS changed by less than `--min-bytes` are summarised in one line instead of listed
  (`--min-bytes 0` lists them), matching the PR comment.
- Action: reworded the `action.yml` descriptions without apostrophes. The GitHub Marketplace rendered
  "PR's" as "PR s" in the listing's About box.

## 0.1.0 (2026-11-20)

First release.

**Analysis**
- Reads `next analyze export` JSON Lines (Next.js 16.4+, schema version 1) into a normalised model. Paths are stable
  across machines and package managers (pnpm hashes stripped; npm and pnpm layouts give the same keys).
- Per-route **first-load**, **lazy** (`next/dynamic`) and total client JS, in exact minified bytes; gzip shown as an estimate.
- Base-vs-PR diff by route and file, never by chunk filename. Flags added, removed and changed modules, version
  changes, and code moving between first-load and lazy.
- **Import chains**: why a module ships, from the page through `"use client"` boundaries, dynamic imports and barrels,
  naming the importer to change.

**Rules** (deterministic, no AI): `heavy-package`, `lost-lazy-loading`, `duplicate-package`, `server-candidate`,
`lazy-load-candidate` (with a `next/dynamic` snippet), `optimize-package-imports`. Framework packages are never
flagged; changes under the 1 kB noise floor are never flagged.

**Budgets**: `bundle-mop.config.json` with per-route `firstLoad` / `lazy` / `client` limits and route patterns.
Newly exceeded budgets fail the check; budgets already blown on the base branch only warn. A JSON Schema is included.

**Reports**: text, JSON, and a GitHub PR comment (route table, collapsible module details with import chains, budgets,
grouped suggestions; packages with many small changed files collapse into one row; stays under GitHub's comment limit).

**CLI**: `bundle-mop diff <base> <pr> [--format text|markdown|json] [--top n] [--min-bytes n] [--config file] [--fail-on level]`.

**GitHub Action**: analyzes the PR and its base (temporary git worktree, lockfile-detected install for pnpm, npm,
Yarn or Bun), then creates or updates one PR comment and writes the job summary. Inputs: `working-directory`,
`base-ref`, `install-command`, `min-bytes`, `comment`, `config`, `fail-on`, `github-token`. Fork PRs get a warning
instead of a comment.
