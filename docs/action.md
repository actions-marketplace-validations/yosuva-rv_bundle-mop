# GitHub Action

Posts (and keeps updating) one comment per pull request explaining the Next.js bundle change, and writes the same
report to the job summary.

```yaml
# .github/workflows/bundle-mop.yml
name: Bundle Mop
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  bundle-mop:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6 # only if you use pnpm
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: yosuva-rv/bundle-mop@main # pin a release tag once one exists
        with:
          working-directory: apps/web # omit if the app is at the repository root
```

## How it works

1. Runs `next analyze --output --snapshot pr` and `next analyze export` on the checked-out code (dependencies must
   already be installed, as above).
2. Fetches the base commit if needed, checks it out in a temporary `git worktree`, installs its dependencies
   (command detected from the lockfile: pnpm, npm, yarn classic or berry, or bun), and analyzes it the same way.
3. Diffs the two snapshots, runs the rules, renders the markdown, and creates or updates the comment marked
   `<!-- bundle-mop:comment -->`.
4. Removes the worktree.

Cost per run: one extra dependency install plus two `next analyze` runs (each a few seconds on small apps; no
`next build`). Requires Next.js **16.4+** (for `next analyze export`).

## Inputs

| Input | Default | |
|---|---|---|
| `working-directory` | `.` | The Next.js app, relative to the repository root |
| `base-ref` | PR base commit | Commit or ref to compare against (required outside `pull_request` events) |
| `install-command` | from lockfile | Runs in the lockfile's directory in the base checkout |
| `min-bytes` | `1000` | Noise floor: smaller changes are hidden and never flagged |
| `comment` | `true` | Create or update the PR comment |
| `config` | auto | Budgets file ([docs/budgets.md](budgets.md)). Default: `bundle-mop.config.json` in `working-directory`, then the repository root |
| `fail-on` | `error` | Fail the step on a finding of this severity or worse: `none`, `info`, `warning`, `error`. Only exceeded budgets are errors, so without budgets nothing fails |
| `github-token` | `github.token` | Needs `pull-requests: write` to comment |

## Outputs

`report-path` (markdown), `json-path` (diff, budgets and findings), `routes-changed`, `largest-first-load-delta`
(bytes), `findings` (count), `budgets-exceeded` (count).

## Security and forks

- Use `on: pull_request`, **not** `pull_request_target`. The action runs the PR's code (`next.config.*` executes
  during analysis), and `pull_request_target` would give that code a write token.
- On PRs from forks, GitHub gives `pull_request` workflows a read-only token, so the comment fails. The action logs
  a warning and the report is still in the job summary.
- The token is only sent to the GitHub API, for listing, creating and updating issue comments.

## Development

The action is `packages/action` (TypeScript), bundled with the CLI's source into `packages/action/dist/index.mjs`,
which **is committed** because GitHub runs it directly. After changing `packages/action/src` or `packages/cli/src`:

```sh
pnpm -F bundle-mop-action build   # then commit packages/action/dist
```

CI fails if the committed bundle is stale, and runs the action on `fixtures/basic` on every push and PR.
