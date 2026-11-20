import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBudgets, ConfigError, findConfig, loadConfig, matchesRoute, parseConfig, parseSize } from '../src/budgets/index.js';
import type { BudgetConfig } from '../src/budgets/index.js';
import { diffSnapshots } from '../src/model/diff.js';
import { analyze } from '../src/pipeline.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { renderTextDiff } from '../src/report/text.js';
import { fakeSnapshot } from './helpers/fake-export.js';
import type { FakePart } from './helpers/fake-export.js';
import { loadSnapshot } from './helpers/fixtures.js';

const config = (budgets: object[]): BudgetConfig => parseConfig(JSON.stringify({ budgets }));

describe('parseSize', () => {
  it.each([
    ['150 kB', 150_000],
    ['150kB', 150_000],
    ['146.5 KiB', 150_016],
    ['2 MB', 2_000_000],
    ['1 MiB', 1_048_576],
    ['900 B', 900],
    ['900', 900],
    [123_456, 123_456],
  ])('%s -> %d', (input, bytes) => {
    expect(parseSize(input)).toBe(bytes);
  });

  it.each(['', 'big', '-5 kB', '5 GB', null, -1])('rejects %s', (input) => {
    expect(() => parseSize(input)).toThrow(/invalid size/);
  });
});

describe('route patterns', () => {
  it.each([
    ['/', '/', true],
    ['/', '/about', false],
    ['/dashboard', '/dashboard', true],
    ['/dashboard', '/dashboard/settings', false],
    ['/dashboard/*', '/dashboard/settings', true],
    ['/dashboard/*', '/dashboard/a/b', false],
    ['/dashboard/**', '/dashboard', true],
    ['/dashboard/**', '/dashboard/a/b', true],
    ['/blog/*', '/blog/[slug]', true],
    ['/blog/[slug]', '/blog/[slug]', true],
    ['/docs-*', '/docs-v2', true],
    ['/**', '/', true],
    ['**', '/anything/here', true],
    ['/a.b', '/aXb', false],
  ])('%s matches %s: %s', (pattern, route, expected) => {
    expect(matchesRoute(pattern, route)).toBe(expected);
  });
});

describe('parseConfig', () => {
  it('parses sizes and keeps order', () => {
    expect(config([{ route: '/', firstLoad: '150 kB' }, { route: '/**', firstLoad: 300_000, lazy: '1 MB' }]).budgets).toEqual([
      { route: '/', firstLoad: 150_000 },
      { route: '/**', firstLoad: 300_000, lazy: 1_000_000 },
    ]);
  });

  it('allows $schema and an empty budgets list', () => {
    expect(parseConfig('{"$schema":"x"}').budgets).toEqual([]);
  });

  it.each([
    ['not json', /invalid JSON/],
    ['[]', /must be a JSON object/],
    ['{"budget": []}', /unknown key "budget"/],
    ['{"budgets": {}}', /"budgets" must be an array/],
    ['{"budgets": [{"route": "dashboard", "firstLoad": 1}]}', /budgets\[0\]\.route must be a route pattern/],
    ['{"budgets": [{"route": "/", "firstload": 1}]}', /budgets\[0\]: unknown key "firstload"/],
    ['{"budgets": [{"route": "/"}]}', /budgets\[0\] sets no limit/],
    ['{"budgets": [{"route": "/", "firstLoad": "lots"}]}', /budgets\[0\]\.firstLoad: invalid size/],
  ])('rejects %s', (text, error) => {
    expect(() => parseConfig(text, 'cfg.json')).toThrow(error);
    expect(() => parseConfig(text, 'cfg.json')).toThrow(ConfigError);
  });

  it('finds and loads the config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-cfg-'));
    const app = path.join(dir, 'app');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(dir, 'bundle-mop.config.json'), '{"budgets":[{"route":"/","firstLoad":"1 kB"}]}');
    expect(findConfig([app, dir])).toBe(path.join(dir, 'bundle-mop.config.json'));
    expect(findConfig([app])).toBeUndefined();
    expect(loadConfig(path.join(dir, 'bundle-mop.config.json'))).toMatchObject({ budgets: [{ route: '/', firstLoad: 1000 }] });
    expect(() => loadConfig(path.join(dir, 'missing.json'))).toThrow(/cannot read config: ENOENT/);
  });
});

