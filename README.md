# Bundle Mop

> Explains every PR's Next.js bundle change: which import, through which chain, and how to fix it.

**Status: early scaffold.** Nothing usable yet.

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
