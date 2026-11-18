#!/usr/bin/env node
// Regenerates the committed analyzer snapshot for a fixture app.
//
//   node scripts/snapshot-fixture.mjs <fixture> [snapshotName]
//   e.g. node scripts/snapshot-fixture.mjs basic base
//
// Writes fixtures/<fixture>/__snapshots__/analyze/<snapshotName>/:
//   export.jsonl.gz       full `next analyze export` output (gzipped)
//   sample.jsonl          small human-readable slice (meta, routes, groups,
//                         app-code + top-level package modules, one route's outputs/parts)
//   route-summaries.json  per-route totals written by `next analyze --output`
//   metadata.json         snapshot metadata written by Next
//   capture.json          how/when this capture was produced
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [fixture, name = 'base'] = process.argv.slice(2);
if (!fixture) {
  console.error('usage: node scripts/snapshot-fixture.mjs <fixture> [snapshotName]');
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, '..');
const appDir = path.join(root, 'fixtures', fixture);
const outDir = path.join(appDir, '__snapshots__', 'analyze', name);
const nextBin = path.join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next');

const next = (args) =>
  execFileSync(process.execPath, [nextBin, ...args], {
    cwd: appDir,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

console.log(`> next analyze --output --snapshot ${name}  (${fixture})`);
next(['analyze', '--output', '--snapshot', name]);

console.log(`> next analyze export --snapshot ${name}`);
const jsonl = next(['analyze', 'export', '--snapshot', name]);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'export.jsonl.gz'), zlib.gzipSync(jsonl, { level: 9 }));

const snapDir = path.join(appDir, '.next', 'diagnostics', 'analyze', 'history', `snapshot-${name}`);
for (const f of ['route-summaries.json', 'metadata.json']) {
  fs.copyFileSync(path.join(snapDir, f), path.join(outDir, f));
}

// --- curated sample -------------------------------------------------------
const records = jsonl.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const appPrefix = `[project]/fixtures/${fixture}/`;
const isAppCode = (p) => p.startsWith(appPrefix) && !p.includes('node_modules');
// Entry file of a third-party package, e.g. .../node_modules/moment/moment.js (not next/react internals).
const isPackageEntry = (p) =>
  /node_modules\/(?!\.pnpm)(?!next\/|react\/|react-dom\/|@next\/|@swc\/|styled-jsx\/)[^/]+\/[^/]+\.js$/.test(p);
const routes = records.filter((r) => r.type === 'route').map((r) => r.route);
const focusRoute = routes.includes('/dashboard') ? '/dashboard' : routes[0];

const sample = records.filter((r) => {
  switch (r.type) {
    case 'meta':
    case 'route':
    case 'group':
      return true;
    case 'module':
      return isAppCode(r.path) || isPackageEntry(r.path);
    case 'output':
      return r.route === focusRoute && r.coverage === 'exact' && r.filename.startsWith('[client-fs]');
    case 'part':
      return r.route === focusRoute && r.filename.startsWith('[client-fs]');
    default:
      return true; // unknown record types are kept so format changes are visible
  }
});
fs.writeFileSync(path.join(outDir, 'sample.jsonl'), sample.map((r) => JSON.stringify(r)).join('\n') + '\n');

const counts = {};
for (const r of records) counts[r.type] = (counts[r.type] ?? 0) + 1;
const nextVersion = JSON.parse(fs.readFileSync(path.join(appDir, 'node_modules', 'next', 'package.json'), 'utf8')).version;
fs.writeFileSync(
  path.join(outDir, 'capture.json'),
  JSON.stringify(
    {
      fixture,
      snapshot: name,
      nextVersion,
      node: process.version,
      platform: process.platform,
      capturedAt: new Date().toISOString(),
      commands: [`next analyze --output --snapshot ${name}`, `next analyze export --snapshot ${name}`],
      recordCounts: counts,
      sample: { focusRoute, records: sample.length },
    },
    null,
    2,
  ) + '\n',
);

console.log(`wrote ${path.relative(root, outDir)}  (${records.length} records, sample ${sample.length})`);
