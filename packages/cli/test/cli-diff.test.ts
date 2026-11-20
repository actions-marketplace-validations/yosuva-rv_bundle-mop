import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../src/index.js';
import type { SnapshotDiff } from '../src/model/diff.js';
import { formatBytes, formatDelta } from '../src/report/text.js';
import { fakeExportText } from './helpers/fake-export.js';
import { snapshotDir } from './helpers/fixtures.js';

const exportGz = (fixture: string) => path.join(snapshotDir(fixture), 'export.jsonl.gz');
const BASE = exportGz('basic-before');
const PR = exportGz('basic');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-mop-test-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const writeTmp = (name: string, text: string) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, text);
  return f;
};

describe('bundle-mop diff', () => {
  it('prints a text report for the moment regression', () => {
    const { code, output } = run(['diff', BASE, PR]);
    expect(code).toBe(0);
    expect(output).toContain('1 changed, 0 added, 0 removed, 3 unchanged route(s)');
    expect(output).toContain('/dashboard  first-load 569.3 kB → 630.5 kB  (+61.3 kB, +10.8%)');
    expect(output).toMatch(/\+ pkg:moment\/moment\.js\s+\+61\.3 kB first-load {2}\(added\)/);
    expect(output).toContain(
      'why: app/dashboard/page.tsx → components/DashboardClient.tsx ("use client") → components/DatePicker.tsx → moment/moment.js',
    );
    expect(output).not.toContain('/_not-found'); // unchanged routes are only counted
  });

  it('prints the full diff as JSON', () => {
    const { code, output } = run(['diff', BASE, PR, '--json']);
    expect(code).toBe(0);
    const diff = JSON.parse(output) as SnapshotDiff;
    expect(diff.summary.changed).toBe(1);
    expect(diff.routes[0]?.modules[0]?.key).toBe('pkg:moment/moment.js');
  });

  it('limits listed modules with --top', () => {
    const { output } = run(['diff', BASE, PR, '--top', '1']);
    expect(output).toContain('… 2 more changed module(s)');
    expect(output).not.toContain('~ app:components/DatePicker.tsx');
  });

  it('reads plain .jsonl too', () => {
    const page = { path: '[project]/app/page.tsx', size: 1_000 };
    const b = writeTmp('b.jsonl', fakeExportText('b', { '/': [page] }));
    const p = writeTmp('p.jsonl', fakeExportText('p', { '/': [page, { path: '[project]/app/x.ts', size: 2_500, lazy: true }] }));
    const { code, output } = run(['diff', b, p]);
    expect(code).toBe(0);
    expect(output).toContain('lazy 0 B → 2.5 kB  (+2.5 kB)');
    expect(output).toContain('+ app:app/x.ts  +2.5 kB lazy  (added)');
  });

  it('fails clearly on bad input', () => {
    expect(run(['diff', BASE])).toMatchObject({ code: 1, output: expect.stringContaining('Expected 2 export files, got 1') });
    expect(run(['diff', BASE, path.join(tmp, 'missing.jsonl')])).toMatchObject({ code: 1, output: expect.stringContaining('ENOENT') });
    expect(run(['diff', BASE, PR, '--top', 'abc'])).toMatchObject({ code: 1, output: expect.stringContaining('--top must be') });
    expect(run(['diff', BASE, PR, '--top', '-3']).code).toBe(1); // rejected by node:util parseArgs
    expect(run(['diff', BASE, PR, '--bogus']).code).toBe(1);
    const truncated = writeTmp('t.jsonl', '{"type":"meta","schema_version":1,"snapshot_name":"t","module_index_hash":"h","route_count":1}\n{"type":"mod');
    expect(run(['diff', BASE, truncated])).toMatchObject({ code: 1, output: expect.stringMatching(/t\.jsonl: line 2: invalid JSON/) });
  });

  it('prints the PR comment with --format markdown', () => {
    const { code, output } = run(['diff', BASE, PR, '--format', 'markdown']);
    expect(code).toBe(0);
    expect(output.startsWith('<!-- bundle-mop:comment -->\n## Bundle Mop')).toBe(true);
    expect(output).toContain('### Suggestions');
  });

  it('applies --min-bytes to the report and the rules', () => {
    const loud = run(['diff', BASE, PR, '--format', 'markdown', '--min-bytes', '10']).output;
    expect(loud).toContain('| `components/DashboardClient.tsx` | -29 B |');
    const quiet = run(['diff', BASE, PR, '--format', 'markdown', '--min-bytes', '100000']).output;
    expect(quiet).toContain("✅ No route's JS changed by 100.0 kB or more.");
    expect(quiet).not.toContain('### Suggestions');
  });

  it('validates --format', () => {
    expect(run(['diff', BASE, PR, '--format', 'html'])).toMatchObject({ code: 1, output: expect.stringContaining('--format must be one of text, markdown, json') });
    expect(run(['diff', BASE, PR, '--json', '--format', 'markdown'])).toMatchObject({ code: 1, output: expect.stringContaining('--json conflicts with --format') });
    expect(JSON.parse(run(['diff', BASE, PR, '--format', 'json']).output).findings).toHaveLength(3);
  });

  it('applies a budgets file and exits 1 when a budget is exceeded', () => {
    const cfg = writeTmp('budgets.json', JSON.stringify({ budgets: [{ route: '/dashboard', firstLoad: '600 kB' }] }));
    const r = run(['diff', BASE, PR, '--config', cfg]);
    expect(r.code).toBe(1);
    expect(r.output).toContain('Budgets:\n  x /dashboard  first-load JS 630.5 kB / 600.0 kB  (over by 30.6 kB)');
    expect(run(['diff', BASE, PR, '--config', cfg, '--fail-on', 'none']).code).toBe(0);
    const json = JSON.parse(run(['diff', BASE, PR, '--config', cfg, '--format', 'json']).output);
    expect(json.budgets[0]).toMatchObject({ route: '/dashboard', status: 'over' });
    expect(json.findings[0]).toMatchObject({ ruleId: 'budget', severity: 'error' });
  });

  it('passes with a budget that holds, and without any budgets file', () => {
    const cfg = writeTmp('roomy.json', JSON.stringify({ budgets: [{ route: '/**', firstLoad: '1 MB' }] }));
    expect(run(['diff', BASE, PR, '--config', cfg]).code).toBe(0);
    expect(run(['diff', BASE, PR]).code).toBe(0); // rules only produce warnings/info
    expect(run(['diff', BASE, PR, '--fail-on', 'warning']).code).toBe(1);
  });

  it('finds bundle-mop.config.json in the working directory', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'cwd-'));
    fs.writeFileSync(path.join(dir, 'bundle-mop.config.json'), JSON.stringify({ budgets: [{ route: '/dashboard', firstLoad: '600 kB' }] }));
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      const r = run(['diff', BASE, PR]);
      expect(r.code).toBe(1);
      expect(r.output).toContain('raise the "/dashboard" budget in bundle-mop.config.json');
    } finally {
      process.chdir(cwd);
    }
  });

  it('reports config errors clearly', () => {
    const bad = writeTmp('bad.json', '{"budgets":[{"route":"/","firstLoad":"lots"}]}');
    expect(run(['diff', BASE, PR, '--config', bad])).toMatchObject({ code: 1, output: expect.stringContaining('budgets[0].firstLoad: invalid size "lots"') });
    expect(run(['diff', BASE, PR, '--fail-on', 'sometimes'])).toMatchObject({ code: 1, output: expect.stringContaining('--fail-on must be one of') });
  });

  it('shows usage with --help', () => {
    expect(run(['diff', '--help'])).toMatchObject({ code: 0, output: expect.stringContaining('Usage: bundle-mop diff') });
  });
});

describe('byte formatting', () => {
  it('formats bytes like Next.js (1 kB = 1000 B)', () => {
    expect(formatBytes(64)).toBe('64 B');
    expect(formatBytes(61_346)).toBe('61.3 kB');
    expect(formatBytes(-1_500)).toBe('-1.5 kB');
    expect(formatDelta(61_346)).toBe('+61.3 kB');
    expect(formatDelta(-29)).toBe('-29 B');
    expect(formatDelta(0)).toBe('±0 B');
  });
});
