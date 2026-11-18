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
});
