import { describe, expect, it } from 'vitest';
import { assetTypeOf } from '../src/adapter/next-analyze.js';
import { diffSnapshots } from '../src/model/diff.js';
import { routeSizes } from '../src/model/sizes.js';
import { fakeSnapshot } from './helpers/fake-export.js';
import { loadSnapshot, readRouteSummaries } from './helpers/fixtures.js';

const route = (fixture: string, r: string) => {
  const data = loadSnapshot(fixture).routes.get(r);
  if (!data) throw new Error(`route ${r} missing in ${fixture}`);
  return routeSizes(data);
};

describe.each(['basic', 'dynamic-barrel'])('client totals match Next route-summaries.json: %s', (fixture) => {
  it.each(readRouteSummaries(fixture).map((s) => [s.route, s] as const))('%s', (r, summary) => {
    const { client } = route(fixture, r);
    expect(client).toEqual({ raw: summary.client.size, compressed: summary.client.compressed_size });
  });
});

describe('only JavaScript counts as JS (fonts and CSS are client files too)', () => {
  it('classifies outputs by extension', () => {
    expect(['a.js', 'a.mjs', 'a.cjs', 'a.css', 'a.woff2', 'a.woff', 'a.ttf', 'a.png'].map(assetTypeOf)).toEqual([
      'js', 'js', 'js', 'css', 'font', 'font', 'font', 'other',
    ]);
  });

  it('excludes CSS and fonts from route JS sizes and from the diff (shadcn/ui shipped 0.5 MB of fonts per route)', () => {
    const page = { path: '[project]/app/page.tsx', size: 5_000 };
    const font = (hash: string) => ({ path: `[client-fs]/_next/static/media/${hash}.woff2`, size: 166_000, file: `[client-fs]/_next/static/media/${hash}.woff2` });
    const css = { path: '[project]/app/globals.css', size: 30_000, file: '[client-fs]/_next/static/chunks/abc.css' };
    const base = fakeSnapshot('b', { '/': [page, font('aaaa'), css] });
    const pr = fakeSnapshot('p', { '/': [page, font('bbbb'), css] });
    const r = base.routes.get('/');
    expect(r?.parts.filter((p) => !p.isClient).map((p) => p.assetType).sort()).toEqual(['css', 'font']);
    expect(routeSizes(r as NonNullable<typeof r>).client.raw).toBe(5_000);
    const d = diffSnapshots(base, pr);
    expect(d.routes[0]).toMatchObject({ status: 'unchanged', modules: [] }); // the font's new hash is not a change
  });
});

describe('fixtures/basic EXPECTED.md', () => {
  it('/ and /dashboard sizes', () => {
    expect(route('basic', '/').client.raw).toBe(576_405);
    const dash = route('basic', '/dashboard');
    expect(dash.client.raw).toBe(630_550);
    expect(dash.firstLoad.raw).toBe(630_550);
    expect(dash.lazy.raw).toBe(0);
    expect(dash.firstLoad.raw - route('basic', '/').firstLoad.raw).toBe(54_145);
  });
});

describe('fixtures/dynamic-barrel EXPECTED.md', () => {
  it('/lazy splits first-load from lazy', () => {
    const lazy = route('dynamic-barrel', '/lazy');
    expect(lazy.client.raw).toBe(635_263);
    expect(lazy.lazy.raw).toBe(61_657);
    expect(lazy.firstLoad.raw).toBe(573_606);
    expect(lazy.firstLoad.raw - route('dynamic-barrel', '/').firstLoad.raw).toBe(-2_694);
  });

  it('the tree-shaken barrel re-export ships 11 bytes; the barrel itself none', () => {
    const parts = loadSnapshot('dynamic-barrel').routes.get('/lazy')?.parts.filter((p) => p.isClient) ?? [];
    const bytes = (key: string) => parts.filter((p) => p.source.key === key).reduce((a, p) => a + p.size, 0);
    expect(bytes('app:components/ui/Unused.tsx')).toBe(11);
    expect(bytes('app:components/ui/Badge.tsx')).toBe(58);
    expect(bytes('app:components/ui/index.ts')).toBe(0);
  });
});
