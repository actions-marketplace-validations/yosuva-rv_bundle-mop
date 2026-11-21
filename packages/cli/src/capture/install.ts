import fs from 'node:fs';
import path from 'node:path';

export interface InstallPlan {
  /** Directory holding the lockfile (where install runs). */
  dir: string;
  command: string;
  lockfile: string;
}

const LOCKFILES: { file: string; command: (dir: string) => string }[] = [
  { file: 'pnpm-lock.yaml', command: () => 'pnpm install --frozen-lockfile' },
  { file: 'bun.lock', command: () => 'bun install --frozen-lockfile' },
  { file: 'bun.lockb', command: () => 'bun install --frozen-lockfile' },
  {
    file: 'yarn.lock',
    // Yarn Berry (has .yarnrc.yml) uses --immutable; Yarn classic uses --frozen-lockfile.
    command: (dir) => (fs.existsSync(path.join(dir, '.yarnrc.yml')) ? 'yarn install --immutable' : 'yarn install --frozen-lockfile'),
  },
  { file: 'package-lock.json', command: () => 'npm ci' },
];

/**
 * Walks up from `start` to `stop` (inclusive) and returns the install command for the first lockfile found.
 * Monorepos keep the lockfile at the workspace root, above the app directory.
 */
export function detectInstall(start: string, stop: string): InstallPlan | undefined {
  const root = path.resolve(stop);
  let dir = path.resolve(start);
  for (;;) {
    for (const l of LOCKFILES) {
      if (fs.existsSync(path.join(dir, l.file))) return { dir, command: l.command(dir), lockfile: l.file };
    }
    const parent = path.dirname(dir);
    if (dir === root || parent === dir || !dir.startsWith(root)) return undefined;
    dir = parent;
  }
}
