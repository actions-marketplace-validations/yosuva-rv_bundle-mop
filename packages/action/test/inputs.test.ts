import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getInput, InputError, readInputs, setOutput } from '../src/inputs.js';

describe('inputs', () => {
  it('reads INPUT_ variables like GitHub sets them (hyphens kept)', () => {
    expect(getInput('working-directory', { 'INPUT_WORKING-DIRECTORY': ' apps/web ' })).toBe('apps/web');
  });

  it('applies defaults', () => {
    // fail-on defaults to error: only exceeded budgets produce errors, so nothing fails without a budgets file.
    expect(readInputs({})).toEqual({ workingDirectory: '.', minBytes: 1000, comment: true, failOn: 'error' });
  });

  it('parses all inputs', () => {
    const env = {
      'INPUT_WORKING-DIRECTORY': 'apps/web',
      'INPUT_BASE-REF': 'main',
      'INPUT_INSTALL-COMMAND': 'pnpm i',
      'INPUT_MIN-BYTES': '2500',
      INPUT_COMMENT: 'false',
      'INPUT_FAIL-ON': 'Warning',
      'INPUT_GITHUB-TOKEN': 'tok',
      INPUT_CONFIG: 'apps/web/bundle-mop.config.json',
    };
    expect(readInputs(env)).toEqual({
      config: 'apps/web/bundle-mop.config.json',
      workingDirectory: 'apps/web',
      baseRef: 'main',
      installCommand: 'pnpm i',
      minBytes: 2500,
      comment: false,
      failOn: 'warning',
      githubToken: 'tok',
    });
  });

  it('rejects bad values with the input name', () => {
    expect(() => readInputs({ 'INPUT_MIN-BYTES': '-1' })).toThrow(/min-bytes/);
    expect(() => readInputs({ 'INPUT_FAIL-ON': 'loud' })).toThrow(/fail-on/);
    expect(() => readInputs({ INPUT_COMMENT: 'maybe' })).toThrow(InputError);
  });

  it('writes outputs, including multiline values', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bm-out-')), 'out');
    setOutput('a', 1, { GITHUB_OUTPUT: file });
    setOutput('b', 'x\ny', { GITHUB_OUTPUT: file });
    const text = fs.readFileSync(file, 'utf8');
    expect(text.startsWith('a=1\n')).toBe(true);
    expect(text).toMatch(/b<<(bundle_mop_\w+)\nx\ny\n\1\n/);
  });
});
