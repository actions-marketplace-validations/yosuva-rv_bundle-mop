// `bundle-mop compare`: one command to see what your branch does to the bundle, compared with main.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { parseNextAnalyzeExport } from '../adapter/index.js';
import type { AnalyzeSnapshot } from '../adapter/index.js';
import { captureBase } from '../capture/base.js';
import type { Echo } from '../capture/exec.js';
import { defaultBase, gitRoot, isDirty, mergeBase, resolveCommit, tryCommit } from '../capture/git.js';
import { captureSnapshot, resolveNext } from '../capture/snapshot.js';
import { analyze } from '../pipeline.js';
import { fail, failsOn, loadBudgets, parseReportOptions, renderReport, REPORT_OPTIONS, REPORT_USAGE } from './shared.js';
import type { CommandResult, ReportOptions } from './shared.js';

export const COMPARE_USAGE = `Usage: bundle-mop compare [options]

Compares your working tree (uncommitted changes included) with the base branch, like a pull request
would. Run it inside a Next.js 16.4+ app. Your files are not touched; the base is analyzed in a
temporary git worktree and its result is cached by commit.

  --base <ref>                 Branch or commit to compare against (default: the remote's default
                               branch, else main or master). Compared from the merge base.
  --dir <path>                 The Next.js app (default: current directory)
  --install-command <cmd>      Install command for the base checkout (default: from the lockfile)
  --no-cache                   Re-analyze the base even if a cached result exists
  --verbose                    Show install and next analyze output
${REPORT_USAGE}`;

export interface CompareIO {
  /** Progress lines (stderr), kept apart from the report (stdout). */
  progress: (line: string) => void;
}

const defaultIO: CompareIO = { progress: (line) => process.stderr.write(`${line}\n`) };

/** Where base analyses are cached, by commit SHA. Inside node_modules so it's never committed. */
export const cacheDirFor = (appDir: string) => path.join(appDir, 'node_modules', '.cache', 'bundle-mop');

/**
 * Cached export for a commit: gzipped (a large app's export is ~200 MB of JSON, ~10x smaller compressed).
 * Also reads uncompressed `.jsonl` caches written by 0.2.0.
 */
export function readCache(appDir: string, sha: string): string | undefined {
  const dir = cacheDirFor(appDir);
  try {
    const gz = path.join(dir, `${sha}.jsonl.gz`);
    if (fs.existsSync(gz)) return zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
    const plain = path.join(dir, `${sha}.jsonl`);
    if (fs.existsSync(plain)) return fs.readFileSync(plain, 'utf8');
  } catch {
    // unreadable cache: treat as a miss
  }
  return undefined;
}

