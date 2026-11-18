import type { AnalyzeSnapshot } from '../adapter/types.js';
import type { SnapshotDiff } from '../model/diff.js';
import { BUILTIN_RULES } from './rules.js';
import { DEFAULT_RULE_OPTIONS } from './types.js';
import type { Finding, Rule, RuleOptions, Severity } from './types.js';

export interface RunRulesOptions extends Partial<RuleOptions> {
  rules?: Rule[];
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Runs rules over every non-internal changed/added route of a diff and merges findings that share
 * `ruleId + subject` across routes (keeping the worst route's details). Sorted by severity, then bytes.
 */
export function runRules(diff: SnapshotDiff, base: AnalyzeSnapshot, pr: AnalyzeSnapshot, opts: RunRulesOptions = {}): Finding[] {
  const { rules = BUILTIN_RULES, ...rest } = opts;
  const options: RuleOptions = { ...DEFAULT_RULE_OPTIONS, ...rest };
  const merged = new Map<string, Finding>();

  for (const route of diff.routes) {
    if (route.status !== 'changed' && route.status !== 'added') continue;
    if (route.isInternal && !options.includeInternalRoutes) continue;
    for (const rule of rules) {
      for (const f of rule.check({ route, base, pr, options })) {
        const id = `${f.ruleId}\u0000${f.subject}`;
        const existing = merged.get(id);
        if (!existing) {
          merged.set(id, { ...f, routes: [route.route] });
        } else {
          existing.routes.push(route.route);
          if (f.bytes > existing.bytes) Object.assign(existing, { ...f, routes: existing.routes });
        }
      }
    }
  }

  return [...merged.values()].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.bytes - a.bytes || a.ruleId.localeCompare(b.ruleId),
  );
}
