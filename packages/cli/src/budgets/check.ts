import path from 'node:path';
import { shortKey } from '../model/chains.js';
import type { RouteDiff, SnapshotDiff } from '../model/diff.js';
import type { Finding } from '../rules/types.js';
import { formatBytes, formatDelta } from '../util/format.js';
import { BUDGET_METRICS, CONFIG_FILE, matchesRoute } from './config.js';
import type { BudgetConfig, BudgetMetric } from './config.js';

/**
 * - `over`: over budget in the PR and either newly over or grew (by ≥ minBytes) while over → error
 * - `still-over`: was already over in base and didn't grow → warning (don't block unrelated PRs)
 * - `fixed`: over in base, under now
 * - `ok`: under budget
 */
export type BudgetStatus = 'over' | 'still-over' | 'fixed' | 'ok';

export interface BudgetResult {
  route: string;
  /** The pattern of the matching budget entry. */
  pattern: string;
  metric: BudgetMetric;
  limit: number;
  base: number;
  pr: number;
  /** Route didn't exist in base. */
  isNew: boolean;
  status: BudgetStatus;
}

export interface BudgetReport {
  results: BudgetResult[];
  /** One finding per `over` (error) or `still-over` (warning) result. ruleId `budget`. */
  findings: Finding[];
}

export const METRIC_LABEL: Record<BudgetMetric, string> = { firstLoad: 'first-load JS', lazy: 'lazy JS', client: 'total client JS' };

const STATUS_ORDER: Record<BudgetStatus, number> = { over: 0, 'still-over': 1, fixed: 2, ok: 3 };

function value(r: RouteDiff, metric: BudgetMetric) {
  return r[metric].raw;
}

/** The biggest first-load grower on the route, to explain why it's over. */
function culprit(r: RouteDiff) {
  return [...r.packages, ...r.modules.filter((m) => !m.packageName)]
    .filter((c) => c.firstLoad.delta > 0)
    .sort((a, b) => b.firstLoad.delta - a.firstLoad.delta)[0];
}

export function checkBudgets(diff: SnapshotDiff, config: BudgetConfig, options: { minBytes?: number } = {}): BudgetReport {
  const minBytes = options.minBytes ?? 1_000;
  const results: BudgetResult[] = [];
  const findings: Finding[] = [];

  for (const r of diff.routes) {
    if (r.status === 'removed') continue;
    // First matching entry wins. Wildcards never match Next-internal routes (/_not-found, /_global-error).
    const rule = config.budgets.find((b) => (r.isInternal && b.route.includes('*') ? false : matchesRoute(b.route, r.route)));
    if (!rule) continue;

    for (const metric of BUDGET_METRICS) {
      const limit = rule[metric];
      if (limit === undefined) continue;
      const { base, pr } = value(r, metric);
      const isNew = r.status === 'added';
      const overPr = pr > limit;
      const overBase = !isNew && base > limit;
      const status: BudgetStatus = overPr
        ? overBase && pr - base < minBytes
          ? 'still-over'
          : 'over'
        : overBase
          ? 'fixed'
          : 'ok';
      const result: BudgetResult = { route: r.route, pattern: rule.route, metric, limit, base, pr, isNew, status };
      results.push(result);

      if (status !== 'over' && status !== 'still-over') continue;
      const label = METRIC_LABEL[metric];
      const over = pr - limit;
      const why =
        status === 'still-over'
          ? `It was already ${formatBytes(base)} on the base branch; this PR didn't make it worse.`
          : isNew
            ? 'This route is new in this PR.'
            : overBase
              ? `It was already over budget (${formatBytes(base)}) and grew by ${formatDelta(pr - base)}.`
              : `It was ${formatBytes(base)} on the base branch (${formatDelta(pr - base)}).`;
      const top = culprit(r);
      const f: Finding = {
        ruleId: 'budget',
        severity: status === 'over' ? 'error' : 'warning',
        title: `${r.route} ${label} is ${formatBytes(pr)}, ${formatBytes(over)} over its ${formatBytes(limit)} budget`,
        message: `${why}${top && status === 'over' ? ` Biggest increase: ${top.packageName ?? shortKey(top.key)} (${formatDelta(top.firstLoad.delta)}).` : ''}`,
        suggestion:
          status === 'over'
            ? `Bring ${r.route} back under ${formatBytes(limit)} (see the suggestions below), or raise the "${rule.route}" budget in ${config.source ? shortPath(config.source) : CONFIG_FILE} if the increase is intended.`
            : `Not caused by this PR. Reduce ${r.route} or raise the "${rule.route}" budget when convenient.`,
        subject: `budget:${r.route}:${metric}`,
        routes: [r.route],
        bytes: over,
      };
      if (top?.chain && status === 'over') f.chain = top.chain;
      findings.push(f);
    }
  }

  results.sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.pr - b.limit - (a.pr - a.limit) || a.route.localeCompare(b.route),
  );
  findings.sort((a, b) => (a.severity === b.severity ? b.bytes - a.bytes : a.severity === 'error' ? -1 : 1));
  return { results, findings };
}

/** Config path for messages: relative to the working directory when inside it, else as given. */
const shortPath = (p: string) => {
  const rel = path.relative(process.cwd(), path.resolve(p));
  return (rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p).replace(/\\/g, '/');
};
