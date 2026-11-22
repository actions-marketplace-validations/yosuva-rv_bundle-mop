import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyze,
  captureBase,
  captureSnapshot,
  COMMENT_MARKER,
  findConfig,
  gitRoot as findGitRoot,
  loadConfig,
  parseNextAnalyzeExport,
  renderMarkdown,
  resolveCommit,
} from 'bundle-mop';
import type { BudgetConfig, Finding } from 'bundle-mop';
import { GitHubApiError, GitHubClient } from './github.js';
import { appendSummary, InputError, log, readInputs, setOutput } from './inputs.js';
import { failureFor, summarize } from './outcome.js';

export interface ActionResult {
  reportPath: string;
  jsonPath: string;
  routesChanged: number;
  largestFirstLoadDelta: number;
  budgetsExceeded: number;
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


export async function runAction(env: NodeJS.ProcessEnv = process.env): Promise<ActionResult> {
  const inputs = readInputs(env);
  const workspace = env.GITHUB_WORKSPACE || process.cwd();
  const tmp = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'bundle-mop-'));
  const event = readEvent(env.GITHUB_EVENT_PATH);
  const pr = event?.pull_request;

  const gitRoot = path.resolve(await findGitRoot(workspace));
  const appDir = path.resolve(workspace, inputs.workingDirectory);
  const relApp = path.relative(gitRoot, appDir);
  if (relApp.startsWith('..') || path.isAbsolute(relApp)) throw new InputError(`working-directory ${appDir} is outside the repository ${gitRoot}`);

  const baseRef = inputs.baseRef ?? pr?.base?.sha;
  if (!baseRef) throw new InputError('Nothing to compare against: run on a pull_request event or set the base-ref input.');

  const prFile = path.join(tmp, 'pr.jsonl');
  const baseFile = path.join(tmp, 'base.jsonl');

  log.group('Bundle Mop: analyze this commit');
  const { nextVersion } = await captureSnapshot(appDir, 'bundle-mop-head', prFile, 'inherit');
  log.endGroup();

  log.group(`Bundle Mop: analyze base (${baseRef})`);
  const baseSha = await resolveCommit(gitRoot, baseRef, () => log.info(`Fetching ${baseRef} from origin`));
  await captureBase({
    gitRoot,
    relApp,
    sha: baseSha,
    tmpDir: tmp,
    outFile: baseFile,
    echo: 'inherit',
    ...(inputs.installCommand ? { installCommand: inputs.installCommand } : {}),
    onInstall: (command, where) => log.info(`Installing base dependencies: ${command} (in ${where})`),
    onCleanupFailed: (dir) => log.warning(`Could not remove worktree ${dir}`),
  });
  log.endGroup();

  // Budgets come from the PR's checkout (JSON only, so nothing executes).
  const configFile = inputs.config ? path.resolve(gitRoot, inputs.config) : findConfig([appDir, gitRoot]);
  let config: BudgetConfig | undefined;
  if (configFile) {
    config = loadConfig(configFile);
    const rel = path.relative(gitRoot, configFile);
    config.source = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replace(/\\/g, '/') : configFile;
    log.info(`Bundle Mop: budgets from ${config.source} (${config.budgets.length} entr${config.budgets.length === 1 ? 'y' : 'ies'})`);
  }

  // Bytes, not strings: a big app's export can exceed V8's ~512 MB string limit.
  const base = parseNextAnalyzeExport(fs.readFileSync(baseFile));
  const head = parseNextAnalyzeExport(fs.readFileSync(prFile));
  const { diff, findings, budgets } = analyze(base, head, { minBytes: inputs.minBytes, ...(config ? { config } : {}) });
  const markdown = renderMarkdown(diff, { findings, budgets, minBytes: inputs.minBytes });

  const reportPath = path.join(tmp, 'bundle-mop.md');
  const jsonPath = path.join(tmp, 'bundle-mop.json');
  fs.writeFileSync(reportPath, markdown);
  fs.writeFileSync(jsonPath, JSON.stringify({ baseSha, nextVersion, ...diff, budgets, findings }, null, 2));
  appendSummary(markdown, env);

  const outcome = summarize(diff, inputs.minBytes);
  const budgetsExceeded = budgets.filter((b) => b.status === 'over').length;
  const result: ActionResult = { reportPath, jsonPath, ...outcome, budgetsExceeded, findings };
  setOutput('report-path', reportPath, env);
  setOutput('json-path', jsonPath, env);
  setOutput('routes-changed', outcome.routesChanged, env);
  setOutput('largest-first-load-delta', outcome.largestFirstLoadDelta, env);
  setOutput('findings', findings.length, env);
  setOutput('budgets-exceeded', budgetsExceeded, env);
  log.info(
    `Bundle Mop: ${outcome.routesChanged} route(s) changed, ${findings.length} finding(s)${config ? `, ${budgetsExceeded} budget(s) exceeded` : ''}. Report: ${reportPath}`,
  );

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
