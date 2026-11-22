import { describe, expect, it } from 'vitest';
import type { AnalyzeSnapshot } from '../src/adapter/index.js';
import { diffSnapshots } from '../src/model/diff.js';
import { isOptimizedByNext, runRules } from '../src/rules/index.js';
import type { RunRulesOptions } from '../src/rules/index.js';
import { fakeSnapshot, ident, pnpm } from './helpers/fake-export.js';
import type { FakeGraph, FakePart } from './helpers/fake-export.js';
import { loadSnapshot } from './helpers/fixtures.js';

const findingsFor = (base: AnalyzeSnapshot, pr: AnalyzeSnapshot, opts?: RunRulesOptions) => runRules(diffSnapshots(base, pr), base, pr, opts);
const ids = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId);

describe('rules: fixtures basic-before -> basic (moment added via DatePicker)', () => {
  const findings = findingsFor(loadSnapshot('basic-before'), loadSnapshot('basic'));

  it('suggests a swap, lazy loading and server rendering, worst first', () => {
    expect(ids(findings)).toEqual(['heavy-package', 'lazy-load-candidate', 'server-candidate']);
    expect(findings.every((f) => f.routes.join() === '/dashboard' && f.bytes === 61_346 && f.packageName === 'moment')).toBe(true);
  });

  it('heavy-package names the importer and the alternatives', () => {
    const f = findings[0];
    expect(f).toMatchObject({ severity: 'warning', title: 'moment adds 61.3 kB to first-load JS', subject: 'pkg:moment' });
    expect(f?.message).toContain('Imported by components/DatePicker.tsx.');
    expect(f?.suggestion).toMatch(/dayjs.*date-fns.*Intl\.DateTimeFormat/);
    expect(f?.chain?.importer).toBe('app:components/DatePicker.tsx');
  });

  it('lazy-load-candidate writes a next/dynamic snippet for the parent file', () => {
    const f = findings[1];
    expect(f?.title).toBe('Lazy-load components/DatePicker.tsx to keep moment out of first-load JS');
    expect(f?.suggestion).toContain("// components/DashboardClient.tsx\nimport dynamic from 'next/dynamic';\nconst DatePicker = dynamic(() => import('./DatePicker'));");
    expect(f?.docs).toBe('https://nextjs.org/docs/app/guides/lazy-loading');
  });

  it('server-candidate points at the "use client" boundary', () => {
    expect(findings[2]?.title).toBe('moment runs in the browser because of "use client" in components/DashboardClient.tsx');
  });
});

describe('rules: severity contract', () => {
  it('no built-in rule can emit an error (fail-on defaults to error; only budgets may fail a PR)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/rules/rules.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/severity:\s*'error'/);
  });
});

describe('rules: no false positives on real fixtures', () => {
  it('removing moment (reverse diff) produces no findings', () => {
    expect(findingsFor(loadSnapshot('basic'), loadSnapshot('basic-before'))).toEqual([]);
  });

  it('identical snapshots produce no findings', () => {
    const s = loadSnapshot('dynamic-barrel');
    expect(findingsFor(s, s)).toEqual([]);
  });

  it('an added route with only lazy moment and framework code produces no findings', () => {
    // /lazy is new: every package on it is "added", including next/react (framework, ignored)
    // and moment (lazy-only, so not first-load).
    expect(findingsFor(loadSnapshot('basic-before'), loadSnapshot('dynamic-barrel'))).toEqual([]);
  });
});

// --- synthetic -------------------------------------------------------------------

const page = ident('[project]/app/page.tsx', 'app-rsc', 'ecmascript, Next.js Server Component');
const compRsc = ident('[project]/components/Widget.tsx', 'app-rsc');
const compProxy = ident('[project]/components/Widget.tsx', 'app-rsc', 'client reference proxy');
const compClient = ident('[project]/components/Widget.tsx');

/** page → Widget ("use client") → each target module (sync or async). */
function widgetGraph(targets: string[], opts: { async?: boolean } = {}): FakeGraph {
  return {
    modules: [
      { ident: page, sync: [compRsc] },
      { ident: compRsc, sync: [compProxy] },
      { ident: compProxy, sync: [compClient] },
      { ident: compClient, ...(opts.async ? { async: targets } : { sync: targets }) },
      ...targets.map((t) => ({ ident: t })),
    ],
    entries: { '/': [page] },
  };
}

const basePart: FakePart = { path: '[project]/components/Widget.tsx', size: 2_000 };
const snap = (name: string, parts: FakePart[], graph?: FakeGraph) => fakeSnapshot(name, { '/': parts }, graph);

