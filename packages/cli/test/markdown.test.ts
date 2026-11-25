import { describe, expect, it } from 'vitest';
import type { AnalyzeSnapshot } from '../src/adapter/index.js';
import { diffSnapshots } from '../src/model/diff.js';
import type { ChainStep, ImportChain } from '../src/model/chains.js';
import { code, COMMENT_MARKER, formatChainMermaid, renderMarkdown } from '../src/report/markdown.js';
import type { MarkdownOptions } from '../src/report/markdown.js';
import { runRules } from '../src/rules/index.js';
import { fakeSnapshot, pnpm } from './helpers/fake-export.js';
import type { FakePart } from './helpers/fake-export.js';
import { loadSnapshot } from './helpers/fixtures.js';

const report = (base: AnalyzeSnapshot, pr: AnalyzeSnapshot, opts: MarkdownOptions = {}) => {
  const diff = diffSnapshots(base, pr);
  return renderMarkdown(diff, { findings: runRules(diff, base, pr), ...opts });
};

describe('markdown: basic-before -> basic (golden file)', () => {
  const md = report(loadSnapshot('basic-before'), loadSnapshot('basic'));

  it('matches the committed golden comment', async () => {
    await expect(md).toMatchFileSnapshot('./golden/basic-before-to-basic.md');
  });

  it('starts with the marker the GitHub Action looks for', () => {
    expect(md.split('\n')[0]).toBe(COMMENT_MARKER);
  });

  it('hides minifier noise but says how much was hidden', () => {
    expect(md).not.toContain('DashboardClient.tsx` | -29 B');
    expect(md).toContain('Not shown: 2 smaller changes under 1.0 kB.');
  });

  it('groups the three moment suggestions under one heading with one chain', () => {
    expect(md.match(/^#### /gm)).toHaveLength(1);
    expect(md.match(/<summary>Import chain<\/summary>/g)).toHaveLength(1);
  });
});

describe('markdown: edge cases', () => {
  const page: FakePart = { path: '[project]/app/page.tsx', size: 5_000 };

  it('says so when nothing changed', () => {
    const s = loadSnapshot('basic');
    const md = report(s, s);
    expect(md).toContain("✅ No route's JS changed by 1.0 kB or more.");
    expect(md).not.toContain('| Route |');
    expect(md).not.toContain('### Suggestions');
  });

  it('treats changes below the threshold as quiet', () => {
    const md = report(fakeSnapshot('b', { '/': [page] }), fakeSnapshot('p', { '/': [{ ...page, size: 5_400 }] }));
    expect(md).toContain('✅');
    expect(report(fakeSnapshot('b', { '/': [page] }), fakeSnapshot('p', { '/': [{ ...page, size: 5_400 }] }), { minBytes: 100 })).toContain(
      '| `/` | 5.4 kB | **+400 B** (+8.0%) |  |',
    );
  });

  it('headlines the app\'s own routes, not Next-internal ones a framework upgrade adds (the shadcn/ui case)', () => {
    const md = report(
      fakeSnapshot('b', { '/docs': [page] }),
      fakeSnapshot('p', { '/docs': [{ ...page, size: 35_000 }], '/_global-error': [{ path: '[project]/x.js', size: 570_000 }] }),
    );
    expect(md).toContain('**Largest change:** `/docs` first-load +30.0 kB');
    expect(md).toContain('| `/_global-error` (new) |'); // still listed, just not the headline
  });

  it('shows added and removed routes', () => {
    const md = report(
      fakeSnapshot('b', { '/': [page], '/old': [{ path: '[project]/app/old/page.tsx', size: 3_000 }] }),
      fakeSnapshot('p', { '/': [page], '/new': [{ path: '[project]/app/new/page.tsx', size: 7_000 }] }),
    );
    expect(md).toContain('| `/new` (new) | 7.0 kB | new |  |');
    expect(md).toContain('| ~~`/old`~~ | | removed (was 3.0 kB) | |');
  });

  it('shows lazy changes and moves', () => {
    const chart: FakePart = { path: '[project]/components/Chart.tsx', size: 40_000 };
    const md = report(fakeSnapshot('b', { '/': [page, chart] }), fakeSnapshot('p', { '/': [page, { ...chart, lazy: true }] }));
    expect(md).toContain('| `/` | 5.0 kB | -40.0 kB (-88.9%) | +40.0 kB |');
    expect(md).toContain('| `components/Chart.tsx` | -40.0 kB | +40.0 kB | moved to lazy |');
    expect(md.split('\n')[3]).toMatch(/^🔻 /);
  });

  it('shows version changes', () => {
    const md = report(
      fakeSnapshot('b', { '/': [page, { path: pnpm('lodash', '4.17.20', 'debounce.js'), size: 3_000 }] }),
      fakeSnapshot('p', { '/': [page, { path: pnpm('lodash', '4.17.21', 'debounce.js'), size: 4_500 }] }),
    );
    expect(md).toContain('| `lodash/debounce.js` | +1.5 kB |  | 4.17.20 → 4.17.21 |');
  });

  it('escapes pipes and backticks in code spans', () => {
    expect(code('a|b', true)).toBe('`a\\|b`');
    expect(code('a|b')).toBe('`a|b`');
    expect(code('we`ird')).toBe('`` we`ird ``');
    const md = report(fakeSnapshot('b', { '/': [page] }), fakeSnapshot('p', { '/': [page, { path: '[project]/components/a|b.tsx', size: 2_000 }] }));
    expect(md).toContain('| `components/a\\|b.tsx` | +2.0 kB |');
  });

  it('includes analyzer warnings', () => {
    const b = fakeSnapshot('b', { '/': [page] });
    const p = fakeSnapshot('p', { '/': [page] });
    p.warnings.push('route /x: coverage entries=unknown');
    expect(report(b, p)).toContain('<details><summary>Analyzer warnings</summary>\n\n- pr: route /x: coverage entries=unknown');
  });

  it('shrinks to fit the length limit, then truncates', () => {
    const routes = (size: number, count = 120) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `/r${i}`,
          [page, ...Array.from({ length: 15 }, (__, j) => ({ path: `[project]/components/route${i}/Module${j}.tsx`, size }))],
        ]),
      );
    const base = fakeSnapshot('b', routes(1_000));
    const pr = fakeSnapshot('p', routes(3_000));
    const full = report(fakeSnapshot('b', routes(1_000, 5)), fakeSnapshot('p', routes(3_000, 5)));
    expect(full).toContain('changed modules</summary>');
    expect(full).not.toContain('Report shortened');
    // Even when asked for more, output never exceeds GitHub's 65,536-character limit.
    expect(report(base, pr, { maxLength: 1_000_000 }).length).toBeLessThanOrEqual(65_536);
    const compact = report(base, pr, { maxLength: 20_000 });
    expect(compact.length).toBeLessThanOrEqual(20_000);
    expect(compact).toContain('Report shortened to fit a GitHub comment');
    expect(compact).not.toContain('changed modules</summary>');
    const tiny = report(base, pr, { maxLength: 3_000 });
    expect(tiny.length).toBeLessThanOrEqual(3_000);
    expect(tiny.startsWith(COMMENT_MARKER)).toBe(true);
    expect(report(base, pr).length).toBeLessThanOrEqual(60_000);
  });
});

