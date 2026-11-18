import { formatChain } from '../model/chains.js';
import type { ContributionDiff, Delta, RouteDiff, SnapshotDiff } from '../model/diff.js';

/** How many modules per route get a `why:` chain line. */
const WHY_LIMIT = 3;
const grew = (m: ContributionDiff) => m.firstLoad.delta > 0 || m.lazy.delta > 0;

/** `64 B`, `61.3 kB` (1 kB = 1000 B, like Next.js). */
export function formatBytes(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  return abs < 1000 ? `${sign}${abs} B` : `${sign}${(abs / 1000).toFixed(1)} kB`;
}

export const formatDelta = (n: number): string => (n > 0 ? `+${formatBytes(n)}` : n === 0 ? '±0 B' : formatBytes(n));

const pct = (d: Delta): string => {
  if (d.base === 0) return 'new';
  const p = (d.delta / d.base) * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(Math.abs(p) < 1 ? 2 : 1)}%`;
};

const MARK: Record<ContributionDiff['status'], string> = { added: '+', removed: '-', changed: '~', unchanged: ' ' };

function moduleLine(m: ContributionDiff, width: number): string {
  const parts: string[] = [];
  if (m.firstLoad.delta) parts.push(`${formatDelta(m.firstLoad.delta)} first-load`);
  if (m.lazy.delta) parts.push(`${formatDelta(m.lazy.delta)} lazy`);
  if (!parts.length) parts.push(`${formatDelta(m.compressed.delta)} gzip est.`);
  const notes: string[] = [];
  if (m.status === 'added' || m.status === 'removed') notes.push(m.status);
  if (m.movedTo) notes.push(`moved to ${m.movedTo === 'lazy' ? 'lazy' : 'first-load'}`);
  if (m.versions) notes.push(`${m.versions.base.join(',') || '?'} → ${m.versions.pr.join(',') || '?'}`);
  return `  ${MARK[m.status]} ${m.key.padEnd(width)}  ${parts.join(', ')}${notes.length ? `  (${notes.join('; ')})` : ''}`;
}

function routeBlock(r: RouteDiff, top: number): string[] {
  const fl = r.firstLoad.raw;
  const head =
    r.status === 'added'
      ? `${r.route}  [added]  first-load ${formatBytes(fl.pr)}`
      : r.status === 'removed'
        ? `${r.route}  [removed]  first-load was ${formatBytes(fl.base)}`
        : `${r.route}  first-load ${formatBytes(fl.base)} → ${formatBytes(fl.pr)}  (${formatDelta(fl.delta)}, ${pct(fl)})`;
  const lines = [head];
  if (r.lazy.raw.delta) lines.push(`  lazy ${formatBytes(r.lazy.raw.base)} → ${formatBytes(r.lazy.raw.pr)}  (${formatDelta(r.lazy.raw.delta)})`);
  if (r.status === 'changed') {
    const shown = r.modules.slice(0, top);
    const width = Math.min(60, Math.max(0, ...shown.map((m) => m.key.length)));
    let why = 0;
    for (const m of shown) {
      lines.push(moduleLine(m, width));
      if (m.chain && grew(m) && why < WHY_LIMIT && m.chain.steps.length > 1) {
        lines.push(`      why: ${formatChain(m.chain)}`);
        why++;
      }
    }
    if (r.modules.length > top) lines.push(`  … ${r.modules.length - top} more changed module(s)`);
  }
  return lines;
}

export interface TextOptions {
  /** Max modules listed per route (default 10). */
  top?: number;
}

export function renderTextDiff(diff: SnapshotDiff, options: TextOptions = {}): string {
  const top = options.top ?? 10;
  const { changed, added, removed, unchanged } = diff.summary;
  const out = [
    `bundle-mop diff: ${diff.base.snapshotName} → ${diff.pr.snapshotName}`,
    `${changed} changed, ${added} added, ${removed} removed, ${unchanged} unchanged route(s)`,
    'Sizes are minified client JS. gzip figures are estimates.',
  ];
  for (const r of diff.routes) {
    if (r.status === 'unchanged') continue;
    out.push('', ...routeBlock(r, top));
  }
  if (diff.warnings.length) out.push('', 'Warnings:', ...diff.warnings.map((w) => `  ! ${w}`));
  return out.join('\n');
}
