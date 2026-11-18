import { describe, expect, it } from 'vitest';
import { formatChain, RouteGraph, shortKey } from '../src/model/chains.js';
import type { ImportChain } from '../src/model/chains.js';
import { diffSnapshots } from '../src/model/diff.js';
import { fakeSnapshot, ident, pnpm } from './helpers/fake-export.js';
import { loadSnapshot } from './helpers/fixtures.js';

const keys = (c: ImportChain | undefined) => c?.steps.map((s) => s.key);

describe('chains: fixtures/basic /dashboard', () => {
  const g = new RouteGraph(loadSnapshot('basic'), '/dashboard');
  const chain = g.chainToKey('pkg:moment/moment.js');

  it('traces page -> "use client" boundary -> DatePicker -> moment', () => {
    expect(keys(chain)).toEqual([
      'app:app/dashboard/page.tsx',
      'app:components/DashboardClient.tsx',
      'app:components/DatePicker.tsx',
      'pkg:moment/moment.js',
    ]);
    expect(chain).toMatchObject({
      route: '/dashboard',
      entryKind: 'server',
      viaDynamicImport: false,
      clientBoundary: 'app:components/DashboardClient.tsx',
      importer: 'app:components/DatePicker.tsx',
    });
  });

  it('merges per-layer nodes of one file into one step', () => {
    const [page, client, picker] = chain?.steps ?? [];
    expect(page).toMatchObject({ isServerComponent: true, layer: 'app-rsc' });
    expect(client).toMatchObject({ isClientBoundary: true, layer: 'app-client' });
    expect(client?.idents.length).toBe(3); // [app-rsc] ecmascript, client reference proxy, [app-client]
    expect(picker).toMatchObject({ isClientBoundary: false, layer: 'app-client' });
  });

  it('formats the chain on one line', () => {
    expect(formatChain(chain as ImportChain)).toBe(
      'app/dashboard/page.tsx → components/DashboardClient.tsx ("use client") → components/DatePicker.tsx → moment/moment.js',
    );
  });

  it('only covers this route\'s part of the graph', () => {
    expect(g.size).toBeGreaterThan(400);
    expect(g.size).toBeLessThan(loadSnapshot('basic').modules.size);
    expect(g.chainToKey('app:app/page.tsx')).toBeUndefined(); // the home page isn't reachable from /dashboard
  });

  it('starts framework chains at the client bootstrap entry', () => {
    expect(g.chainToKey('pkg:next/dist/client/app-next-turbopack.js')?.entryKind).toBe('client_bootstrap');
  });
});

describe('chains: fixtures/dynamic-barrel /lazy', () => {
  const g = new RouteGraph(loadSnapshot('dynamic-barrel'), '/lazy');

  it('marks the dynamic import hop for lazy moment', () => {
    const c = g.chainToKey('pkg:moment/moment.js');
    expect(keys(c)).toEqual([
      'app:app/lazy/page.tsx',
      'app:components/LazyClient.tsx',
      'app:components/ui/Heavy.tsx',
      'pkg:moment/moment.js',
    ]);
    expect(c?.steps[2]?.viaDynamicImport).toBe(true);
    expect(c).toMatchObject({ viaDynamicImport: true, importer: 'app:components/ui/Heavy.tsx' });
    expect(formatChain(c as ImportChain)).toContain('components/ui/Heavy.tsx (dynamic import)');
  });

  it('shows the barrel on the way to the tree-shaken re-export', () => {
    const c = g.chainToKey('app:components/ui/Unused.tsx');
    expect(keys(c)).toEqual(['app:app/lazy/page.tsx', 'app:components/LazyClient.tsx', 'app:components/ui/index.ts', 'app:components/ui/Unused.tsx']);
    expect(c?.steps[2]?.isBarrel).toBe(true);
    expect(c?.importer).toBeUndefined(); // not a package
  });

  it('chains a package to where it is first entered', () => {
    expect(keys(g.chainToPackage('moment'))?.at(-1)).toBe('pkg:moment/moment.js');
  });
});