describe('checkBudgets on basic-before -> basic (/dashboard +61.3 kB)', () => {
  const diff = diffSnapshots(loadSnapshot('basic-before'), loadSnapshot('basic'));

  it('flags a newly exceeded budget as an error with the culprit and its chain', () => {
    const { results, findings } = checkBudgets(diff, config([{ route: '/dashboard', firstLoad: '600 kB' }]));
    expect(results).toEqual([
      { route: '/dashboard', pattern: '/dashboard', metric: 'firstLoad', limit: 600_000, base: 569_297, pr: 630_550, isNew: false, status: 'over' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'budget',
      severity: 'error',
      title: '/dashboard first-load JS is 630.5 kB, 30.6 kB over its 600.0 kB budget',
      message: 'It was 569.3 kB on the base branch (+61.3 kB). Biggest increase: moment (+61.3 kB).',
      bytes: 30_550,
      routes: ['/dashboard'],
    });
    expect(findings[0]?.chain?.importer).toBe('app:components/DatePicker.tsx');
  });

  it('first matching entry wins, and wildcards skip Next-internal routes', () => {
    const { results } = checkBudgets(diff, config([{ route: '/dashboard', firstLoad: '700 kB' }, { route: '/**', firstLoad: '1 kB' }]));
    expect(results.map((r) => [r.route, r.pattern, r.status])).toEqual([
      ['/', '/**', 'still-over'],
      ['/dashboard', '/dashboard', 'ok'],
    ]);
  });

  it('a budget already blown on base that did not grow is only a warning', () => {
    const { findings } = checkBudgets(diff, config([{ route: '/', firstLoad: '500 kB' }]));
    expect(findings[0]).toMatchObject({ severity: 'warning', message: "It was already 576.4 kB on the base branch; this PR didn't make it worse." });
  });

  it('growing while already over is an error; growth under minBytes is not', () => {
    const over = checkBudgets(diff, config([{ route: '/dashboard', firstLoad: '500 kB' }]));
    expect(over.findings[0]).toMatchObject({ severity: 'error', message: expect.stringContaining('It was already over budget (569.3 kB) and grew by +61.3 kB.') });
    const noisy = checkBudgets(diff, config([{ route: '/dashboard', firstLoad: '500 kB' }]), { minBytes: 100_000 });
    expect(noisy.results[0]?.status).toBe('still-over');
  });

  it('reports fixed budgets (reverse diff)', () => {
    const reverse = diffSnapshots(loadSnapshot('basic'), loadSnapshot('basic-before'));
    const { results, findings } = checkBudgets(reverse, config([{ route: '/dashboard', firstLoad: '600 kB' }]));
    expect(results[0]?.status).toBe('fixed');
    expect(findings).toEqual([]);
  });
});

describe('checkBudgets edge cases (synthetic)', () => {
  const page: FakePart = { path: '[project]/app/page.tsx', size: 5_000 };

  it('a new route over budget is an error marked as new', () => {
    const d = diffSnapshots(fakeSnapshot('b', { '/': [page] }), fakeSnapshot('p', { '/': [page], '/new': [{ path: '[project]/app/new/page.tsx', size: 9_000 }] }));
    const { results, findings } = checkBudgets(d, config([{ route: '/new', firstLoad: '8 kB' }]));
    expect(results[0]).toMatchObject({ isNew: true, status: 'over' });
    expect(findings[0]?.message).toBe('This route is new in this PR. Biggest increase: app/new/page.tsx (+9.0 kB).');
  });

  it('checks lazy and total client budgets', () => {
    const d = diffSnapshots(
      fakeSnapshot('b', { '/': [page] }),
      fakeSnapshot('p', { '/': [page, { path: '[project]/components/Chart.tsx', size: 40_000, lazy: true }] }),
    );
    const { results } = checkBudgets(d, config([{ route: '/', firstLoad: '10 kB', lazy: '30 kB', client: '50 kB' }]));
    expect(results.map((r) => [r.metric, r.pr, r.status])).toEqual([
      ['lazy', 40_000, 'over'],
      ['firstLoad', 5_000, 'ok'],
      ['client', 45_000, 'ok'],
    ]);
  });

  it('ignores removed routes and unmatched routes', () => {
    const d = diffSnapshots(fakeSnapshot('b', { '/': [page], '/old': [page] }), fakeSnapshot('p', { '/': [page] }));
    expect(checkBudgets(d, config([{ route: '/old', firstLoad: '1 kB' }])).results).toEqual([]);
  });
});

describe('JSON schema', () => {
  const schema = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../../schema/bundle-mop.config.schema.json'), 'utf8'));
  const item = schema.properties.budgets.items;

  it('lists exactly the keys the parser accepts', () => {
    expect(Object.keys(schema.properties).sort()).toEqual(['$schema', 'budgets']);
    expect(Object.keys(item.properties).sort()).toEqual(['client', 'firstLoad', 'lazy', 'route']);
  });

  it('size pattern agrees with parseSize', () => {
    const re = new RegExp(schema.$defs.size.oneOf[1].pattern);
    for (const ok of ['150 kB', '150kB', '146.5 KiB', '2 MB', '1 MiB', '900 B', '900']) {
      expect(re.test(ok), ok).toBe(true);
      expect(() => parseSize(ok)).not.toThrow();
    }
    for (const bad of ['big', '5 GB', '-5 kB']) {
      expect(re.test(bad), bad).toBe(false);
      expect(() => parseSize(bad)).toThrow();
    }
  });
});

describe('budgets in the pipeline and reports', () => {
  const base = loadSnapshot('basic-before');
  const pr = loadSnapshot('basic');
  const cfg = { ...config([{ route: '/dashboard', firstLoad: '600 kB' }, { route: '/**', firstLoad: '580 kB' }]), source: 'bundle-mop.config.json' };
  const a = analyze(base, pr, { config: cfg });

  it('puts budget errors before rule findings', () => {
    expect(a.findings.map((f) => f.ruleId)).toEqual(['budget', 'heavy-package', 'lazy-load-candidate', 'server-candidate']);
  });

  it('markdown: headline, budgets table, explanation; budget findings not repeated in Suggestions', () => {
    const md = renderMarkdown(a.diff, { findings: a.findings, budgets: a.budgets });
    expect(md.split('\n')[3]).toBe('❌ **1 budget exceeded**');
    expect(md).toContain('| `/dashboard` | first-load JS | 630.5 kB | 600.0 kB | ❌ over by 30.6 kB |');
    expect(md).toContain('| `/` | first-load JS | 576.4 kB | 580.0 kB | ✅ 99% used |');
    expect(md).toContain('raise the "/dashboard" budget in bundle-mop.config.json');
    const suggestions = md.slice(md.indexOf('### Suggestions'));
    expect(suggestions).not.toContain('budget');
    expect(md).toMatch(/3 suggestions/);
  });

  it('a 1 MB budget prints as MB, not "1000.0 kB"', () => {
    const big = analyze(base, pr, { config: config([{ route: '/dashboard', firstLoad: '1 MB' }]) });
    const md = renderMarkdown(big.diff, { findings: big.findings, budgets: big.budgets });
    expect(md).toContain('| `/dashboard` | first-load JS | 630.5 kB | 1.00 MB | ✅ 63% used |');
    expect(md).not.toContain('1000.0 kB');
  });

  it('text report lists budgets', () => {
    const text = renderTextDiff(a.diff, { findings: a.findings, budgets: a.budgets });
    expect(text).toContain('  x /dashboard  first-load JS 630.5 kB / 600.0 kB  (over by 30.6 kB)');
    expect(text).toContain('  ✓ /  first-load JS 576.4 kB / 580.0 kB  (99% used)');
  });

  it('without a config nothing changes (golden comment stays the same)', () => {
    const plain = analyze(base, pr);
    expect(plain.budgets).toEqual([]);
    expect(renderMarkdown(plain.diff, { findings: plain.findings, budgets: plain.budgets })).not.toContain('### Budgets');
  });
});
