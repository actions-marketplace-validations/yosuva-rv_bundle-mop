import { describe, expect, it } from 'vitest';
import { run, VERSION } from '../src/index.js';

describe('cli smoke', () => {
  it('prints help with no args', () => {
    const r = run([]);
    expect(r.code).toBe(0);
    expect(r.output).toContain('bundle-mop');
  });

  it('prints version', () => {
    expect(run(['--version'])).toEqual({ code: 0, output: VERSION });
  });

  it('fails on unknown command', () => {
    expect(run(['nope']).code).toBe(1);
  });

  it('VERSION matches package.json and the CHANGELOG has an entry for it', async () => {
    const fs = await import('node:fs');
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
    const changelog = fs.readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
    expect(changelog).toContain(`## ${VERSION}`);
  });
});
