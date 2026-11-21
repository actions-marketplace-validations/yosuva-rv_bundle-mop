// Options and output shared by `diff` and `compare`.
import { findConfig, loadConfig } from '../budgets/config.js';
import type { BudgetConfig } from '../budgets/config.js';
import type { Analysis } from '../pipeline.js';
import { renderMarkdown } from '../report/markdown.js';
import { renderTextDiff } from '../report/text.js';

export interface CommandResult {
  code: number;
  output: string;
  /** Output is an error or usage message (stderr). Reports go to stdout even when they set code 1 (fail-on). */
  error?: true;
}

export const fail = (output: string): CommandResult => ({ code: 1, output, error: true });

export class UsageError extends Error {}

export const FORMATS = ['text', 'markdown', 'json'] as const;
export type Format = (typeof FORMATS)[number];
export const FAIL_ON = ['none', 'info', 'warning', 'error'] as const;
export type FailOn = (typeof FAIL_ON)[number];

/** parseArgs option definitions for the report options. */
export const REPORT_OPTIONS = {
  json: { type: 'boolean' },
  format: { type: 'string' },
  top: { type: 'string' },
  'min-bytes': { type: 'string' },
  config: { type: 'string' },
  'fail-on': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

export const REPORT_USAGE = `  --format <text|markdown|json>  Output format (default text). markdown = PR comment
  --json                       Same as --format json
  --top <n>                    Changed modules listed per route (default 10)
  --min-bytes <n>              Noise floor: smaller changes are hidden and never flagged (default 1000)
  --config <file>              Budgets file (default: bundle-mop.config.json if it exists)
  --fail-on <level>            Exit 1 on a finding at or above: none, info, warning, error
                               (default error: only exceeded budgets produce errors)`;

export interface ReportOptions {
  top: number;
  minBytes: number;
  format: Format;
  failOn: FailOn;
}

interface ReportValues {
  json?: boolean | undefined;
  format?: string | undefined;
  top?: string | undefined;
  'min-bytes'?: string | undefined;
  'fail-on'?: string | undefined;
}

const nonNegInt = (v: string | undefined, fallback: number, flag: string): number => {
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${flag} must be a non-negative integer`);
  return n;
};

/** Validates report options; throws UsageError with a message for the user. */
export function parseReportOptions(values: ReportValues): ReportOptions {
  const top = nonNegInt(values.top, 10, '--top');
  const minBytes = nonNegInt(values['min-bytes'], 1_000, '--min-bytes');
  const fo = values['fail-on'] ?? 'error';
  if (!(FAIL_ON as readonly string[]).includes(fo)) throw new UsageError(`--fail-on must be one of ${FAIL_ON.join(', ')}`);
  const f = values.json ? 'json' : (values.format ?? 'text');
  if (!(FORMATS as readonly string[]).includes(f)) throw new UsageError(`--format must be one of ${FORMATS.join(', ')}`);
  if (values.json && values.format && values.format !== 'json') throw new UsageError('--json conflicts with --format');
  return { top, minBytes, format: f as Format, failOn: fo as FailOn };
}

/** `--config <file>` if given, else the first bundle-mop.config.json in `searchDirs`. */
export function loadBudgets(explicit: string | undefined, searchDirs: string[]): BudgetConfig | undefined {
  const file = explicit ?? findConfig(searchDirs);
  return file ? loadConfig(file) : undefined;
}

/** Renders the report. `extra` adds top-level JSON fields; they may not reuse the report's own field names. */
export function renderReport(a: Analysis, o: ReportOptions, extra: Record<string, unknown> = {}): string {
  if (o.format === 'json') {
    const report = { ...a.diff, budgets: a.budgets, findings: a.findings };
    const clash = Object.keys(extra).filter((k) => k in report);
    if (clash.length) throw new Error(`renderReport: extra field(s) ${clash.join(', ')} would overwrite report fields`);
    return JSON.stringify({ ...report, ...extra }, null, 2);
  }
  if (o.format === 'markdown') return renderMarkdown(a.diff, { findings: a.findings, budgets: a.budgets, top: o.top, minBytes: o.minBytes });
  return renderTextDiff(a.diff, { top: o.top, findings: a.findings, budgets: a.budgets, minBytes: o.minBytes });
}

const RANK = { info: 1, warning: 2, error: 3 } as const;

/** True when any finding is at or above `failOn` severity. Only budgets produce `error`. */
export function failsOn(findings: { severity: 'info' | 'warning' | 'error' }[], failOn: FailOn): boolean {
  return failOn !== 'none' && findings.some((f) => RANK[f.severity] >= RANK[failOn]);
}
