import { describe, expect, it } from 'vitest';
import { routeSizes } from '../src/model/sizes.js';
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
