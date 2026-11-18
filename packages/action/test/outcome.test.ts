import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { diffSnapshots, parseNextAnalyzeExport, runRules } from 'bundle-mop';
import type { Finding } from 'bundle-mop';
import { describe, expect, it } from 'vitest';
import { failureFor, summarize } from '../src/outcome.js';

const load = (fixture: string) =>
  parseNextAnalyzeExport(
    zlib.gunzipSync(fs.readFileSync(path.resolve(import.meta.dirname, `../../../fixtures/${fixture}/__snapshots__/analyze/base/export.jsonl.gz`))).toString('utf8'),
  );

describe('summarize', () => {
  it('counts the moment regression', () => {
    const diff = diffSnapshots(load('basic-before'), load('basic'));
    expect(summarize(diff, 1000)).toEqual({ routesChanged: 1, largestFirstLoadDelta: 61_253 });
  });

  it('reports zero for identical snapshots and for shrinking routes', () => {
    const s = load('basic');
    expect(summarize(diffSnapshots(s, s), 1000)).toEqual({ routesChanged: 0, largestFirstLoadDelta: 0 });
    expect(summarize(diffSnapshots(load('basic'), load('basic-before')), 1000)).toEqual({ routesChanged: 1, largestFirstLoadDelta: 0 });
  });
});

describe('failureFor', () => {
  const base = load('basic-before');
  const pr = load('basic');
  const findings = runRules(diffSnapshots(base, pr), base, pr); // 1 warning + 2 info

  it('never fails with fail-on none', () => {
    expect(failureFor(findings, 'none')).toBeUndefined();
  });

  it('fails at or above the threshold', () => {
    expect(failureFor(findings, 'warning')).toBe('1 finding at or above "warning" (fail-on): moment adds 61.3 kB to first-load JS');
    expect(failureFor(findings, 'info')).toMatch(/^3 findings at or above "info"/);
    expect(failureFor(findings, 'error')).toBeUndefined();
  });

  it('passes with no findings', () => {
    expect(failureFor([] as Finding[], 'info')).toBeUndefined();
  });
});
