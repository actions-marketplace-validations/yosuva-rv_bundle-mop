import type { SnapshotDiff } from './diff.js';

const FRAMEWORK = ['next', 'react', 'react-dom'] as const;
type FrameworkName = (typeof FRAMEWORK)[number];
const LABEL: Record<FrameworkName, string> = { next: 'Next.js', react: 'React', 'react-dom': 'React DOM' };

export interface FrameworkChange {
  name: FrameworkName;
  label: string;
  from: string;
  to: string;
}

/**
 * Framework packages whose version changed between base and PR (pnpm layouts carry versions).
 * A Next.js upgrade changes the compiler and minifier, which shifts the size of every package a little
 * (seen on shadcn/ui: 16.4.2 → 16.4.5 moved ~1,600 modules by a few bytes each, +30 kB per page).
 */
export function frameworkChanges(diff: SnapshotDiff): FrameworkChange[] {
  const out = new Map<FrameworkName, FrameworkChange>();
  for (const r of diff.routes) {
    for (const p of r.packages) {
      const name = p.packageName as FrameworkName | undefined;
      if (!name || !FRAMEWORK.includes(name) || !p.versions || out.has(name)) continue;
      const from = p.versions.base.join(', ');
      const to = p.versions.pr.join(', ');
      if (from && to && from !== to) out.set(name, { name, label: LABEL[name], from, to });
    }
  }
  return FRAMEWORK.flatMap((n) => {
    const c = out.get(n);
    return c ? [c] : [];
  });
}

/** True when this diff upgrades or downgrades Next.js itself (its compiler minifies everything). */
export const compilerChanged = (diff: SnapshotDiff): boolean => frameworkChanges(diff).some((c) => c.name === 'next');
