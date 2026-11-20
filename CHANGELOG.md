# Changelog

All notable changes to Bundle Mop. The CLI (`bundle-mop` on npm) and the GitHub Action (`yosuva-rv/bundle-mop`)
are versioned together. Until 1.0, minor versions may change output formats and defaults.

## 0.1.0 (unreleased)

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
