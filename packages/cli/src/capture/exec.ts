import { spawn } from 'node:child_process';
import fs from 'node:fs';

/**
 * Where a child's output goes:
 * - `inherit`: straight to our stdout/stderr (GitHub Action logs)
 * - `stderr`: both streams to our stderr, keeping stdout clean for the report (CLI --verbose)
 * - `quiet`: buffered; only shown (tail) if the command fails (CLI default)
 */
export type Echo = 'inherit' | 'stderr' | 'quiet';

export interface ExecOptions {
  cwd: string;
  /** Run through the shell (for user-supplied command strings). */
  shell?: boolean;
  /** Write stdout to this file. */
  stdoutFile?: string;
  /** Capture stdout and return it (not echoed). */
  capture?: boolean;
  env?: NodeJS.ProcessEnv;
  echo?: Echo;
}

const TAIL_LINES = 25;

export class ExecError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    /** Last lines of output, when it was buffered (echo: quiet). */
    readonly tail = '',
  ) {
    super(`\`${command}\` failed with exit code ${exitCode}${tail ? `\n\n${tail}` : ''}`);
    this.name = 'ExecError';
  }
}

/** Runs a command and rejects on a non-zero exit. Resolves to captured stdout when `capture` is set. */
export function exec(command: string, args: string[], opts: ExecOptions): Promise<string> {
  const display = [command, ...args].join(' ');
  const echo = opts.echo ?? 'inherit';
  return new Promise((resolve, reject) => {
    const out = opts.stdoutFile ? fs.openSync(opts.stdoutFile, 'w') : undefined;
    const stdout = out ?? (opts.capture || echo === 'quiet' ? 'pipe' : echo === 'stderr' ? 2 : 'inherit');
    const stderr = echo === 'quiet' ? 'pipe' : echo === 'stderr' ? 2 : 'inherit';
    const child = spawn(command, args, {
      cwd: opts.cwd,
      shell: opts.shell ?? false,
      env: opts.env ?? process.env,
      stdio: ['ignore', stdout, stderr],
    });
    let captured = '';
    let log = '';
    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      if (opts.capture) captured += s;
      else log += s;
    });
    child.stderr?.on('data', (d: Buffer) => {
      log += d.toString('utf8');
    });
    const close = () => {
      if (out !== undefined) fs.closeSync(out);
    };
    child.on('error', (e) => {
      close();
      reject(e);
    });
    child.on('close', (code) => {
      close();
      if (code === 0) return resolve(captured);
      const tail = echo === 'quiet' ? log.trimEnd().split(/\r?\n/).slice(-TAIL_LINES).join('\n') : '';
      reject(new ExecError(display, code, tail));
    });
  });
}