describe('formatChainMermaid', () => {
  const step = (key: string, extra: Partial<ChainStep> = {}): ChainStep => ({
    key,
    kind: key.startsWith('pkg:') ? 'package' : 'app',
    isClientBoundary: false,
    viaDynamicImport: false,
    isServerComponent: false,
    isBarrel: false,
    idents: [],
    ...extra,
  });
  const chainOf = (steps: ChainStep[]): ImportChain => ({ route: '/', steps, entryKind: 'server', viaDynamicImport: steps.some((s) => s.viaDynamicImport) });

  it('draws dynamic imports as dashed edges and styles the boundary and the package', () => {
    const md = formatChainMermaid(
      chainOf([step('app:app/page.tsx', { isServerComponent: true }), step('app:components/Shell.tsx', { isClientBoundary: true }), step('pkg:chart.js/dist/chart.js', { packageName: 'chart.js', viaDynamicImport: true })]),
      '+120.0 kB',
    );
    expect(md.startsWith('```mermaid\nflowchart LR\n')).toBe(true);
    expect(md).toContain('  n1 -. dynamic import .-> n2');
    expect(md).toContain('  n0 --> n1');
    expect(md).toContain('n2["chart.js/dist/chart.js<br/>+120.0 kB"]');
    expect(md).toContain('  class n0 server\n  class n1 client\n  class n2 pkg');
    expect(md.endsWith('\n```')).toBe(true);
  });

  it('escapes label text and shortens long paths; long chains go top down', () => {
    const md = formatChainMermaid(
      chainOf([
        step('app:app/(shop)/[slug]/page.tsx'),
        step('app:a/b.tsx'),
        step('app:a/c.tsx'),
        step('app:app/components/workflow/note-node/note-editor/context.tsx', { isBarrel: true }),
        step('pkg:x/"odd"#name.js', { packageName: 'x' }),
      ]),
    );
    expect(md).toContain('flowchart TD');
    expect(md).toContain('n0["…/(shop)/[slug]/page.tsx"]'); // brackets and parens are fine inside quotes
    expect(md).toContain('n3["…/note-node/note-editor/context.tsx<br/>barrel"]');
    expect(md).toContain('n4["x/#quot;odd#quot;#35;name.js"]');
    expect(md).not.toMatch(/n\d\["[^"\n]*"[^\]\n]*"\]/); // no raw quote inside a label
  });
});
