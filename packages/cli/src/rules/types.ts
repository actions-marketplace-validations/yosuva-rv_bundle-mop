import type { AnalyzeSnapshot } from '../adapter/types.js';
import type { ImportChain } from '../model/chains.js';
import type { RouteDiff } from '../model/diff.js';

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  ruleId: string;
  severity: Severity;
  /** One line, e.g. "moment adds 61.3 kB to first-load JS". */
  title: string;
  /** Why it matters / what we saw. Plain text. */
  message: string;
  /** What to do. May contain a fenced code block. */
  suggestion?: string;
  docs?: string;
  /** What the finding is about: a SourceRef key or `pkg:<name>`. Findings merge on ruleId + subject. */
  subject: string;
  packageName?: string;
  /** Routes affected (merged across routes). */
  routes: string[];
  /** Bytes at stake on the worst route (rule-specific, usually first-load growth). */
  bytes: number;
  /** Import chain on the worst route. */
  chain?: ImportChain;
}

export interface RuleOptions {
  /** Ignore changes smaller than this (minifier noise). Default 1000 B. */
  minBytes: number;
  /** "Large" first-load growth that warrants lazy loading. Default 30 kB. */
  largeBytes: number;
  /** Modules from one package before suggesting optimizePackageImports. Default 10. */
  moduleThreshold: number;
  /** Also check Next-internal routes (`/_not-found`, `/_global-error`). Default false. */
  includeInternalRoutes: boolean;
}

export const DEFAULT_RULE_OPTIONS: RuleOptions = {
  minBytes: 1_000,
  largeBytes: 30_000,
  moduleThreshold: 10,
  includeInternalRoutes: false,
};

export interface RuleContext {
  route: RouteDiff;
  base: AnalyzeSnapshot;
  pr: AnalyzeSnapshot;
  options: RuleOptions;
}

/** A per-route finding before merging (`routes` filled in by the engine). */
export type RouteFinding = Omit<Finding, 'routes'>;

export interface Rule {
  id: string;
  description: string;
  check(ctx: RuleContext): RouteFinding[];
}
