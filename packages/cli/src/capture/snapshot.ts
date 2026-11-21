import fs from 'node:fs';
import path from 'node:path';
import { exec } from './exec.js';
import type { Echo } from './exec.js';

/** `next analyze export` (JSON Lines) shipped in Next.js 16.4. */
export const MIN_NEXT = [16, 4] as const;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/**
 * Finds `node_modules/next/package.json` in `appDir` or its parents, the way Node looks up packages,
 * but without NODE_PATH or global folders. pnpm sets NODE_PATH for scripts, which could otherwise
 * resolve some other project's `next`.
 */
function findNextPackageJson(appDir: string): string | undefined {
  let dir = path.resolve(appDir);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', 'next', 'package.json');
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Finds the app's own `next` install and checks it can export analyzer data. */
export function resolveNext(appDir: string): { bin: string; version: string } {
  const pkgJson = findNextPackageJson(appDir);
  if (!pkgJson) {
    throw new SnapshotError(
      `Can't find the "next" package from ${appDir}. Run this inside a Next.js app with dependencies installed.`,
    );
  }
  const { version } = JSON.parse(fs.readFileSync(pkgJson, 'utf8')) as { version: string };
  const [major = 0, minor = 0] = version.split('.').map((n) => Number.parseInt(n, 10));
  if (major < MIN_NEXT[0] || (major === MIN_NEXT[0] && minor < MIN_NEXT[1])) {
    throw new SnapshotError(`Next.js ${version} found in ${appDir}; Bundle Mop needs ${MIN_NEXT.join('.')} or newer (for \`next analyze export\`).`);
  }
  return { bin: path.join(path.dirname(pkgJson), 'dist', 'bin', 'next'), version };
}

/** Runs `next analyze --output --snapshot <name>` then `next analyze export --snapshot <name> > outFile`. */
export async function captureSnapshot(appDir: string, name: string, outFile: string, echo: Echo = 'inherit'): Promise<{ nextVersion: string }> {
  const { bin, version } = resolveNext(appDir);
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  await exec(process.execPath, [bin, 'analyze', '--output', '--snapshot', name], { cwd: appDir, env, echo });
  await exec(process.execPath, [bin, 'analyze', 'export', '--snapshot', name], { cwd: appDir, env, echo, stdoutFile: outFile });
  if (!fs.statSync(outFile).size) throw new SnapshotError(`\`next analyze export\` wrote nothing for snapshot "${name}" in ${appDir}.`);
  return { nextVersion: version };
}
