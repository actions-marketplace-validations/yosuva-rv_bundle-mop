#!/usr/bin/env node
// Prepares a release commit and tag. Pushing the tag runs .github/workflows/release.yml.
//
//   node scripts/release.mjs 0.1.2            # bump, test, build, commit, tag (local only)
//   node scripts/release.mjs 0.1.2 --dry-run  # show what would change; touch nothing
//
// Then: git push origin main --follow-tags
//
// Expects a "## Unreleased" section at the top of CHANGELOG.md; it becomes "## 0.1.2 (YYYY-MM-DD)".
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = args.find((a) => !a.startsWith('--'));

const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};
const sh = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', shell: process.platform === 'win32' && cmd === 'pnpm' });

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('usage: node scripts/release.mjs <x.y.z> [--dry-run]');

const cliPkgPath = path.join(root, 'packages/cli/package.json');
const current = JSON.parse(fs.readFileSync(cliPkgPath, 'utf8')).version;
const [ma, mi, pa] = current.split('.').map(Number);
const [na, ni, np] = version.split('.').map(Number);
const newer = na > ma || (na === ma && (ni > mi || (ni === mi && np > pa)));
if (!newer) fail(`${version} is not newer than the current version ${current}`);

if (!dryRun) {
  if (sh('git', ['status', '--porcelain']).trim()) fail('working tree is not clean; commit or stash first');
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== 'main') fail(`on branch ${branch}; releases are cut from main`);
  if (sh('git', ['tag', '--list', `v${version}`]).trim()) fail(`tag v${version} already exists`);
}

const changelogPath = path.join(root, 'CHANGELOG.md');
const changelog = fs.readFileSync(changelogPath, 'utf8');
if (!/^## Unreleased\s*$/m.test(changelog)) fail('CHANGELOG.md has no "## Unreleased" section to release');
const unreleased = changelog.split(/^## Unreleased\s*$/m)[1]?.split(/^## /m)[0]?.trim() ?? '';
if (!unreleased) fail('the "## Unreleased" section in CHANGELOG.md is empty; describe the changes first');

const today = new Date().toISOString().slice(0, 10);
const edits = [
  { file: 'packages/cli/package.json', from: `"version": "${current}"`, to: `"version": "${version}"` },
  { file: 'packages/action/package.json', from: `"version": "${current}"`, to: `"version": "${version}"` },
  { file: 'packages/cli/src/index.ts', from: `export const VERSION = '${current}';`, to: `export const VERSION = '${version}';` },
  { file: 'CHANGELOG.md', from: /^## Unreleased\s*$/m, to: `## ${version} (${today})` },
];

console.log(`release: ${current} -> ${version}${dryRun ? ' (dry run)' : ''}`);
for (const e of edits) {
  const p = path.join(root, e.file);
  const text = fs.readFileSync(p, 'utf8');
  const found = typeof e.from === 'string' ? text.includes(e.from) : e.from.test(text);
  if (!found) fail(`${e.file}: expected to find ${String(e.from)}`);
  console.log(`  ${e.file}: ${typeof e.from === 'string' ? e.from : '## Unreleased'} -> ${e.to}`);
  if (!dryRun) fs.writeFileSync(p, text.replace(e.from, e.to));
}
console.log(`\nChangelog entry:\n${unreleased}\n`);

if (dryRun) {
  console.log('Dry run: nothing changed.');
  process.exit(0);
}

console.log('release: typecheck, test, build (rebuilds the action bundle)');
sh('pnpm', ['typecheck'], { inherit: true });
sh('pnpm', ['test'], { inherit: true });
sh('pnpm', ['build'], { inherit: true });

sh('git', ['add', '-A']);
sh('git', ['commit', '-q', '-m', `chore: release ${version}`]);
sh('git', ['tag', '-a', `v${version}`, '-m', `v${version}`]);
console.log(`\nrelease: committed and tagged v${version} locally.\nNext: git push origin main --follow-tags  (runs the Release workflow)`);
