import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '../../..');

interface Manifest {
  name: string;
  description: string;
  inputs: Record<string, { description: string; default?: string }>;
  outputs: Record<string, { description: string }>;
  runs: { using: string; main: string };
}

const manifest = parse(fs.readFileSync(path.join(root, 'action.yml'), 'utf8')) as Manifest;
const source = (f: string) => fs.readFileSync(path.join(root, 'packages/action/src', f), 'utf8');

describe('action.yml', () => {
  it('parses and points at the committed bundle', () => {
    expect(manifest.runs.using).toBe('node24');
    expect(fs.existsSync(path.join(root, manifest.runs.main))).toBe(true);
    expect(typeof manifest.description).toBe('string');
  });

  it('has no apostrophes in descriptions (the Marketplace renders "PR\'s" as "PR s")', () => {
    const descriptions = [
      manifest.description,
      ...Object.values(manifest.inputs).map((i) => i.description),
      ...Object.values(manifest.outputs).map((o) => o.description),
    ];
    for (const d of descriptions) expect(d, d).not.toMatch(/['’]/);
  });

  it('declares exactly the inputs the code reads', () => {
    const read = [...source('inputs.ts').matchAll(/getInput\('([a-z-]+)'/g)].map((m) => m[1]);
    expect(Object.keys(manifest.inputs).sort()).toEqual([...new Set(read)].sort());
    for (const [name, input] of Object.entries(manifest.inputs)) expect(input.description, name).toBeTruthy();
  });

  it('declares exactly the outputs the code sets', () => {
    const set = [...source('run.ts').matchAll(/setOutput\('([a-z-]+)'/g)].map((m) => m[1]);
    expect(Object.keys(manifest.outputs).sort()).toEqual([...new Set(set)].sort());
  });
});