describe('chains: synthetic graphs', () => {
  const page = ident('[project]/app/page.tsx', 'app-rsc');
  const a = ident('[project]/components/A.tsx');
  const b = ident('[project]/components/B.tsx');
  const libA = ident(pnpm('lib-a', '1.0.0', 'index.js'));
  const libB = ident(pnpm('lib-b', '2.0.0', 'index.js'));
  const libBInner = ident(pnpm('lib-b', '2.0.0', 'inner.js'));
  const ui = ident('[project]/packages/ui/src/index.ts');
  const parts = { '/': [{ path: '[project]/app/page.tsx', size: 1 }] };

  it('prefers a static path over an equally short dynamic one', () => {
    const snap = fakeSnapshot('s', parts, {
      modules: [{ ident: page, async: [b], sync: [a] }, { ident: a, sync: [b] }, { ident: b }],
      entries: { '/': [page] },
    });
    // page -async-> B is 1 hop, page -> A -> B is 2: BFS takes the shorter dynamic one.
    expect(new RouteGraph(snap, '/').chainToKey('app:components/B.tsx')?.viaDynamicImport).toBe(true);
    const snap2 = fakeSnapshot('s2', parts, {
      modules: [{ ident: page, sync: [b], async: [b] }, { ident: b }],
      entries: { '/': [page] },
    });
    expect(new RouteGraph(snap2, '/').chainToKey('app:components/B.tsx')?.viaDynamicImport).toBe(false);
  });

  it('names the last app/workspace file before a package entered via another package', () => {
    const snap = fakeSnapshot('s', parts, {
      modules: [{ ident: page, sync: [ui] }, { ident: ui, sync: [libA] }, { ident: libA, sync: [libB] }, { ident: libB, sync: [libBInner] }, { ident: libBInner }],
      entries: { '/': [page] },
    });
    const g = new RouteGraph(snap, '/');
    const c = g.chainToKey('pkg:lib-b/inner.js');
    expect(c?.steps.map((s) => shortKey(s.key))).toEqual(['app/page.tsx', 'packages/ui/src/index.ts', 'lib-a/index.js', 'lib-b/index.js', 'lib-b/inner.js']);
    // Standalone app (root layout at [project]/app), so packages/ui counts as app code here.
    expect(c?.importer).toBe('app:packages/ui/src/index.ts');
    expect(keys(g.chainToPackage('lib-b'))?.at(-1)).toBe('pkg:lib-b/index.js');
  });

  it('survives cycles and returns undefined for unreachable modules', () => {
    const snap = fakeSnapshot('s', parts, {
      modules: [{ ident: page, sync: [a] }, { ident: a, sync: [b] }, { ident: b, sync: [a] }, { ident: libA }],
      entries: { '/': [page] },
    });
    const g = new RouteGraph(snap, '/');
    expect(keys(g.chainToKey('app:components/B.tsx'))).toEqual(['app:app/page.tsx', 'app:components/A.tsx', 'app:components/B.tsx']);
    expect(g.chainToKey('pkg:lib-a/index.js')).toBeUndefined();
  });

  it('only targets browser-layer modules', () => {
    const ssr = ident('[project]/components/A.tsx', 'app-ssr');
    const snap = fakeSnapshot('s', parts, { modules: [{ ident: page, sync: [ssr] }, { ident: ssr }], entries: { '/': [page] } });
    expect(new RouteGraph(snap, '/').chainToKey('app:components/A.tsx')).toBeUndefined();
  });

  it('throws for an unknown route', () => {
    expect(() => new RouteGraph(fakeSnapshot('s', parts), '/nope')).toThrow(/route \/nope not in snapshot/);
  });
});

describe('chains in the diff', () => {
  it('attaches the PR-side chain to added moment in basic-before -> basic', () => {
    const d = diffSnapshots(loadSnapshot('basic-before'), loadSnapshot('basic'));
    const dash = d.routes.find((r) => r.route === '/dashboard');
    expect(dash?.modules[0]?.chain?.importer).toBe('app:components/DatePicker.tsx');
    expect(dash?.packages[0]?.chain?.clientBoundary).toBe('app:components/DashboardClient.tsx');
  });

  it('attaches the base-side chain to removed modules (reverse diff)', () => {
    const d = diffSnapshots(loadSnapshot('basic'), loadSnapshot('basic-before'));
    const moment = d.routes.find((r) => r.route === '/dashboard')?.modules.find((m) => m.key === 'pkg:moment/moment.js');
    expect(moment?.status).toBe('removed');
    expect(moment?.chain?.importer).toBe('app:components/DatePicker.tsx');
  });

  it('can skip chains', () => {
    const d = diffSnapshots(loadSnapshot('basic-before'), loadSnapshot('basic'), { chains: false });
    expect(d.routes[0]?.modules[0]?.chain).toBeUndefined();
  });
});
