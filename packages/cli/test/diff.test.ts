import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../src/model/diff.js';
import type { RouteDiff, SnapshotDiff } from '../src/model/diff.js';
import { fakeSnapshot, pnpm } from './helpers/fake-export.js';
import { loadSnapshot } from './helpers/fixtures.js';

const routeOf = (d: SnapshotDiff, r: string): RouteDiff => {
  const found = d.routes.find((x) => x.route === r);
  if (!found) throw new Error(`route ${r} missing from diff`);
  return found;
};

describe('diff: fixtures basic-before -> basic (moment added to /dashboard)', () => {
  const d = diffSnapshots(loadSnapshot('basic-before'), loadSnapshot('basic'));
  const dash = routeOf(d, '/dashboard');

  it('only /dashboard changed', () => {
    expect(d.summary).toEqual({ changed: 1, added: 0, removed: 0, unchanged: 3 });
    expect(d.routes[0]?.route).toBe('/dashboard');
    expect(d.warnings).toEqual([]);
  });

  it('reports the first-load regression', () => {
    expect(dash.firstLoad.raw).toEqual({ base: 569_297, pr: 630_550, delta: 61_253 });
    expect(dash.lazy.raw.delta).toBe(0);
    expect(dash.client.raw).toEqual(dash.firstLoad.raw);
  });

  it('blames moment first, then the small app-code changes', () => {
    expect(dash.modules.map((m) => [m.key, m.status, m.firstLoad.delta])).toEqual([
      ['pkg:moment/moment.js', 'added', 61_346],
      ['app:components/DatePicker.tsx', 'changed', -64],
      ['app:components/DashboardClient.tsx', 'changed', -29],
    ]);
    expect(dash.modules.reduce((a, m) => a + m.firstLoad.delta, 0)).toBe(dash.firstLoad.raw.delta);
  });

  it('rolls up by package', () => {
    expect(dash.packages).toHaveLength(1);
    expect(dash.packages[0]).toMatchObject({ key: 'pkg:moment', status: 'added', packageName: 'moment', firstLoad: { delta: 61_346 } });
  });

  it('reports no module changes on untouched routes', () => {
    for (const r of ['/', '/_not-found', '/_global-error']) {
      expect(routeOf(d, r)).toMatchObject({ status: 'unchanged', modules: [], packages: [] });
    }
    expect(routeOf(d, '/_not-found').isInternal).toBe(true);
  });
});

describe('diff: identical snapshots', () => {
  it.each(['basic', 'dynamic-barrel'])('%s vs itself is all unchanged', (fixture) => {
    const snap = loadSnapshot(fixture);
    const d = diffSnapshots(snap, snap);
    expect(d.summary.changed + d.summary.added + d.summary.removed).toBe(0);
    expect(d.routes.every((r) => r.modules.length === 0 && r.firstLoad.raw.delta === 0)).toBe(true);
  });
});

