import fs from 'node:fs';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { AdapterError, parseNextAnalyzeExport } from '../adapter/index.js';
import type { AnalyzeSnapshot } from '../adapter/index.js';
import { analyze } from '../pipeline.js';
import { fail, failsOn, loadBudgets, parseReportOptions, renderReport, REPORT_OPTIONS, REPORT_USAGE } from './shared.js';
import type { CommandResult, ReportOptions } from './shared.js';

export { FAIL_ON, failsOn } from './shared.js';
export type { CommandResult, FailOn } from './shared.js';

export const DIFF_USAGE = `Usage: bundle-mop diff <base-export> <pr-export> [options]

Diffs two saved \`next analyze export\` files. To compare your branch with main in one step, use
\`bundle-mop compare\`.

  <base-export>, <pr-export>   Output of \`next analyze export\` (.jsonl or .jsonl.gz)
${REPORT_USAGE}`;

function readSnapshot(file: string): AnalyzeSnapshot {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    throw new Error(`cannot read ${file}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`);
  }
  const text = (file.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8');
  try {
    return parseNextAnalyzeExport(text);
  } catch (e) {
    if (e instanceof AdapterError) throw new Error(`${file}: ${e.message}`);
    throw e;
  }
}

export function diffCommand(argv: string[]): CommandResult {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: REPORT_OPTIONS });
  } catch (e) {
    return fail(`${(e as Error).message}\n\n${DIFF_USAGE}`);
  }
  const { values, positionals } = parsed;
  if (values.help) return { code: 0, output: DIFF_USAGE };
  if (positionals.length !== 2) return fail(`Expected 2 export files, got ${positionals.length}.\n\n${DIFF_USAGE}`);

  let opts: ReportOptions;
  try {
    opts = parseReportOptions(values);
  } catch (e) {
    return fail(`${(e as Error).message}\n\n${DIFF_USAGE}`);
  }

  const [baseFile, prFile] = positionals as [string, string];
  try {
    const config = loadBudgets(values.config, [process.cwd()]);
    const a = analyze(readSnapshot(baseFile), readSnapshot(prFile), { minBytes: opts.minBytes, ...(config ? { config } : {}) });
    return { code: failsOn(a.findings, opts.failOn) ? 1 : 0, output: renderReport(a, opts) };
  } catch (e) {
    return fail(`error: ${(e as Error).message}`);
  }
}
