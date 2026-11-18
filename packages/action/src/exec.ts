import { spawn } from 'node:child_process';
import fs from 'node:fs';

export interface ExecOptions {
  cwd: string;
  /** Run through the shell (for user-supplied command strings). */
  shell?: boolean;
  /** Write stdout to this file instead of the log. */
  stdoutFile?: string;
  /** Capture stdout and return it. */
  capture?: boolean;
  env?: NodeJS.ProcessEnv;
}

export class ExecError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
  ) {
    super(`\`${command}\` failed with exit code ${exitCode}`);
    this.name = 'ExecError';
  }
}

/** Runs a command, streaming stderr (and stdout unless redirected) to the log. Rejects on non-zero exit. */
export function exec(command: string, args: string[], opts: ExecOptions): Promise<string> {
  const display = [command, ...args].join(' ');
  return new Promise((resolve, reject) => {
    const out = opts.stdoutFile ? fs.openSync(opts.stdoutFile, 'w') : undefined;
    const child = spawn(command, args, {
      cwd: opts.cwd,
      shell: opts.shell ?? false,
      env: opts.env ?? process.env,
      stdio: ['ignore', out ?? (opts.capture ? 'pipe' : 'inherit'), 'inherit'],
    });
    let captured = '';
    child.stdout?.on('data', (d: Buffer) => {
      captured += d.toString('utf8');
    });
    child.on('error', (e) => {
      if (out !== undefined) fs.closeSync(out);
      reject(e);
    });
    child.on('close', (code) => {
      if (out !== undefined) fs.closeSync(out);
      if (code === 0) resolve(captured);
      else reject(new ExecError(display, code));
    });
  });
}
