// Minimal stand-in for @actions/core input/output handling (zero runtime dependencies).
import fs from 'node:fs';

export type FailOn = 'none' | 'info' | 'warning' | 'error';

export interface ActionInputs {
  workingDirectory: string;
  baseRef?: string;
  installCommand?: string;
  minBytes: number;
  comment: boolean;
  failOn: FailOn;
  githubToken?: string;
  /** Budgets file (relative to the repository root, or absolute). */
  config?: string;
}

export class InputError extends Error {}

/** GitHub passes `with:` values as INPUT_<NAME> (uppercased, spaces → _, hyphens kept). */
export function getInput(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();
}

const bool = (name: string, raw: string): boolean => {
  if (['true', 'yes', '1', 'on'].includes(raw.toLowerCase())) return true;
  if (['false', 'no', '0', 'off'].includes(raw.toLowerCase())) return false;
  throw new InputError(`Input "${name}" must be true or false, got "${raw}"`);
};

export function readInputs(env: NodeJS.ProcessEnv = process.env): ActionInputs {
  const minRaw = getInput('min-bytes', env) || '1000';
  const minBytes = Number(minRaw);
  if (!Number.isInteger(minBytes) || minBytes < 0) throw new InputError(`Input "min-bytes" must be a non-negative integer, got "${minRaw}"`);

  const failOn = (getInput('fail-on', env) || 'error').toLowerCase();
  if (!['none', 'info', 'warning', 'error'].includes(failOn)) {
    throw new InputError(`Input "fail-on" must be one of none, info, warning, error; got "${failOn}"`);
  }

  const inputs: ActionInputs = {
    workingDirectory: getInput('working-directory', env) || '.',
    minBytes,
    comment: bool('comment', getInput('comment', env) || 'true'),
    failOn: failOn as FailOn,
  };
  const baseRef = getInput('base-ref', env);
  if (baseRef) inputs.baseRef = baseRef;
  const installCommand = getInput('install-command', env);
  if (installCommand) inputs.installCommand = installCommand;
  const token = getInput('github-token', env);
  if (token) inputs.githubToken = token;
  const config = getInput('config', env);
  if (config) inputs.config = config;
  return inputs;
}

// --- workflow commands ----------------------------------------------------------

const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export const log = {
  info: (msg: string) => console.log(msg),
  warning: (msg: string) => console.log(`::warning::${escapeData(msg)}`),
  error: (msg: string) => console.log(`::error::${escapeData(msg)}`),
  group: (title: string) => console.log(`::group::${title}`),
  endGroup: () => console.log('::endgroup::'),
};

/** Appends `name=value` to $GITHUB_OUTPUT (multiline-safe). No-op outside Actions. */
export function setOutput(name: string, value: string | number, env: NodeJS.ProcessEnv = process.env): void {
  const file = env.GITHUB_OUTPUT;
  if (!file) return;
  const v = String(value);
  const delim = `bundle_mop_${Math.random().toString(36).slice(2)}`;
  fs.appendFileSync(file, v.includes('\n') ? `${name}<<${delim}\n${v}\n${delim}\n` : `${name}=${v}\n`);
}

/** Appends markdown to the job summary. No-op outside Actions. */
export function appendSummary(markdown: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = env.GITHUB_STEP_SUMMARY;
  if (file) fs.appendFileSync(file, `${markdown}\n`);
}
