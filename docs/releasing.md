# Releasing

The CLI (npm `bundle-mop`) and the Action (`yosuva-rv/bundle-mop@vX`) share one version.

## Checklist

1. **Prepare** (a normal PR or commit on `main`):
   - Bump `packages/cli/package.json` `version` and `VERSION` in `packages/cli/src/index.ts` (a test checks they match
     and that `CHANGELOG.md` has a `## <version>` entry).
   - Move the changelog entry from "(unreleased)" to the release date.
   - Rebuild the action bundle (`pnpm -F bundle-mop-action build`) and commit it.
   - CI green.
2. **Check the npm tarball**: `cd packages/cli && npm pack --dry-run`. Expect `dist/`, `README.md`, `LICENSE`,
   `package.json` only.
3. **Publish to npm** (the maintainer, logged in with `npm login`; 2FA prompts for a one-time code):
   `cd packages/cli && npm publish`. `prepublishOnly` runs typecheck, tests and build first.
   After the first publish, consider npm **trusted publishing** (OIDC from GitHub Actions, no long-lived token).
   Note that `actions/setup-node` v7 no longer exports a dummy `NODE_AUTH_TOKEN`.
4. **Tag** the release commit and move the major tag:
   `git tag -a v0.1.0 -m "v0.1.0" && git tag -f v0 && git push origin v0.1.0 && git push -f origin v0`.
5. **GitHub release** from `v0.1.0` with the changelog entry. Tick "Publish this Action to the GitHub Marketplace"
   (first time: accept the Marketplace agreement; the `name` in `action.yml` must be unique on the Marketplace).
6. **Docs**: switch examples from `@main` to `@v0`.

Steps 3–5 are public and can't be fully undone. npm only allows unpublishing within 72 hours, and a version number
can never be reused.
