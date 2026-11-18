import fs from 'node:fs';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { AdapterError, parseNextAnalyzeExport } from '../adapter/index.js';
import type { AnalyzeSnapshot } from '../adapter/index.js';
import { diffSnapshots } from '../model/diff.js';
import { renderTextDiff } from '../report/text.js';

export interface CommandResult {
  code: number;
  output: string;
}

export const DIFF_USAGE = `Usage: bundle-mop diff <base-export> <pr-export> [--json] [--top <n>]

  <base-export>, <pr-export>   Output of \`next analyze export\` (.jsonl or .jsonl.gz)
  --json                       Print the full diff as JSON
  --top <n>                    Changed modules listed per route (default 10)`;

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
      options: { json: { type: 'boolean' }, top: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    });
  } catch (e) {
    return { code: 1, output: `${(e as Error).message}\n\n${DIFF_USAGE}` };
  }
  const { values, positionals } = parsed;
  if (values.help) return { code: 0, output: DIFF_USAGE };
  if (positionals.length !== 2) return { code: 1, output: `Expected 2 export files, got ${positionals.length}.\n\n${DIFF_USAGE}` };

  const top = values.top === undefined ? 10 : Number(values.top);
  if (!Number.isInteger(top) || top < 0) return { code: 1, output: `--top must be a non-negative integer\n\n${DIFF_USAGE}` };

  const [baseFile, prFile] = positionals as [string, string];
  try {
    const diff = diffSnapshots(readSnapshot(baseFile), readSnapshot(prFile));
    return { code: 0, output: values.json ? JSON.stringify(diff, null, 2) : renderTextDiff(diff, { top }) };
  } catch (e) {
    return { code: 1, output: `error: ${(e as Error).message}` };
  }
}
