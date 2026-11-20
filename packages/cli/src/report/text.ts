import { formatChain } from '../model/chains.js';
import { METRIC_LABEL } from '../budgets/check.js';
import type { BudgetResult } from '../budgets/check.js';
import type { ContributionDiff, Delta, RouteDiff, SnapshotDiff } from '../model/diff.js';
import type { Finding } from '../rules/types.js';
import { formatBytes, formatDelta } from '../util/format.js';
import { routeRows } from './rows.js';
import type { ReportRow } from './rows.js';

export { formatBytes, formatDelta };

/** How many modules per route get a `why:` chain line. */
const WHY_LIMIT = 3;
const grew = (m: ContributionDiff) => m.firstLoad.delta > 0 || m.lazy.delta > 0;

const pct = (d: Delta): string => {
  if (d.base === 0) return 'new';
  const p = (d.delta / d.base) * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(Math.abs(p) < 1 ? 2 : 1)}%`;
};

const MARK: Record<ContributionDiff['status'], string> = { added: '+', removed: '-', changed: '~', unchanged: ' ' };

function moduleLine(m: ReportRow, width: number): string {
  const parts: string[] = [];
  if (m.firstLoad.delta) parts.push(`${formatDelta(m.firstLoad.delta)} first-load`);
  if (m.lazy.delta) parts.push(`${formatDelta(m.lazy.delta)} lazy`);
  if (!parts.length) parts.push(`${formatDelta(m.compressed.delta)} gzip est.`);
  const notes: string[] = [];
  if (m.status === 'added' || m.status === 'removed') notes.push(m.status);
  if (m.isPackage) notes.push(`${m.moduleCount} modules`);
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
    const rows = routeRows(r);
    const shown = rows.slice(0, top);
    const width = Math.min(60, Math.max(0, ...shown.map((m) => m.key.length)));
    let why = 0;
    for (const m of shown) {
      lines.push(moduleLine(m, width));
      if (m.chain && grew(m) && why < WHY_LIMIT && m.chain.steps.length > 1) {
        lines.push(`      why: ${formatChain(m.chain)}`);
        why++;
      }
    }
    if (rows.length > top) lines.push(`  … ${rows.length - top} more changed module(s)`);
  }
  return lines;
}

export interface TextOptions {
  /** Max modules listed per route (default 10). */
  top?: number;
  /** Rule and budget findings. Budget findings (ruleId `budget`) are listed under "Budgets". */
  findings?: Finding[];
  /** Budget results from checkBudgets(). */
  budgets?: BudgetResult[];
  /** Routes whose JS changed by less than this are summarised, not listed (default 1000 B; 0 lists all). */
  minBytes?: number;
}

const routeSignificant = (r: RouteDiff, min: number) =>
  r.status !== 'changed' || Math.abs(r.firstLoad.raw.delta) >= min || Math.abs(r.lazy.raw.delta) >= min;

const BUDGET_MARK: Record<BudgetResult['status'], string> = { over: 'x', 'still-over': '!', fixed: '✓', ok: '✓' };

function budgetLines(results: BudgetResult[], findings: Finding[]): string[] {
  if (!results.length) return [];
  const lines = ['', 'Budgets:'];
  for (const b of results) {
    const state =
      b.status === 'over'
        ? `over by ${formatBytes(b.pr - b.limit)}`
        : b.status === 'still-over'
          ? `over by ${formatBytes(b.pr - b.limit)}, already over on base`
          : b.status === 'fixed'
            ? `back under (was ${formatBytes(b.base)})`
            : `${Math.round((b.pr / b.limit) * 100)}% used`;
    lines.push(`  ${BUDGET_MARK[b.status]} ${b.route}  ${METRIC_LABEL[b.metric]} ${formatBytes(b.pr)} / ${formatBytes(b.limit)}  (${state})`);
    const f = findings.find((x) => x.subject === `budget:${b.route}:${b.metric}`);
    if (f?.message) lines.push(`      ${f.message}`);
    if (f?.suggestion) lines.push(`      → ${f.suggestion}`);
  }
  return lines;
}

const SEVERITY_MARK: Record<Finding['severity'], string> = { error: 'x', warning: '!', info: 'i' };

function findingBlock(f: Finding): string[] {
  const routes = f.routes.length > 3 ? `${f.routes.slice(0, 3).join(', ')} +${f.routes.length - 3} more` : f.routes.join(', ');
  const lines = [`  ${SEVERITY_MARK[f.severity]} [${f.ruleId}] ${f.title}  (${routes})`];
  if (f.message) lines.push(`      ${f.message}`);
  if (f.suggestion) lines.push(...f.suggestion.split('\n').map((l, i) => `      ${i === 0 ? '→ ' : '  '}${l}`.trimEnd()));
  if (f.docs) lines.push(`      docs: ${f.docs}`);
  return lines;
}

export function renderTextDiff(diff: SnapshotDiff, options: TextOptions = {}): string {
  const top = options.top ?? 10;
  const { changed, added, removed, unchanged } = diff.summary;
  const out = [
    `bundle-mop diff: ${diff.base.snapshotName} → ${diff.pr.snapshotName}`,
    `${changed} changed, ${added} added, ${removed} removed, ${unchanged} unchanged route(s)`,
    'Sizes are minified client JS. gzip figures are estimates.',
  ];
  const min = options.minBytes ?? 1_000;
  let quiet = 0;
  for (const r of diff.routes) {
    if (r.status === 'unchanged') continue;
    if (!routeSignificant(r, min)) {
      quiet++;
      continue;
    }
    out.push('', ...routeBlock(r, top));
  }
  if (quiet) out.push('', `${quiet} route(s) changed by less than ${formatBytes(min)} (not shown; --min-bytes 0 lists them).`);
  const all = options.findings ?? [];
  out.push(...budgetLines(options.budgets ?? [], all.filter((f) => f.ruleId === 'budget')));
  const findings = all.filter((f) => f.ruleId !== 'budget');
  if (findings.length) {
    out.push('', 'Suggestions:');
    for (const f of findings) out.push(...findingBlock(f));
  }
  if (diff.warnings.length) out.push('', 'Warnings:', ...diff.warnings.map((w) => `  ! ${w}`));
  return out.join('\n');
}
