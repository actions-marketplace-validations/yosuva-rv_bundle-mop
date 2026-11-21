import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectInstall } from '../src/capture/install.js';

function repo(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-pm-'));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), '');
  }
  return root;
}

describe('detectInstall', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm install --frozen-lockfile'],
    ['package-lock.json', 'npm ci'],
    ['bun.lock', 'bun install --frozen-lockfile'],
    ['bun.lockb', 'bun install --frozen-lockfile'],
    ['yarn.lock', 'yarn install --frozen-lockfile'],
  ])('%s -> %s', (lock, command) => {
    const root = repo([lock]);
    expect(detectInstall(root, root)).toEqual({ dir: root, command, lockfile: lock });
  });

  it('uses --immutable for Yarn Berry', () => {
    const root = repo(['yarn.lock', '.yarnrc.yml']);
    expect(detectInstall(root, root)?.command).toBe('yarn install --immutable');
  });

  it('walks up from the app to a monorepo root lockfile', () => {
    const root = repo(['pnpm-lock.yaml', 'apps/web/package.json']);
    expect(detectInstall(path.join(root, 'apps/web'), root)?.dir).toBe(root);
  });

  it('prefers the closest lockfile', () => {
    const root = repo(['pnpm-lock.yaml', 'apps/web/package-lock.json']);
    expect(detectInstall(path.join(root, 'apps/web'), root)).toMatchObject({ dir: path.join(root, 'apps/web'), command: 'npm ci' });
  });

  it('never looks above the stop directory', () => {
    const outer = repo(['pnpm-lock.yaml', 'repo/app/package.json']);
    expect(detectInstall(path.join(outer, 'repo/app'), path.join(outer, 'repo'))).toBeUndefined();
  });
});
