import fs from 'node:fs';
import path from 'node:path';
import { exec } from './exec.js';
import type { Echo } from './exec.js';
import { addWorktree, removeWorktree } from './git.js';
import { detectInstall } from './install.js';
import { captureSnapshot, SnapshotError } from './snapshot.js';

export interface CaptureBaseOptions {
  /** Repository root. */
  gitRoot: string;
  /** App directory relative to the repository root ('' for the root). */
  relApp: string;
  /** Commit to analyze. */
  sha: string;
  /** Scratch directory; the worktree goes in `<tmpDir>/base`. */
  tmpDir: string;
  /** Where to write the export (JSONL). */
  outFile: string;
  /** Override the install command (default: detected from the lockfile). */
  installCommand?: string;
  echo?: Echo;
  /** Progress callbacks (for the CLI's step lines / the Action's log). */
  onInstall?: (command: string, dirInWorktree: string) => void;
  onAnalyze?: () => void;
  onCleanupFailed?: (dir: string) => void;
}

/**
 * Analyzes another commit of the same app: checks it out in a temporary git worktree, installs its
 * dependencies with its own lockfile, runs `next analyze`, and removes the worktree.
 */
export async function captureBase(o: CaptureBaseOptions): Promise<{ nextVersion: string }> {
  const echo = o.echo ?? 'inherit';
  const worktree = path.join(o.tmpDir, 'base');
  await addWorktree(o.gitRoot, worktree, o.sha);
  try {
    const baseApp = path.join(worktree, o.relApp);
    if (!fs.existsSync(path.join(baseApp, 'package.json'))) {
      throw new SnapshotError(`${o.relApp || '.'} has no package.json at ${o.sha.slice(0, 7)}; nothing to compare against.`);
    }
    const detected = detectInstall(baseApp, worktree);
    const dir = detected?.dir ?? worktree;
    const command = o.installCommand ?? detected?.command;
    if (!command) throw new SnapshotError('No lockfile found for the base commit. Pass an install command.');
    o.onInstall?.(command, path.relative(worktree, dir) || '.');
    await exec(command, [], { cwd: dir, shell: true, echo });
    o.onAnalyze?.();
    return await captureSnapshot(baseApp, 'bundle-mop-base', o.outFile, echo);
  } finally {
    if (!(await removeWorktree(o.gitRoot, worktree))) o.onCleanupFailed?.(worktree);
  }
}
