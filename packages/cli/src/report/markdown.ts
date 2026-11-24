// GitHub-flavored markdown for a PR comment.
import { shortKey } from '../model/chains.js';
import type { ImportChain } from '../model/chains.js';
import type { BudgetResult } from '../budgets/check.js';
import { METRIC_LABEL } from '../budgets/check.js';
import type { ContributionDiff, Delta, RouteDiff, SnapshotDiff } from '../model/diff.js';
import type { Finding } from '../rules/types.js';
import { formatBytes, formatDelta } from '../util/format.js';
import { frameworkNote } from './notes.js';
import { routeRows } from './rows.js';
import type { ReportRow } from './rows.js';

/** First line of every comment, so the GitHub Action can find and update its own comment. */
export const COMMENT_MARKER = '<!-- bundle-mop:comment -->';

/** GitHub rejects comments over 65,536 characters. */
const GITHUB_LIMIT = 65_536;

export interface MarkdownOptions {
  /** Rule and budget findings. Budget findings (ruleId `budget`) render in the Budgets section. */
  findings?: Finding[];
  /** Budget results from checkBudgets(); renders a Budgets section when present. */
  budgets?: BudgetResult[];
  /** Hide route/module changes smaller than this (minifier noise). Default 1000 B. */
  minBytes?: number;
  /** Max modules per route table. Default 10. */
  top?: number;
  /** Max `Why` chains per route. Default 3. */
  whyLimit?: number;
  /** Max comment length; the report degrades (drops details) to fit. Default 60,000. */
  maxLength?: number;
}

// --- escaping -----------------------------------------------------------------

/** Inline code that survives backticks and (in tables) pipes. */
export function code(s: string, inTable = false): string {
  let text = inTable ? s.replace(/\|/g, '\\|') : s;
  text = text.replace(/\r?\n/g, ' ');
  if (!text.includes('`')) return `\`${text}\``;
  return `\`\` ${text} \`\``;
}

const pct = (d: Delta): string => {
  if (d.base === 0) return '';
  const p = (d.delta / d.base) * 100;
  return ` (${p > 0 ? '+' : ''}${p.toFixed(Math.abs(p) < 1 ? 2 : 1)}%)`;
};

const significant = (r: RouteDiff, min: number) =>
  r.status === 'added' || r.status === 'removed' || Math.abs(r.firstLoad.raw.delta) >= min || Math.abs(r.lazy.raw.delta) >= min;

const moduleSignificant = (m: ContributionDiff, min: number) =>
  Math.abs(m.firstLoad.delta) >= min || Math.abs(m.lazy.delta) >= min || m.movedTo !== undefined;

export function formatChainMarkdown(chain: ImportChain): string {
  return chain.steps
    .map((s) => {
      const tags: string[] = [];
      if (s.viaDynamicImport) tags.push('dynamic import');
      if (s.isClientBoundary) tags.push('"use client"');
      if (s.isBarrel) tags.push('barrel');
      return `${code(shortKey(s.key))}${tags.length ? ` (${tags.join(', ')})` : ''}`;
    })
    .join(' → ');
}

/** Text inside a quoted Mermaid label: quotes and `#` are entities, angle brackets can't open tags. */
const mermaidText = (s: string) => s.replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');

/** Long paths keep their last three segments; the text chain under the graph has the full path. */
const nodeLabel = (key: string) => {
  const parts = shortKey(key).split('/');
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : parts.join('/');
};

/**
 * The import chain as a Mermaid flowchart (GitHub renders it in comments and job summaries). `targetNote`, e.g.
 * `+61.3 kB`, goes on the last node. Short chains read left to right, long ones top down.
 */
export function formatChainMermaid(chain: ImportChain, targetNote?: string): string {
  const lines = ['```mermaid', `flowchart ${chain.steps.length <= 4 ? 'LR' : 'TD'}`];
  const classes: Record<'server' | 'client' | 'pkg', string[]> = { server: [], client: [], pkg: [] };
  chain.steps.forEach((s, i) => {
    const last = i === chain.steps.length - 1;
    const tags: string[] = [];
    if (s.isServerComponent) tags.push('Server Component');
    if (s.isClientBoundary) tags.push('"use client"');
    if (s.isBarrel) tags.push('barrel');
    if (last && targetNote) tags.push(targetNote);
    const label = [nodeLabel(s.key), ...tags].map(mermaidText).join('<br/>');
    lines.push(`  n${i}["${label}"]`);
    if (i > 0) lines.push(s.viaDynamicImport ? `  n${i - 1} -. dynamic import .-> n${i}` : `  n${i - 1} --> n${i}`);
    if (last && s.packageName) classes.pkg.push(`n${i}`);
    else if (s.isClientBoundary) classes.client.push(`n${i}`);
    else if (s.isServerComponent) classes.server.push(`n${i}`);
  });
  // Dark text on light fills: readable in GitHub's light and dark themes alike.
  lines.push(
    '  classDef server fill:#e0e7ff,stroke:#4f46e5,color:#111827',
    '  classDef client fill:#fef3c7,stroke:#d97706,color:#111827',
    '  classDef pkg fill:#fee2e2,stroke:#dc2626,color:#111827',
  );
  for (const [name, ids] of Object.entries(classes)) if (ids.length) lines.push(`  class ${ids.join(',')} ${name}`);
  lines.push('```');
  return lines.join('\n');
}

