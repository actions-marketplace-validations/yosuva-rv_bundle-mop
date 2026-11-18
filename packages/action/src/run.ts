import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMENT_MARKER, diffSnapshots, parseNextAnalyzeExport, renderMarkdown, runRules } from 'bundle-mop';
import type { Finding } from 'bundle-mop';
import { exec } from './exec.js';
import { GitHubApiError, GitHubClient } from './github.js';
import { appendSummary, InputError, log, readInputs, setOutput } from './inputs.js';
import { failureFor, summarize } from './outcome.js';
import { detectInstall } from './package-manager.js';
import { captureSnapshot, SnapshotError } from './snapshot.js';

export interface ActionResult {
  reportPath: string;
  jsonPath: string;
  routesChanged: number;
  largestFirstLoadDelta: number;
  findings: Finding[];
  comment?: { action: 'created' | 'updated'; url: string };
  /** Set when the step should fail (fail-on). */
  failure?: string;
}

interface PullRequestEvent {
  pull_request?: { number: number; base?: { sha?: string } };
}

function readEvent(file: string | undefined): PullRequestEvent | undefined {
  if (!file || !fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PullRequestEvent;
}

const git = (args: string[], cwd: string) => exec('git', args, { cwd, capture: true }).then((s) => s.trim());

/** Resolves `ref` to a commit, fetching it from origin when the checkout is shallow. */
async function resolveCommit(gitRoot: string, ref: string): Promise<string> {
  try {
    return await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], gitRoot);
  } catch {
    log.info(`Fetching ${ref} from origin`);
    await exec('git', ['fetch', '--no-tags', '--depth=1', 'origin', ref], { cwd: gitRoot });
    return git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], gitRoot);
  }
}

async function captureBase(gitRoot: string, relApp: string, baseSha: string, tmp: string, installCommand: string | undefined, outFile: string) {
  const worktree = path.join(tmp, 'base');
  await exec('git', ['worktree', 'add', '--detach', worktree, baseSha], { cwd: gitRoot });
  try {
    const baseApp = path.join(worktree, relApp);
    if (!fs.existsSync(path.join(baseApp, 'package.json'))) {
      throw new SnapshotError(`${relApp || '.'} has no package.json in the base commit ${baseSha.slice(0, 7)}; nothing to compare against.`);
    }
    const detected = detectInstall(baseApp, worktree);
    const dir = detected?.dir ?? worktree;
    const command = installCommand ?? detected?.command;
    if (!command) throw new SnapshotError('No lockfile found for the base checkout. Set the install-command input.');
    log.info(`Installing base dependencies: ${command} (in ${path.relative(worktree, dir) || '.'})`);
    await exec(command, [], { cwd: dir, shell: true });
    await captureSnapshot(baseApp, 'base', outFile);
  } finally {
    await removeWorktree(gitRoot, worktree);
  }
}

/** `git worktree remove` can fail on Windows (deep node_modules paths exceed MAX_PATH); fall back to fs + prune. */
async function removeWorktree(gitRoot: string, worktree: string) {
  try {
    await exec('git', ['worktree', 'remove', '--force', worktree], { cwd: gitRoot });
  } catch {
    fs.rmSync(worktree, { recursive: true, force: true, maxRetries: 3 });
    await exec('git', ['worktree', 'prune'], { cwd: gitRoot }).catch(() => undefined);
  }
  if (fs.existsSync(worktree)) log.warning(`Could not remove worktree ${worktree}`);
}

export async function runAction(env: NodeJS.ProcessEnv = process.env): Promise<ActionResult> {
  const inputs = readInputs(env);
  const workspace = env.GITHUB_WORKSPACE || process.cwd();
  const tmp = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'bundle-mop-'));
  const event = readEvent(env.GITHUB_EVENT_PATH);
  const pr = event?.pull_request;

  const gitRoot = path.resolve(await git(['rev-parse', '--show-toplevel'], workspace));
  const appDir = path.resolve(workspace, inputs.workingDirectory);
  const relApp = path.relative(gitRoot, appDir);
  if (relApp.startsWith('..') || path.isAbsolute(relApp)) throw new InputError(`working-directory ${appDir} is outside the repository ${gitRoot}`);

  const baseRef = inputs.baseRef ?? pr?.base?.sha;
  if (!baseRef) throw new InputError('Nothing to compare against: run on a pull_request event or set the base-ref input.');

  const prFile = path.join(tmp, 'pr.jsonl');
  const baseFile = path.join(tmp, 'base.jsonl');

  log.group('Bundle Mop: analyze this commit');
  const { nextVersion } = await captureSnapshot(appDir, 'pr', prFile);
  log.endGroup();

  log.group(`Bundle Mop: analyze base (${baseRef})`);
  const baseSha = await resolveCommit(gitRoot, baseRef);
  await captureBase(gitRoot, relApp, baseSha, tmp, inputs.installCommand, baseFile);
  log.endGroup();

  const base = parseNextAnalyzeExport(fs.readFileSync(baseFile, 'utf8'));
  const head = parseNextAnalyzeExport(fs.readFileSync(prFile, 'utf8'));
  const diff = diffSnapshots(base, head);
  const findings = runRules(diff, base, head, { minBytes: inputs.minBytes });
  const markdown = renderMarkdown(diff, { findings, minBytes: inputs.minBytes });

  const reportPath = path.join(tmp, 'bundle-mop.md');
  const jsonPath = path.join(tmp, 'bundle-mop.json');
  fs.writeFileSync(reportPath, markdown);
  fs.writeFileSync(jsonPath, JSON.stringify({ baseSha, nextVersion, ...diff, findings }, null, 2));
  appendSummary(markdown, env);

  const outcome = summarize(diff, inputs.minBytes);
  const result: ActionResult = { reportPath, jsonPath, ...outcome, findings };
  setOutput('report-path', reportPath, env);
  setOutput('json-path', jsonPath, env);
  setOutput('routes-changed', outcome.routesChanged, env);
  setOutput('largest-first-load-delta', outcome.largestFirstLoadDelta, env);
  setOutput('findings', findings.length, env);
  log.info(`Bundle Mop: ${outcome.routesChanged} route(s) changed, ${findings.length} finding(s). Report: ${reportPath}`);

  if (inputs.comment && pr?.number) {
    if (!inputs.githubToken || !env.GITHUB_REPOSITORY) {
      log.warning('No github-token or GITHUB_REPOSITORY; skipping the PR comment. The report is in the job summary.');
    } else {
      const client = new GitHubClient(inputs.githubToken, env.GITHUB_REPOSITORY, env.GITHUB_API_URL || 'https://api.github.com');
      try {
        result.comment = await client.upsertComment(pr.number, markdown, COMMENT_MARKER);
        log.info(`Bundle Mop: ${result.comment.action} comment ${result.comment.url}`);
      } catch (e) {
        if (e instanceof GitHubApiError && (e.status === 403 || e.status === 404)) {
          log.warning(
            `Could not comment on the PR (${e.status}). Pull requests from forks get a read-only token, and the job needs \`permissions: pull-requests: write\`. The report is in the job summary.`,
          );
        } else {
          throw e;
        }
      }
    }
  } else if (inputs.comment) {
    log.info('Not a pull request event: skipping the comment. The report is in the job summary.');
  }

  const failure = failureFor(findings, inputs.failOn);
  if (failure) result.failure = failure;
  return result;
}
