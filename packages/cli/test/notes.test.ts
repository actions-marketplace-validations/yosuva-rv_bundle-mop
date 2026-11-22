import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../src/model/diff.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { frameworkChanges, frameworkNote } from '../src/report/notes.js';
import { renderTextDiff } from '../src/report/text.js';
import { fakeSnapshot, pnpm } from './helpers/fake-export.js';
import { loadSnapshot } from './helpers/fixtures.js';

const page = { path: '[project]/app/page.tsx', size: 5_000 };
const next = (v: string, size = 100_000) => ({ path: pnpm('next', v, 'dist/client/index.js'), size });
const react = (v: string) => ({ path: pnpm('react', v, 'index.js'), size: 8_000 });

describe('framework version note', () => {
  it('explains a Next.js upgrade (the shadcn/ui case)', () => {
    const d = diffSnapshots(fakeSnapshot('b', { '/': [page, next('16.4.2')] }), fakeSnapshot('p', { '/': [page, next('16.4.5', 101_500)] }));
    expect(frameworkChanges(d)).toEqual([{ name: 'next', label: 'Next.js', from: '16.4.2', to: '16.4.5' }]);
    const note = 'This PR changes Next.js 16.4.2 → 16.4.5. Compiler and minifier changes can shift the size of every package slightly.';
    expect(frameworkNote(d)).toBe(note);
    expect(renderMarkdown(d)).toContain(`> ℹ️ ${note}`);
    expect(renderTextDiff(d)).toContain(`Note: ${note}`);
  });

  it('lists React changes without the compiler sentence', () => {
    const d = diffSnapshots(fakeSnapshot('b', { '/': [page, react('19.2.0')] }), fakeSnapshot('p', { '/': [page, react('19.3.1')] }));
    expect(frameworkNote(d)).toBe('This PR changes React 19.2.0 → 19.3.1.');
  });

  it('says nothing when framework versions are unchanged or unknown (npm layouts carry no versions)', () => {
    expect(frameworkNote(diffSnapshots(loadSnapshot('basic-before'), loadSnapshot('basic')))).toBeUndefined();
    const npm = { path: '[project]/node_modules/next/dist/client/index.js', size: 100_000 };
    const d = diffSnapshots(fakeSnapshot('b', { '/': [page, npm] }), fakeSnapshot('p', { '/': [page, { ...npm, size: 101_000 }] }));
    expect(frameworkNote(d)).toBeUndefined();
  });
});
