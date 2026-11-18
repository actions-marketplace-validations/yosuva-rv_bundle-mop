import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../src/model/diff.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { routeRows } from '../src/report/rows.js';
import { renderTextDiff } from '../src/report/text.js';
import { fakeSnapshot, ident, pnpm } from './helpers/fake-export.js';
import type { FakeGraph, FakePart } from './helpers/fake-export.js';

// The demo PR's shape: `import { startCase } from 'lodash'` ships startCase plus 31 small helpers,
// each under the 1 kB noise floor but 6.4 kB together.
const page = ident('[project]/app/page.tsx', 'app-rsc');
const rsc = ident('[project]/components/Client.tsx', 'app-rsc');
const proxy = ident('[project]/components/Client.tsx', 'app-rsc', 'client reference proxy');
const client = ident('[project]/components/Client.tsx');
const lodashFiles = ['startCase.js', ...Array.from({ length: 31 }, (_, i) => `_helper${i}.js`)];
const lodashIdents = lodashFiles.map((f) => ident(pnpm('lodash', '4.18.1', f)));

const graph: FakeGraph = {
  modules: [
    { ident: page, sync: [rsc] },
    { ident: rsc, sync: [proxy] },
    { ident: proxy, sync: [client] },
    { ident: client, sync: [lodashIdents[0] as string] },
    { ident: lodashIdents[0] as string, sync: lodashIdents.slice(1) },
    ...lodashIdents.slice(1).map((i) => ({ ident: i })),
  ],
  entries: { '/': [page] },
};

const appPart: FakePart = { path: '[project]/components/Client.tsx', size: 2_000 };
const base = fakeSnapshot('b', { '/': [appPart] }, graph);
const pr = fakeSnapshot(
  'p',
  { '/': [{ ...appPart, size: 2_100 }, ...lodashFiles.map((f) => ({ path: pnpm('lodash', '4.18.1', f), size: 200 }))] },
  graph,
);
const diff = diffSnapshots(base, pr);
const route = diff.routes.find((r) => r.route === '/');

describe('routeRows', () => {
  it('collapses a package with many changed modules into one row', () => {
    const rows = routeRows(route as NonNullable<typeof route>);
    expect(rows.map((r) => [r.key, r.isPackage, r.moduleCount, r.firstLoad.delta])).toEqual([
      ['pkg:lodash', true, 32, 6_400],
      ['app:components/Client.tsx', false, 1, 100],
    ]);
  });

  it('keeps packages with only a few changed modules as module rows', () => {
    const two = diffSnapshots(base, fakeSnapshot('p2', { '/': [appPart, ...lodashFiles.slice(0, 2).map((f) => ({ path: pnpm('lodash', '4.18.1', f), size: 200 }))] }));
    const rows = routeRows(two.routes[0] as NonNullable<(typeof two.routes)[0]>);
    expect(rows.every((r) => !r.isPackage)).toBe(true);
    expect(rows.map((r) => r.key)).toContain('pkg:lodash/startCase.js');
  });
});

describe('reports with a grouped package', () => {
  it('markdown shows one lodash row that the noise floor no longer hides', () => {
    const md = renderMarkdown(diff, { minBytes: 1_000 });
    expect(md).toContain('<b>/</b>: 32 changed modules</summary>');
    expect(md).toContain('| `lodash` | +6.4 kB |  | added; 32 modules |');
    expect(md).not.toContain('_helper');
    expect(md).toContain('Not shown: 1 smaller change under 1.0 kB.'); // Client.tsx +100 B
    expect(md).toContain('**Why `lodash` ships:** `app/page.tsx` → `components/Client.tsx` ("use client") → `lodash/startCase.js`');
  });

  it('text report groups the same way', () => {
    const text = renderTextDiff(diff);
    expect(text).toMatch(/\+ pkg:lodash\s+\+6\.4 kB first-load {2}\(added; 32 modules\)/);
    expect(text).toContain('why: app/page.tsx → components/Client.tsx ("use client") → lodash/startCase.js');
    expect(text).not.toContain('_helper');
  });
});
