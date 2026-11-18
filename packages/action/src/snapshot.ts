import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { exec } from './exec.js';

/** `next analyze export` (JSON Lines) shipped in Next.js 16.4. */
export const MIN_NEXT = [16, 4] as const;

export class SnapshotError extends Error {}

export function resolveNext(appDir: string): { bin: string; version: string } {
  let pkgJson: string;
  try {
    pkgJson = createRequire(path.join(appDir, 'package.json')).resolve('next/package.json');
  } catch {
    throw new SnapshotError(`Can't find the "next" package from ${appDir}. Install dependencies before this step, and check working-directory.`);
  }
  const { version } = JSON.parse(fs.readFileSync(pkgJson, 'utf8')) as { version: string };
  const [major = 0, minor = 0] = version.split('.').map((n) => Number.parseInt(n, 10));
  if (major < MIN_NEXT[0] || (major === MIN_NEXT[0] && minor < MIN_NEXT[1])) {
    throw new SnapshotError(`Next.js ${version} found in ${appDir}; Bundle Mop needs ${MIN_NEXT.join('.')} or newer (for \`next analyze export\`).`);
  }
  return { bin: path.join(path.dirname(pkgJson), 'dist', 'bin', 'next'), version };
}

/** Runs `next analyze --output --snapshot <name>` then `next analyze export --snapshot <name> > outFile`. */
export async function captureSnapshot(appDir: string, name: string, outFile: string): Promise<{ nextVersion: string }> {
  const { bin, version } = resolveNext(appDir);
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  await exec(process.execPath, [bin, 'analyze', '--output', '--snapshot', name], { cwd: appDir, env });
  await exec(process.execPath, [bin, 'analyze', 'export', '--snapshot', name], { cwd: appDir, env, stdoutFile: outFile });
  if (!fs.statSync(outFile).size) throw new SnapshotError(`\`next analyze export\` wrote nothing for snapshot "${name}" in ${appDir}.`);
  return { nextVersion: version };
}