// --- sections -----------------------------------------------------------------

function headline(diff: SnapshotDiff, shown: RouteDiff[], findings: Finding[], min: number): string {
  const nSug = findings.length;
  const sug = nSug ? ` · ${nSug} suggestion${nSug === 1 ? '' : 's'}` : '';
  if (!shown.length) return `✅ No route's JS changed by ${formatBytes(min)} or more.${sug}`;
  // Prefer the app's own routes: a Next upgrade can add internal ones like /_global-error, which aren't the PR's doing.
  const own = shown.filter((r) => !r.isInternal);
  const pool = own.length ? own : shown;
  const worst = pool.reduce((a, b) => (Math.abs(b.firstLoad.raw.delta) > Math.abs(a.firstLoad.raw.delta) ? b : a));
  const fl = worst.firstLoad.raw;
  const icon = fl.delta > 0 ? '🔺' : fl.delta < 0 ? '🔻' : '•';
  const counts = `${shown.length} route${shown.length === 1 ? '' : 's'} changed`;
  const desc =
    worst.status === 'added'
      ? `${code(worst.route)} added (${formatBytes(fl.pr)} first-load)`
      : worst.status === 'removed'
        ? `${code(worst.route)} removed`
        : `${code(worst.route)} first-load ${formatDelta(fl.delta)}${pct(fl)}`;
  return `${icon} **Largest change:** ${desc} · ${counts}${sug}`;
}

function routeTable(routes: RouteDiff[]): string[] {
  const rows = routes.map((r) => {
    const fl = r.firstLoad.raw;
    const lazy = r.lazy.raw.delta ? formatDelta(r.lazy.raw.delta) : '';
    if (r.status === 'added') return `| ${code(r.route, true)} (new) | ${formatBytes(fl.pr)} | new | ${lazy} |`;
    if (r.status === 'removed') return `| ~~${code(r.route, true)}~~ | | removed (was ${formatBytes(fl.base)}) | |`;
    const change = fl.delta ? `${fl.delta > 0 ? '**' : ''}${formatDelta(fl.delta)}${fl.delta > 0 ? '**' : ''}${pct(fl)}` : '±0 B';
    return `| ${code(r.route, true)} | ${formatBytes(fl.pr)} | ${change} | ${lazy} |`;
  });
  return ['| Route | First-load JS | Change | Lazy change |', '|---|---:|---:|---:|', ...rows];
}

function noteFor(m: ReportRow): string {
  const notes: string[] = [];
  if (m.status === 'added' || m.status === 'removed') notes.push(m.status);
  if (m.isPackage) notes.push(`${m.moduleCount} modules`);
  if (m.movedTo) notes.push(`moved to ${m.movedTo === 'lazy' ? 'lazy' : 'first-load'}`);
  if (m.versions) notes.push(`${m.versions.base.join(', ') || '?'} → ${m.versions.pr.join(', ') || '?'}`);
  return notes.join('; ');
}

const rowLabel = (row: ReportRow) => (row.isPackage ? (row.packageName ?? shortKey(row.key)) : shortKey(row.key));
const countModules = (rows: ReportRow[]) => rows.reduce((a, r) => a + r.moduleCount, 0);