describe('diff: edge cases (synthetic exports)', () => {
  const page = { path: '[project]/app/page.tsx', size: 1_000 };

  it('detects added and removed routes', () => {
    const d = diffSnapshots(
      fakeSnapshot('base', { '/': [page], '/old': [{ path: '[project]/app/old/page.tsx', size: 300 }] }),
      fakeSnapshot('pr', { '/': [page], '/new': [{ path: '[project]/app/new/page.tsx', size: 700 }] }),
    );
    expect(d.summary).toEqual({ changed: 0, added: 1, removed: 1, unchanged: 1 });
    expect(routeOf(d, '/new')).toMatchObject({ status: 'added', firstLoad: { raw: { base: 0, pr: 700, delta: 700 } } });
    expect(routeOf(d, '/old')).toMatchObject({ status: 'removed', firstLoad: { raw: { base: 300, pr: 0, delta: -300 } } });
    expect(d.routes.map((r) => r.status)).toEqual(['added', 'removed', 'unchanged']);
  });

  it('treats a package version bump as a change to the same module, not add+remove', () => {
    const d = diffSnapshots(
      fakeSnapshot('base', { '/': [page, { path: pnpm('lodash', '4.17.20', 'lodash.js'), size: 70_000 }] }),
      fakeSnapshot('pr', { '/': [page, { path: pnpm('lodash', '4.17.21', 'lodash.js'), size: 71_000 }] }),
    );
    const [mod] = routeOf(d, '/').modules;
    expect(mod).toMatchObject({
      key: 'pkg:lodash/lodash.js',
      status: 'changed',
      firstLoad: { delta: 1_000 },
      versions: { base: ['4.17.20'], pr: ['4.17.21'] },
    });
    expect(routeOf(d, '/').packages[0]).toMatchObject({ key: 'pkg:lodash', versions: { base: ['4.17.20'], pr: ['4.17.21'] } });
  });

  it('flags a same-size version bump as changed', () => {
    const d = diffSnapshots(
      fakeSnapshot('base', { '/': [{ path: pnpm('@scope/x', '1.0.0', 'i.js'), size: 10, compressed: 5 }] }),
      fakeSnapshot('pr', { '/': [{ path: pnpm('@scope/x', '1.0.1', 'i.js'), size: 10, compressed: 5 }] }),
    );
    expect(routeOf(d, '/')).toMatchObject({ status: 'changed', modules: [{ key: 'pkg:@scope/x/i.js', firstLoad: { delta: 0 } }] });
  });

  it('shows two versions of one package in the same route', () => {
    const d = diffSnapshots(
      fakeSnapshot('base', { '/': [{ path: pnpm('react-is', '18.3.1', 'index.js'), size: 2_000 }] }),
      fakeSnapshot('pr', {
        '/': [
          { path: pnpm('react-is', '18.3.1', 'index.js'), size: 2_000 },
          { path: pnpm('react-is', '19.0.0', 'index.js'), size: 2_100 },
        ],
      }),
    );
    expect(routeOf(d, '/').packages[0]).toMatchObject({ key: 'pkg:react-is', firstLoad: { delta: 2_100 }, versions: { base: ['18.3.1'], pr: ['18.3.1', '19.0.0'] } });
  });

  it('detects a module moved from first-load to lazy (next/dynamic fix)', () => {
    const moment = pnpm('moment', '2.31.0', 'moment.js');
    const d = diffSnapshots(
      fakeSnapshot('base', { '/x': [page, { path: moment, size: 61_000 }] }),
      fakeSnapshot('pr', { '/x': [page, { path: moment, size: 61_000, lazy: true }] }),
    );
    const r = routeOf(d, '/x');
    expect(r.firstLoad.raw.delta).toBe(-61_000);
    expect(r.lazy.raw.delta).toBe(61_000);
    expect(r.client.raw.delta).toBe(0);
    expect(r.status).toBe('changed');
    expect(r.modules[0]).toMatchObject({ key: 'pkg:moment/moment.js', status: 'changed', movedTo: 'lazy' });
  });

  it('detects the reverse move (lazy -> first-load)', () => {
    const p = { path: '[project]/components/Chart.tsx', size: 5_000 };
    const d = diffSnapshots(fakeSnapshot('b', { '/': [{ ...p, lazy: true }] }), fakeSnapshot('p', { '/': [p] }));
    expect(routeOf(d, '/').modules[0]?.movedTo).toBe('firstLoad');
  });

  it('ignores chunk filename churn when content is the same', () => {
    const d = diffSnapshots(
      fakeSnapshot('base', { '/': [{ ...page, file: '[client-fs]/_next/static/chunks/aaa.js' }] }),
      fakeSnapshot('pr', { '/': [{ ...page, file: '[client-fs]/_next/static/chunks/bbb.js' }] }),
    );
    expect(routeOf(d, '/')).toMatchObject({ status: 'unchanged', modules: [] });
  });

  it('ignores server-side parts', () => {
    const d = diffSnapshots(
      fakeSnapshot('base', { '/': [page, { path: '[project]/lib/db.ts', size: 10, server: true }] }),
      fakeSnapshot('pr', { '/': [page, { path: '[project]/lib/db.ts', size: 90_000, server: true }] }),
    );
    expect(routeOf(d, '/')).toMatchObject({ status: 'unchanged', modules: [] });
  });

  it('marks compressed-only changes as changed', () => {
    const d = diffSnapshots(
      fakeSnapshot('base', { '/': [{ ...page, compressed: 400 }] }),
      fakeSnapshot('pr', { '/': [{ ...page, compressed: 420 }] }),
    );
    expect(routeOf(d, '/')).toMatchObject({ status: 'changed', modules: [{ compressed: { delta: 20 } }] });
  });

  it('sorts changed routes and modules by first-load impact', () => {
    const d = diffSnapshots(
      fakeSnapshot('base', {
        '/a': [page],
        '/b': [page],
        '/c': [page],
      }),
      fakeSnapshot('pr', {
        '/a': [page, { path: '[project]/a1.ts', size: 100 }],
        '/b': [page, { path: '[project]/b1.ts', size: 50 }, { path: '[project]/b2.ts', size: 9_000 }],
        '/c': [{ ...page, size: 0 }],
      }),
    );
    expect(d.routes.map((r) => r.route)).toEqual(['/b', '/c', '/a']);
    expect(routeOf(d, '/b').modules.map((m) => m.key)).toEqual(['app:b2.ts', 'app:b1.ts']);
  });

  it('prefixes adapter warnings with their side', () => {
    const base = fakeSnapshot('base', { '/': [page] });
    const pr = fakeSnapshot('pr', { '/': [page] });
    pr.warnings.push('something odd');
    expect(diffSnapshots(base, pr).warnings).toEqual(['pr: something odd']);
  });
});
