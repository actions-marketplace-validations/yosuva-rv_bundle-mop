import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { exec, ExecError } from '../src/capture/exec.js';
import { defaultBase, GitError, isDirty, mergeBase, resolveCommit, tryCommit } from '../src/capture/git.js';
import { cacheDirFor, compareCommand } from '../src/commands/compare.js';
import { renderReport } from '../src/commands/shared.js';
import { main } from '../src/index.js';
import { analyze } from '../src/pipeline.js';
import { loadSnapshot, snapshotDir } from './helpers/fixtures.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-compare-'));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};
const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();

let n = 0;
function repo(branch = 'main'): string {
  const dir = path.join(tmpRoot, `repo${n++}`);
  fs.mkdirSync(dir);
  g(dir, 'init', '-q', '-b', branch);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  g(dir, 'add', '.');
  g(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

/** A folder that looks like a Next app to resolveNext (fake node_modules/next with the given version). */
function fakeApp(dir: string, nextVersion?: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"app","private":true}');
  if (nextVersion) {
    fs.mkdirSync(path.join(dir, 'node_modules/next'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules/next/package.json'), JSON.stringify({ name: 'next', version: nextVersion }));
  }
  return dir;
}

const progress: string[] = [];
const io = { progress: (l: string) => progress.push(l) };

// These spawn many real git/node processes; on Windows (antivirus, OneDrive) that can exceed vitest's 5 s default.
describe('git helpers', { timeout: 30_000 }, () => {
  it('finds the default base, merge base and dirty state', async () => {
    const r = repo('main');
    const first = g(r, 'rev-parse', 'HEAD');
    g(r, 'switch', '-q', '-c', 'feature');
    fs.writeFileSync(path.join(r, 'a.txt'), 'two\n');
    g(r, 'commit', '-q', '-am', 'second');
    const feature = g(r, 'rev-parse', 'HEAD');

    expect(await defaultBase(r)).toBe('main');
    expect(await mergeBase(r, feature, 'main')).toBe(first);
    expect(await tryCommit(r, 'feature')).toBe(feature);
    expect(await tryCommit(r, 'does-not-exist')).toBeUndefined();
    expect(await isDirty(r)).toBe(false);
    fs.writeFileSync(path.join(r, 'a.txt'), 'three\n');
    expect(await isDirty(r)).toBe(true);
  });

  it('falls back to master, and returns undefined without either', async () => {
    expect(await defaultBase(repo('master'))).toBe('master');
    expect(await defaultBase(repo('trunk'))).toBeUndefined();
  });

  it('explains a ref that exists neither locally nor on origin', async () => {
    const r = repo();
    let fetched = false;
    const err = await resolveCommit(r, 'nope', () => (fetched = true)).catch((e: unknown) => e);
    expect(fetched).toBe(true);
    expect(err).toBeInstanceOf(GitError);
    expect((err as Error).message).toBe('Can\'t find "nope" locally or on origin.');
  });
});

describe('exec (quiet)', { timeout: 30_000 }, () => {
  it('hides output on success and shows the tail on failure', async () => {
    const ok = await exec(process.execPath, ['-e', 'console.log("hello")'], { cwd: tmpRoot, echo: 'quiet' });
    expect(ok).toBe('');
    const script = 'for (let i = 1; i <= 40; i++) console.log("line " + i); console.error("boom"); process.exit(3)';
    const err = (await exec(process.execPath, ['-e', script], { cwd: tmpRoot, echo: 'quiet' }).catch((e: unknown) => e)) as ExecError;
    expect(err).toBeInstanceOf(ExecError);
    expect(err.exitCode).toBe(3);
    expect(err.tail.split('\n')).toHaveLength(25);
    expect(err.tail).toContain('boom');
    expect(err.tail).not.toContain('line 1\n');
  });
});

describe('bundle-mop compare: errors a user can hit', { timeout: 30_000 }, () => {
  it('shows help', async () => {
    const r = await compareCommand(['--help'], io);
    expect(r).toMatchObject({ code: 0, output: expect.stringContaining('Usage: bundle-mop compare') });
    expect(r.error).toBeUndefined();
  });

  it('validates options', async () => {
    expect(await compareCommand(['--format', 'html'], io)).toMatchObject({ code: 1, error: true, output: expect.stringContaining('--format must be one of') });
    expect(await compareCommand(['extra'], io)).toMatchObject({ code: 1, error: true });
  });

  it('needs a package.json', async () => {
    const r = await compareCommand(['--dir', tmpRoot], io);
    expect(r).toMatchObject({ code: 1, error: true, output: expect.stringContaining('has no package.json. Run this inside your Next.js app, or pass --dir.') });
  });

  it('needs Next.js installed, and 16.4 or newer', async () => {
    const noNext = fakeApp(path.join(tmpRoot, 'no-next'));
    expect((await compareCommand(['--dir', noNext], io)).output).toContain('Can\'t find the "next" package');
    const old = fakeApp(path.join(tmpRoot, 'old-next'), '15.3.0');
    expect((await compareCommand(['--dir', old], io)).output).toContain('Next.js 15.3.0 found');
  });

  it('needs a git repository', async () => {
    const app = fakeApp(path.join(tmpRoot, 'not-git'), '16.4.6');
    expect((await compareCommand(['--dir', app], io)).output).toContain('is not inside a git repository');
  });

  it('asks for --base when there is no main or master', async () => {
    const r = repo('trunk');
    fakeApp(r, '16.4.6');
    expect((await compareCommand(['--dir', r], io)).output).toBe('error: No main or master branch found. Pass --base <branch>.');
    expect((await compareCommand(['--dir', r, '--base', 'release'], io)).output).toBe('error: Can\'t find "release" locally or on origin.');
  });

  it('caches base analyses inside node_modules', () => {
    expect(cacheDirFor('/x/app')).toBe(path.join('/x/app', 'node_modules', '.cache', 'bundle-mop'));
  });
});

describe('renderReport extra JSON fields', () => {
  const a = analyze(loadSnapshot('basic-before'), loadSnapshot('basic'));
  const opts = { top: 10, minBytes: 1000, format: 'json' as const, failOn: 'error' as const };

  it('keeps both the diff and the extra fields', () => {
    const j = JSON.parse(renderReport(a, opts, { compare: { base: { ref: 'main', sha: 'abc' } } }));
    expect(j.compare.base).toEqual({ ref: 'main', sha: 'abc' });
    expect(j.base.snapshotName).toBe('base'); // the diff's own field is intact
  });

  it('refuses extra fields that would overwrite report fields', () => {
    expect(() => renderReport(a, opts, { base: {} })).toThrow(/extra field\(s\) base would overwrite/);
  });
});

describe('main(): stdout vs stderr', () => {
  const BASE = path.join(snapshotDir('basic-before'), 'export.jsonl.gz');
  const PR = path.join(snapshotDir('basic'), 'export.jsonl.gz');

  it('marks errors (stderr) but not reports, even when a budget fails the run', async () => {
    expect(await main(['diff', BASE])).toMatchObject({ code: 1, error: true });
    const cfg = path.join(tmpRoot, 'tight.json');
    fs.writeFileSync(cfg, JSON.stringify({ budgets: [{ route: '/dashboard', firstLoad: '600 kB' }] }));
    const report = await main(['diff', BASE, PR, '--config', cfg, '--format', 'json']);
    expect(report.code).toBe(1);
    expect(report.error).toBeUndefined();
    expect(JSON.parse(report.output).budgets[0].status).toBe('over');
  });
});
