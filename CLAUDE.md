# Bundle Mop

Open-source CLI + GitHub Action for Next.js 16 (App Router, Turbopack). It diffs
`next analyze` snapshots between base and PR, shows per-route client JS changes, explains
WHY (import chains), and suggests fixes with a deterministic rules engine.

## Stack
- pnpm workspaces (pnpm 12, Node >= 20.9; local dev on 22)
- `packages/cli`: TypeScript 6.0 (not 7, because tsup/Next need the JS API), tsup (ESM, node20), vitest
- `fixtures/*`: tiny Next.js 16 apps with **intentional** regressions; exact versions pinned
- Analyzer format notes: `docs/analyze-format.md`. Read it before touching parsing code.

## Commands
- `pnpm install`
- `pnpm typecheck` / `pnpm test` / `pnpm build`: CLI package
- `pnpm -F bundle-mop dev`: tsup watch
- `pnpm fixtures:build`: `next build` every fixture
- `node scripts/snapshot-fixture.mjs <fixture> [name]`: regenerate `fixtures/<fixture>/__snapshots__/analyze/<name>/`

## Rules
- Before calling anything done, run `pnpm typecheck && pnpm test && pnpm build` and show the output.
- All analyzer-format parsing lives in ONE adapter module. Nothing else reads raw JSONL.
- Tests read committed snapshots and never run `next build` or `next analyze`.
- Fixtures are test data. Don't add feature code to them, and don't "fix" their intentional regressions.
- Never change snapshots and the code that consumes them in the same commit without saying so explicitly.
- Every bug report becomes a new fixture plus a committed snapshot to compare against.
- Regenerating snapshots after a Next upgrade: note the Next version (it's in `capture.json`) and update `docs/analyze-format.md`.
- Sizes: raw `part.size` is the exact metric; summed `compressed_size` overstates gzip (label it estimated); first-load JS excludes `async` groups. Diff on route + normalised path, never chunk filename. Details in `docs/analyze-format.md`.
- Normalise machine-specific paths (pnpm `.pnpm/<pkg>@<ver>_<hash>`) before comparing anything.
- Keep CLI runtime dependencies at zero unless there's a clear reason. Ask before adding one.
- Rules engine stays deterministic. AI explanations are optional and opt-in (`--ai`, the user's own key).
- After 3 failed attempts at the same fix, stop and explain what you tried. Don't loop.
- Windows and Linux both matter: use `node:path`, no shell-specific scripts.
- Git Bash rewrites args like `/lazy` into Windows paths. Pass routes from PowerShell, or set `MSYS_NO_PATHCONV=1`.
- Each fixture has an `EXPECTED.md` listing the facts tests should assert. Keep it in sync with its snapshot.
