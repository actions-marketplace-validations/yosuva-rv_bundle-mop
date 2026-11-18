import fs from 'node:fs';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { AdapterError, parseNextAnalyzeExport } from '../adapter/index.js';
import type { AnalyzeSnapshot } from '../adapter/index.js';
import { diffSnapshots } from '../model/diff.js';
import { renderMarkdown } from '../report/markdown.js';
import { renderTextDiff } from '../report/text.js';
import { runRules } from '../rules/index.js';

export interface CommandResult {
  code: number;
  output: string;
}

export const DIFF_USAGE = `Usage: bundle-mop diff <base-export> <pr-export> [options]

  <base-export>, <pr-export>   Output of \`next analyze export\` (.jsonl or .jsonl.gz)
  --format <text|markdown|json>  Output format (default text). markdown = PR comment
  --json                       Same as --format json
  --top <n>                    Changed modules listed per route (default 10)
  --min-bytes <n>              Noise floor for rules and the markdown report (default 1000)`;

const FORMATS = ['text', 'markdown', 'json'] as const;
type Format = (typeof FORMATS)[number];

const nonNegInt = (v: string | undefined, fallback: number, flag: string): number => {
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${flag} must be a non-negative integer`);
  return n;
};

class UsageError extends Error {}

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
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean' },
        format: { type: 'string' },
        top: { type: 'string' },
        'min-bytes': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    return { code: 1, output: `${(e as Error).message}\n\n${DIFF_USAGE}` };
  }
  const { values, positionals } = parsed;
  if (values.help) return { code: 0, output: DIFF_USAGE };
  if (positionals.length !== 2) return { code: 1, output: `Expected 2 export files, got ${positionals.length}.\n\n${DIFF_USAGE}` };

  let top: number;
  let minBytes: number;
  let format: Format;
  try {
    top = nonNegInt(values.top, 10, '--top');
    minBytes = nonNegInt(values['min-bytes'], 1_000, '--min-bytes');
    const f = values.json ? 'json' : (values.format ?? 'text');
    if (!(FORMATS as readonly string[]).includes(f)) throw new UsageError(`--format must be one of ${FORMATS.join(', ')}`);
    if (values.json && values.format && values.format !== 'json') throw new UsageError('--json conflicts with --format');
    format = f as Format;
  } catch (e) {
    return { code: 1, output: `${(e as Error).message}\n\n${DIFF_USAGE}` };
  }

  const [baseFile, prFile] = positionals as [string, string];
  try {
    const base = readSnapshot(baseFile);
    const pr = readSnapshot(prFile);
    const diff = diffSnapshots(base, pr);
    const findings = runRules(diff, base, pr, { minBytes });
    const output =
      format === 'json'
        ? JSON.stringify({ ...diff, findings }, null, 2)
        : format === 'markdown'
          ? renderMarkdown(diff, { findings, top, minBytes })
          : renderTextDiff(diff, { top, findings });
    return { code: 0, output };
  } catch (e) {
    return { code: 1, output: `error: ${(e as Error).message}` };
  }
}
