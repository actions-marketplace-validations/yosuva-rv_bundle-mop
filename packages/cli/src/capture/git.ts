import fs from 'node:fs';
import { exec } from './exec.js';
import type { Echo } from './exec.js';

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

export const git = (args: string[], cwd: string): Promise<string> =>
  exec('git', args, { cwd, capture: true, echo: 'quiet' }).then((s) => s.trim());

/** Repository root containing `dir`. */
export async function gitRoot(dir: string): Promise<string> {
  try {
    return await git(['rev-parse', '--show-toplevel'], dir);
  } catch {
    throw new GitError(`${dir} is not inside a git repository.`);
  }
}

/** Resolves a ref to a commit SHA, or undefined if it doesn't exist locally. */
export async function tryCommit(root: string, ref: string): Promise<string | undefined> {
  try {
    return await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root);
  } catch {
    return undefined;
  }
}

/** Resolves `ref` to a commit, fetching it from origin when it isn't available locally (shallow CI checkouts). */
export async function resolveCommit(root: string, ref: string, onFetch?: () => void): Promise<string> {
  const local = await tryCommit(root, ref);
  if (local) return local;
  onFetch?.();
  try {
    await exec('git', ['fetch', '--no-tags', '--depth=1', 'origin', ref], { cwd: root, echo: 'quiet' });
  } catch {
    throw new GitError(`Can't find "${ref}" locally or on origin.`);
  }
  return git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], root);
}

/**
 * The branch to compare against when none is given: the remote's default branch if known,
 * else the first of origin/main, main, origin/master, master that exists.
 */
export async function defaultBase(root: string): Promise<string | undefined> {
  try {
    const head = await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root);
    if (head) return head;
  } catch {
    // no origin/HEAD
  }
  for (const ref of ['origin/main', 'main', 'origin/master', 'master']) {
    if (await tryCommit(root, ref)) return ref;
  }
  return undefined;
}

/** Commit where `head` branched from `base` (what a pull request is compared against). */
export async function mergeBase(root: string, head: string, base: string): Promise<string | undefined> {
  try {
    return await git(['merge-base', head, base], root);
  } catch {
    return undefined;
  }
}

export async function isDirty(root: string): Promise<boolean> {
  return (await git(['status', '--porcelain', '--untracked-files=no'], root)).length > 0;
}

export async function addWorktree(root: string, dir: string, sha: string, echo: Echo = 'quiet'): Promise<void> {
  await exec('git', ['worktree', 'add', '--detach', dir, sha], { cwd: root, echo });
}

/**
 * Removes a temporary worktree. `git worktree remove` can fail on Windows when node_modules paths
 * exceed MAX_PATH, so fall back to deleting with Node and pruning. Returns false if anything is left.
 */
export async function removeWorktree(root: string, dir: string): Promise<boolean> {
  try {
    await exec('git', ['worktree', 'remove', '--force', dir], { cwd: root, echo: 'quiet' });
  } catch {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    await exec('git', ['worktree', 'prune'], { cwd: root, echo: 'quiet' }).catch(() => undefined);
  }
  return !fs.existsSync(dir);
}