/** Best-effort: a failed cache write never fails the command. Replaces an old uncompressed entry. */
export function writeCache(appDir: string, sha: string, text: string): void {
  const dir = cacheDirFor(appDir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${sha}.jsonl.gz`), zlib.gzipSync(text, { level: 6 }));
    fs.rmSync(path.join(dir, `${sha}.jsonl`), { force: true });
  } catch {
    // caching is best-effort
  }
}

const seconds = (start: number) => `${((performance.now() - start) / 1000).toFixed(1)}s`;

export async function compareCommand(argv: string[], io: CompareIO = defaultIO): Promise<CommandResult> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        ...REPORT_OPTIONS,
        base: { type: 'string' },
        dir: { type: 'string' },
        'install-command': { type: 'string' },
        'no-cache': { type: 'boolean' },
        verbose: { type: 'boolean' },
      },
    });
  } catch (e) {
    return fail(`${(e as Error).message}\n\n${COMPARE_USAGE}`);
  }
  const { values } = parsed;
  if (values.help) return { code: 0, output: COMPARE_USAGE };

  let opts: ReportOptions;
  try {
    opts = parseReportOptions(values);
  } catch (e) {
    return fail(`${(e as Error).message}\n\n${COMPARE_USAGE}`);
  }

  const echo: Echo = values.verbose ? 'stderr' : 'quiet';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-mop-compare-'));
  try {
    // --- where are we? -----------------------------------------------------------------
    const appDir = path.resolve(values.dir ?? process.cwd());
    if (!fs.existsSync(path.join(appDir, 'package.json'))) {
      throw new Error(`${appDir} has no package.json. Run this inside your Next.js app, or pass --dir.`);
    }
    resolveNext(appDir); // fails early with a clear message if Next is missing or too old
    const root = await gitRoot(appDir);
    const relApp = path.relative(root, appDir);

    const baseRef = values.base ?? (await defaultBase(root));
    if (!baseRef) throw new Error('No main or master branch found. Pass --base <branch>.');
    const head = await tryCommit(root, 'HEAD');
    if (!head) throw new Error('This repository has no commits yet.');
    const tip = await resolveCommit(root, baseRef, () => io.progress(`  … fetching ${baseRef} from origin`));
    const sha = (await mergeBase(root, head, tip)) ?? tip;
    const dirty = await isDirty(root);

    io.progress(
      `bundle-mop compare: ${baseRef} @ ${sha.slice(0, 7)} → ${dirty ? 'your working tree (with uncommitted changes)' : `HEAD @ ${head.slice(0, 7)}`}`,
    );

    // --- your branch -------------------------------------------------------------------
    let t = performance.now();
    const headFile = path.join(tmp, 'head.jsonl');
    await captureSnapshot(appDir, 'bundle-mop-head', headFile, echo);
    io.progress(`  ✓ analyzed your branch (${seconds(t)})`);

    // --- base, from cache if we've seen this commit ------------------------------------
    let base: AnalyzeSnapshot | undefined;
    if (!values['no-cache']) {
      const cached = readCache(appDir, sha);
      if (cached !== undefined) {
        try {
          base = parseNextAnalyzeExport(cached);
          io.progress(`  ✓ base ${sha.slice(0, 7)}: using cached analysis`);
        } catch {
          base = undefined; // corrupt or from an incompatible version: redo it
        }
      }
    }
    if (base === undefined) {
      t = performance.now();
      const baseFile = path.join(tmp, 'base.jsonl');
      await captureBase({
        gitRoot: root,
        relApp,
        sha,
        tmpDir: tmp,
        outFile: baseFile,
        echo,
        ...(values['install-command'] ? { installCommand: values['install-command'] } : {}),
        onInstall: (cmd, where) => io.progress(`  … base ${sha.slice(0, 7)}: installing dependencies (${cmd}${where === '.' ? '' : ` in ${where}`})`),
        onAnalyze: () => io.progress(`  … base ${sha.slice(0, 7)}: analyzing`),
        onCleanupFailed: (dir) => io.progress(`  ! could not remove the temporary checkout ${dir}`),
      });
      const baseText = fs.readFileSync(baseFile, 'utf8');
      base = parseNextAnalyzeExport(baseText);
      writeCache(appDir, sha, baseText);
      io.progress(`  ✓ analyzed base ${sha.slice(0, 7)} (${seconds(t)}; cached for next time)`);
    }

    // --- report ------------------------------------------------------------------------
    const pr = parseNextAnalyzeExport(fs.readFileSync(headFile, 'utf8'));
    base.snapshotName = `${baseRef} @ ${sha.slice(0, 7)}`;
    pr.snapshotName = dirty ? 'working tree' : `HEAD @ ${head.slice(0, 7)}`;
    const config = loadBudgets(values.config, [appDir, root]);
    const a = analyze(base, pr, { minBytes: opts.minBytes, ...(config ? { config } : {}) });
    io.progress('');
    return {
      code: failsOn(a.findings, opts.failOn) ? 1 : 0,
      // Under its own key: the diff already has `base`/`pr` fields that would overwrite it.
      output: renderReport(a, opts, { compare: { base: { ref: baseRef, sha }, head: { sha: head, dirty } } }),
    };
  } catch (e) {
    return fail(`error: ${(e as Error).message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  }
}
