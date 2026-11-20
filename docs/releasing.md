# Releasing

The CLI (npm `bundle-mop`) and the Action (`yosuva-rv/bundle-mop@vX`) share one version. Releases are automated:
you run one script and push; the **Release** workflow does the rest.

## Every release

1. As you work, add changes under a `## Unreleased` heading at the top of `CHANGELOG.md`.
2. Cut the release from a clean `main`:
   ```sh
   node scripts/release.mjs 0.1.2 --dry-run   # preview
   node scripts/release.mjs 0.1.2             # bump, typecheck, test, build, commit, tag v0.1.2 (local)
   git push origin main --follow-tags         # starts .github/workflows/release.yml
   ```
3. The **Release** workflow ([`release.yml`](../.github/workflows/release.yml)) then:
   - checks the tag matches `packages/cli/package.json`, the changelog has the entry, and the commit is on `main`
   - runs typecheck, tests and build, and checks the committed action bundle is current
   - publishes `bundle-mop` to npm with **provenance** using **trusted publishing** (OIDC: no npm token or 2FA code)
   - moves the major tag (`v0`) so `uses: yosuva-rv/bundle-mop@v0` picks up the release
   - creates the GitHub release with the changelog entry as notes
   - is safe to re-run: it skips the npm publish and the release if they already exist
4. **Optional:** to update the GitHub Marketplace listing, edit the new release on GitHub, tick
   "Publish this Action to the GitHub Marketplace" and save. GitHub's release API can't set this, so it stays a
   manual click. Users on `@v0` get the new version either way.

## One-time setup (done once per package)

npmjs.com → **bundle-mop** → **Settings** → **Trusted publishing** → **GitHub Actions**:

| Field | Value |
|---|---|
| Organization or user | `yosuva-rv` |
| Repository | `bundle-mop` |
| Workflow filename | `release.yml` |
| Environment name | *(leave empty)* |
| Allowed actions | tick **npm publish** (configurations created after 2026-09-03 only allow `npm stage publish` by default) |

A new trusted publisher must complete its **first publish within 2 days**, or it has to be set up again.
Requirements (handled by the workflow): GitHub-hosted runner, Node ≥ 22.14 and npm ≥ 11.5.1 (the workflow uses
Node 24 and checks the npm version), and `permissions: id-token: write`.

## Manual fallback

If the workflow can't publish: `cd packages/cli && npm publish` (needs `npm login` and your 2FA code), then
re-run the workflow. It skips the npm step and does the tags and release.

npm only allows unpublishing within 72 hours, and a version number can never be reused. Fix mistakes with a new
patch version.