function routeDetails(r: RouteDiff, opts: Required<Omit<MarkdownOptions, 'findings' | 'budgets' | 'maxLength'>>, open: boolean): string[] {
  const all = routeRows(r);
  // A package row is judged by its total, so many small files that add up are not hidden as noise.
  const rows = all.filter((m) => moduleSignificant(m, opts.minBytes));
  const hiddenModules = countModules(all) - countModules(rows);
  if (!rows.length) return [];
  const shown = rows.slice(0, opts.top);
  const changed = countModules(rows);
  const lines = [
    `<details${open ? ' open' : ''}><summary><b>${r.route.replace(/[<>&]/g, '')}</b>: ${changed} changed module${changed === 1 ? '' : 's'}</summary>`,
    '',
    '| Module | First-load | Lazy | |',
    '|---|---:|---:|---|',
    ...shown.map(
      (m) =>
        `| ${code(rowLabel(m), true)} | ${m.firstLoad.delta ? formatDelta(m.firstLoad.delta) : ''} | ${m.lazy.delta ? formatDelta(m.lazy.delta) : ''} | ${noteFor(m)} |`,
    ),
  ];
  const more: string[] = [];
  if (rows.length > shown.length) more.push(`${rows.length - shown.length} more`);
  if (hiddenModules) more.push(`${hiddenModules} smaller change${hiddenModules === 1 ? '' : 's'} under ${formatBytes(opts.minBytes)}`);
  if (more.length) lines.push('', `<sub>Not shown: ${more.join(', ')}.</sub>`);

  const whys = shown.filter((m) => m.chain && m.chain.steps.length > 1 && (m.firstLoad.delta > 0 || m.lazy.delta > 0)).slice(0, opts.whyLimit);
  for (const m of whys) lines.push('', `**Why ${code(rowLabel(m))} ships:** ${formatChainMarkdown(m.chain as ImportChain)}`);
  lines.push('', '</details>');
  return lines;
}

const SEVERITY_ICON: Record<Finding['severity'], string> = { error: '❌', warning: '⚠️', info: '💡' };

const routeList = (routes: string[]) =>
  routes.length > 5 ? `${routes.slice(0, 5).map((r) => code(r)).join(', ')} +${routes.length - 5} more` : routes.map((r) => code(r)).join(', ');

function findingBody(f: Finding): string[] {
  const lines: string[] = [];
  if (f.message) lines.push(f.message, '');
  if (f.suggestion) lines.push(f.suggestion, '');
  if (f.docs) lines.push(`[Docs](${f.docs})`, '');
  return lines;
}

/** Findings about the same subject (e.g. `pkg:moment`) share one heading and one import chain. */
function findingGroup(group: Finding[], withChain: boolean, open = false): string[] {
  const [head, ...rest] = group as [Finding, ...Finding[]];
  const lines = [`#### ${SEVERITY_ICON[head.severity]} ${head.title}`, `<sub>${head.ruleId} · ${routeList(head.routes)}</sub>`, '', ...findingBody(head)];
  for (const f of rest) {
    const routes = f.routes.join() === head.routes.join() ? '' : ` · ${routeList(f.routes)}`;
    lines.push(`**${SEVERITY_ICON[f.severity]} ${f.title}** <sub>${f.ruleId}${routes}</sub>`, '', ...findingBody(f));
  }
  const chain = group.find((f) => f.chain && f.chain.steps.length > 1)?.chain;
  if (withChain && chain) {
    const note = head.bytes > 0 ? `+${formatBytes(head.bytes)}` : undefined;
    lines.push(`<details${open ? ' open' : ''}><summary>Import chain</summary>`, '', formatChainMermaid(chain, note), '', formatChainMarkdown(chain), '', '</details>', '');
  }
  return lines;
}

function groupBySubject(findings: Finding[]): Finding[][] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const g = groups.get(f.subject);
    if (g) g.push(f);
    else groups.set(f.subject, [f]);
  }
  return [...groups.values()];
}

const FOOTER =
  '<sub>Minified client JS from <code>next analyze</code>; gzip figures are estimates. Changes under the noise threshold are hidden. Generated by <a href="https://github.com/yosuva-rv/bundle-mop">Bundle Mop</a>.</sub>';

// --- budgets --------------------------------------------------------------------

const BUDGET_ROWS = { full: 25, compact: 25, minimal: 10 } as const;

function budgetStatus(b: BudgetResult): string {
  const over = formatBytes(b.pr - b.limit);
  switch (b.status) {
    case 'over':
      return `❌ over by ${over}${b.isNew ? ' (new route)' : ''}`;
    case 'still-over':
      return `⚠️ over by ${over} (already over on base)`;
    case 'fixed':
      return `✅ back under (was ${formatBytes(b.base)})`;
    default:
      return `✅ ${Math.round((b.pr / b.limit) * 100)}% used`;
  }
}

function budgetLine(results: BudgetResult[]): string | undefined {
  const over = results.filter((b) => b.status === 'over').length;
  const still = results.filter((b) => b.status === 'still-over').length;
  if (!over && !still) return undefined;
  const parts: string[] = [];
  if (over) parts.push(`❌ **${over} budget${over === 1 ? '' : 's'} exceeded**`);
  if (still) parts.push(`⚠️ ${still} already over budget on base`);
  return parts.join(' · ');
}