describe('rules: synthetic cases', () => {
  it('lodash: flags only the full build, not per-method modules', () => {
    const full = pnpm('lodash', '4.17.21', 'lodash.js');
    const debounce = pnpm('lodash', '4.17.21', 'debounce.js');
    const withFull = findingsFor(snap('b', [basePart]), snap('p', [basePart, { path: full, size: 70_000 }], widgetGraph([ident(full)])));
    expect(ids(withFull)).toContain('heavy-package');
    const perMethod = findingsFor(snap('b', [basePart]), snap('p', [basePart, { path: debounce, size: 5_000 }], widgetGraph([ident(debounce)])));
    expect(ids(perMethod)).not.toContain('heavy-package');
  });

  it('ignores growth below minBytes (minifier noise)', () => {
    const m = pnpm('moment', '2.31.0', 'moment.js');
    const tiny = findingsFor(snap('b', [basePart, { path: m, size: 60_000 }]), snap('p', [basePart, { path: m, size: 60_500 }]));
    expect(tiny).toEqual([]);
    const withLowThreshold = findingsFor(snap('b', [basePart, { path: m, size: 60_000 }]), snap('p', [basePart, { path: m, size: 60_500 }]), { minBytes: 100 });
    expect(withLowThreshold[0]).toMatchObject({ ruleId: 'heavy-package', title: 'moment grows first-load JS by 500 B' });
  });

  it('never flags anything below minBytes, even rules with their own threshold', () => {
    const f = findingsFor(loadSnapshot('basic-before'), loadSnapshot('basic'), { minBytes: 100_000 });
    expect(f).toEqual([]);
  });

  it('server-candidate does not repeat the file name when the importer is the "use client" file', () => {
    // The demo PR shape: page → LastUpdated ("use client") → moment, so importer === boundary.
    const m = pnpm('moment', '2.31.0', 'moment.js');
    const f = findingsFor(snap('b', [basePart]), snap('p', [basePart, { path: m, size: 61_000 }], widgetGraph([ident(m)])));
    const sc = f.find((x) => x.ruleId === 'server-candidate');
    expect(sc?.message).toBe(
      'moment reaches the browser through the "use client" boundary in components/Widget.tsx. Server Component code isn\'t sent to the browser.',
    );
    // The fixture pair (importer DatePicker ≠ boundary DashboardClient) still names the importer.
    const fixture = findingsFor(loadSnapshot('basic-before'), loadSnapshot('basic')).find((x) => x.ruleId === 'server-candidate');
    expect(fixture?.message).toContain('Imported by components/DatePicker.tsx.');
  });

  it('does not suggest lazy loading or server rendering for code already behind a dynamic import', () => {
    const m = pnpm('moment', '2.31.0', 'moment.js');
    const f = findingsFor(snap('b', [basePart]), snap('p', [basePart, { path: m, size: 61_000, lazy: true }], widgetGraph([ident(m)], { async: true })));
    expect(f).toEqual([]); // lazy-only growth: nothing on first-load to fix
  });

  it('duplicate-package: flags a newly duplicated package with per-version sizes', () => {
    const v18 = pnpm('react-is', '18.3.1', 'index.js');
    const v19 = pnpm('react-is', '19.0.0', 'index.js');
    const f = findingsFor(snap('b', [basePart, { path: v18, size: 2_000 }]), snap('p', [basePart, { path: v18, size: 2_000 }, { path: v19, size: 2_100 }]));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      ruleId: 'duplicate-package',
      title: 'react-is ships in 2 versions: 18.3.1, 19.0.0',
      message: 'Browser JS on this route includes react-is 18.3.1 (2.0 kB) and 19.0.0 (2.1 kB).',
      bytes: 2_000,
    });
    expect(f[0]?.suggestion).toContain('pnpm why react-is');
  });

  it('duplicate-package: stays quiet when the duplicate already existed in base', () => {
    const parts = [basePart, { path: pnpm('react-is', '18.3.1', 'index.js'), size: 2_000 }, { path: pnpm('react-is', '19.0.0', 'index.js'), size: 2_100 }];
    expect(findingsFor(snap('b', [...parts]), snap('p', [...parts, { path: '[project]/app/new.ts', size: 5_000 }]))).toEqual([]);
  });

  it('lost-lazy-loading: flags code that moved from lazy to first-load', () => {
    const chart = { path: '[project]/components/Chart.tsx', size: 40_000 };
    const f = findingsFor(snap('b', [basePart, { ...chart, lazy: true }]), snap('p', [basePart, chart]));
    expect(f[0]).toMatchObject({ ruleId: 'lost-lazy-loading', severity: 'warning', title: 'components/Chart.tsx moved from lazy to first-load JS (+40.0 kB)' });
  });

  it('optimize-package-imports: flags many modules from a package Next does not optimize, pulled in by a barrel', () => {
    const mods = Array.from({ length: 12 }, (_, i) => pnpm('some-icons', '1.0.0', `icons/i${i}.js`));
    const index = pnpm('some-icons', '1.0.0', 'index.js');
    // Widget → some-icons/index.js (barrel) → 12 icon modules
    const graph = widgetGraph([ident(index)]);
    graph.modules = graph.modules.map((m) => (m.ident === ident(index) ? { ...m, sync: mods.map((x) => ident(x)) } : m));
    graph.modules.push(...mods.map((x) => ({ ident: ident(x) })));
    const parts = [index, ...mods].map((path) => ({ path, size: 500 }));
    const f = findingsFor(snap('b', [basePart]), snap('p', [basePart, ...parts], graph));
    expect(f.find((x) => x.ruleId === 'optimize-package-imports')).toMatchObject({
      title: '13 modules of some-icons ship to the browser',
      suggestion: expect.stringContaining("optimizePackageImports: ['some-icons']"),
    });
  });

  it('optimize-package-imports: stays quiet when the app already imports by subpath (the Dify / @lexical/react case)', () => {
    // Widget imports each of the 12 modules directly (`some-icons/icons/i0`, …): no barrel to trim.
    const mods = Array.from({ length: 12 }, (_, i) => pnpm('some-icons', '1.0.0', `icons/i${i}.js`));
    const f = findingsFor(snap('b', [basePart]), snap('p', [basePart, ...mods.map((path) => ({ path, size: 500 }))], widgetGraph(mods.map((m) => ident(m)))));
    expect(ids(f)).not.toContain('optimize-package-imports');
  });

  it('optimize-package-imports: skips packages Next already optimizes', () => {
    const mods = Array.from({ length: 12 }, (_, i) => pnpm('lucide-react', '0.500.0', `dist/esm/icons/i${i}.js`));
    const f = findingsFor(snap('b', [basePart]), snap('p', [basePart, ...mods.map((path) => ({ path, size: 500 }))]));
    expect(ids(f)).not.toContain('optimize-package-imports');
    expect(isOptimizedByNext('react-icons')).toBe(true);
    expect(isOptimizedByNext('@effect/platform')).toBe(true);
    expect(isOptimizedByNext('some-icons')).toBe(false);
  });

  it('merges one finding across routes and skips internal routes', () => {
    const m = pnpm('jquery', '3.7.1', 'dist/jquery.js');
    const routes = ['/a', '/b', '/_not-found'];
    const base = fakeSnapshot('b', Object.fromEntries(routes.map((r) => [r, [basePart]])));
    const pr = fakeSnapshot('p', Object.fromEntries(routes.map((r, i) => [r, [basePart, { path: m, size: 80_000 + i }]])));
    const f = findingsFor(base, pr);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ ruleId: 'heavy-package', routes: ['/b', '/a'], bytes: 80_001 });
    expect(findingsFor(base, pr, { includeInternalRoutes: true })[0]?.routes).toContain('/_not-found');
  });

  it('ignores compiler drift during a Next.js upgrade, but still flags real changes (the shadcn/ui case)', () => {
    const icons = (n: number, size: number) => Array.from({ length: n }, (_, i) => ({ path: pnpm('some-icons', '1.0.0', `icons/i${i}.js`), size }));
    const next = (v: string) => ({ path: pnpm('next', v, 'dist/client/index.js'), size: 100_000 });
    // Same 12 modules, same version, ~2.4 kB bigger only because Next's compiler changed: no finding.
    const drift = findingsFor(snap('b', [basePart, next('16.4.2'), ...icons(12, 500)]), snap('p', [basePart, next('16.4.5'), ...icons(12, 700)]));
    expect(ids(drift)).not.toContain('optimize-package-imports');
    // The same upgrade plus a new import of the package (a 13th module) is a real change: flagged.
    const real = findingsFor(snap('b', [basePart, next('16.4.2'), ...icons(12, 500)]), snap('p', [basePart, next('16.4.5'), ...icons(13, 700)]));
    expect(ids(real)).toContain('optimize-package-imports');
    // Without a Next upgrade, the same growth is not treated as drift.
    const noUpgrade = findingsFor(snap('b', [basePart, next('16.4.5'), ...icons(12, 500)]), snap('p', [basePart, next('16.4.5'), ...icons(12, 700)]));
    expect(ids(noUpgrade)).toContain('optimize-package-imports');
  });

  it('accepts custom rules', () => {
    const f = runRules(diffSnapshots(snap('b', [basePart]), snap('p', [{ ...basePart, size: 9_000 }])), snap('b', []), snap('p', []), {
      rules: [{ id: 'custom', description: 'x', check: (ctx) => [{ ruleId: 'custom', severity: 'error', title: ctx.route.route, message: '', subject: 's', bytes: 1 }] }],
    });
    expect(f).toEqual([{ ruleId: 'custom', severity: 'error', title: '/', message: '', subject: 's', bytes: 1, routes: ['/'] }]);
  });
});
