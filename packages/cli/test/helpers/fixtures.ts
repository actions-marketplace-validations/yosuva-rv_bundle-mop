import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { parseNextAnalyzeExport } from '../../src/adapter/index.js';
import type { AnalyzeSnapshot } from '../../src/adapter/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export const snapshotDir = (fixture: string, name = 'base') =>
  path.join(repoRoot, 'fixtures', fixture, '__snapshots__', 'analyze', name);

/** Raw JSONL text of a committed fixture export. */
export function readExport(fixture: string, name = 'base'): string {
  return zlib.gunzipSync(fs.readFileSync(path.join(snapshotDir(fixture, name), 'export.jsonl.gz'))).toString('utf8');
}

export interface RouteSummary {
  route: string;
  client: { size: number; compressed_size: number };
}

export function readRouteSummaries(fixture: string, name = 'base'): RouteSummary[] {
  return JSON.parse(fs.readFileSync(path.join(snapshotDir(fixture, name), 'route-summaries.json'), 'utf8')) as RouteSummary[];
}

const cache = new Map<string, AnalyzeSnapshot>();
export function loadSnapshot(fixture: string, name = 'base'): AnalyzeSnapshot {
  const key = `${fixture}/${name}`;
  let snap = cache.get(key);
  if (!snap) cache.set(key, (snap = parseNextAnalyzeExport(readExport(fixture, name))));
  return snap;
}
