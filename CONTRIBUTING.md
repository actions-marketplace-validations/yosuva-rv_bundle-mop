# Contributing

Thanks for helping! Bug reports with a reproduction (your `next analyze export` output, or a tiny app) are the most
useful thing you can send.

## Setup

```sh
pnpm install
pnpm typecheck && pnpm test && pnpm build
```

Node 22+ and pnpm 12. See [CLAUDE.md](CLAUDE.md) for the project rules.

## Repo layout

```
packages/cli/      the bundle-mop CLI and library (TypeScript, tsup, vitest), published to npm
packages/action/   the GitHub Action; bundled into packages/action/dist/index.mjs (committed)
fixtures/          small Next.js 16 apps with known regressions, plus committed analyzer snapshots
schema/            JSON Schema for bundle-mop.config.json
scripts/           snapshot-fixture.mjs (regenerate fixture snapshots), release.mjs (cut a release)
docs/              user docs and analyzer format notes
```

## Common tasks

- **Regenerate a fixture snapshot:** `node scripts/snapshot-fixture.mjs basic base /dashboard`, then update that
  fixture's `EXPECTED.md` in the same commit.
- **After changing `packages/cli/src` or `packages/action/src`:** `pnpm -F bundle-mop-action build` and commit
  `packages/action/dist` (CI checks it's current).
- **Add a rule:** `packages/cli/src/rules/`. Add one test where it fires and one where it must not, then document
  it in `docs/rules.md`.
- **Release:** see [docs/releasing.md](docs/releasing.md) (`node scripts/release.mjs x.y.z`, then push the tag).
