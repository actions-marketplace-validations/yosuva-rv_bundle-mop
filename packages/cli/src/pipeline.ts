// diff → budgets → rules, shared by the CLI and the GitHub Action so they never disagree.
import type { AnalyzeSnapshot } from './adapter/types.js';
import { checkBudgets } from './budgets/check.js';
import type { BudgetResult } from './budgets/check.js';
import type { BudgetConfig } from './budgets/config.js';
import { diffSnapshots } from './model/diff.js';
import type { SnapshotDiff } from './model/diff.js';
import { runRules } from './rules/engine.js';
import type { Finding } from './rules/types.js';

export interface AnalysisOptions {
  minBytes?: number;
  config?: BudgetConfig;
}

export interface Analysis {
  diff: SnapshotDiff;
  /** Budget findings (ruleId `budget`) first, then rule findings; each group sorted by severity. */
  findings: Finding[];
  budgets: BudgetResult[];
}

export function analyze(base: AnalyzeSnapshot, pr: AnalyzeSnapshot, options: AnalysisOptions = {}): Analysis {
  const minBytes = options.minBytes ?? 1_000;
  const diff = diffSnapshots(base, pr);
  const budget = options.config ? checkBudgets(diff, options.config, { minBytes }) : { results: [], findings: [] };
  return { diff, budgets: budget.results, findings: [...budget.findings, ...runRules(diff, base, pr, { minBytes })] };
}