function budgetSection(results: BudgetResult[], findings: Finding[], detail: 'full' | 'compact' | 'minimal'): string[] {
  if (!results.length) return [];
  const rows = results.slice(0, BUDGET_ROWS[detail]);
  const lines = [
    '### Budgets',
    '',
    '| Route | Metric | Size | Budget | |',
    '|---|---|---:|---:|---|',
    ...rows.map((b) => `| ${code(b.route, true)} | ${METRIC_LABEL[b.metric]} | ${formatBytes(b.pr)} | ${formatBytes(b.limit)} | ${budgetStatus(b)} |`),
  ];
  if (results.length > rows.length) lines.push('', `<sub>${results.length - rows.length} more budgeted routes within budget.</sub>`);
  lines.push('');
  if (detail !== 'minimal') {
    for (const f of findings) lines.push(`**${SEVERITY_ICON[f.severity]} ${f.title}**`, '', ...findingBody(f));
  }
  return lines;
}

// --- render -------------------------------------------------------------------

function render(diff: SnapshotDiff, options: MarkdownOptions, detail: 'full' | 'compact' | 'minimal'): string {
  const opts = { minBytes: options.minBytes ?? 1_000, top: options.top ?? 10, whyLimit: options.whyLimit ?? 3 };
  const all = options.findings ?? [];
  const budgetFindings = all.filter((f) => f.ruleId === 'budget');
  const findings = all.filter((f) => f.ruleId !== 'budget');
  const budgets = options.budgets ?? [];
  const shown = diff.routes.filter((r) => r.status !== 'unchanged' && significant(r, opts.minBytes));
  const quiet = diff.routes.filter((r) => r.status === 'changed' && !significant(r, opts.minBytes)).length;

  const out: string[] = [COMMENT_MARKER, '## Bundle Mop', ''];
  const bl = budgetLine(budgets);
  if (bl) out.push(bl, '');
  out.push(headline(diff, shown, findings, opts.minBytes), '');
  const fw = frameworkNote(diff);
  if (fw) out.push(`> ℹ️ ${fw}`, '');

  if (shown.length) {
    const tableRoutes = detail === 'minimal' ? shown.slice(0, 50) : shown;
    out.push(...routeTable(tableRoutes), '');
    const notes: string[] = [];
    if (shown.length > tableRoutes.length) notes.push(`${shown.length - tableRoutes.length} more changed routes not shown`);
    if (quiet) notes.push(`${quiet} route${quiet === 1 ? '' : 's'} changed by less than ${formatBytes(opts.minBytes)}`);
    if (diff.summary.unchanged) notes.push(`${diff.summary.unchanged} unchanged`);
    if (notes.length) out.push(`<sub>${notes.join(' · ')}</sub>`, '');
  }

  out.push(...budgetSection(budgets, budgetFindings, detail));

  if (detail === 'full') {
    let first = true;
    for (const r of shown) {
      const block = routeDetails(r, opts, first);
      if (block.length) {
        out.push(...block, '');
        first = false;
      }
    }
  }

  if (findings.length && detail !== 'minimal') {
    out.push('### Suggestions', '');
    // The worst suggestion's chain is open: the graph is the quickest way to see why.
    groupBySubject(findings).forEach((g, i) => out.push(...findingGroup(g, detail === 'full', i === 0)));
  } else if (findings.length) {
    out.push('### Suggestions', '', ...findings.slice(0, 20).map((f) => `- ${SEVERITY_ICON[f.severity]} ${f.title} <sub>(${f.ruleId})</sub>`), '');
  }

  if (diff.warnings.length) {
    out.push('<details><summary>Analyzer warnings</summary>', '', ...diff.warnings.map((w) => `- ${w}`), '', '</details>', '');
  }
  if (detail !== 'full') out.push('<sub>Report shortened to fit a GitHub comment. Run <code>bundle-mop diff</code> locally for the full report.</sub>', '');
  out.push(FOOTER);
  return out.join('\n') + '\n';
}

export function renderMarkdown(diff: SnapshotDiff, options: MarkdownOptions = {}): string {
  const max = Math.min(options.maxLength ?? 60_000, GITHUB_LIMIT);
  for (const detail of ['full', 'compact', 'minimal'] as const) {
    const md = render(diff, options, detail);
    if (md.length <= max) return md;
  }
  const md = render(diff, options, 'minimal');
  const cut = md.slice(0, max - 200);
  return `${cut.slice(0, cut.lastIndexOf('\n'))}\n\n<sub>Report truncated.</sub>\n`;
}
