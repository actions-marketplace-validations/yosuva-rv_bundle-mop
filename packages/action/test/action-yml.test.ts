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

describe('workflows', () => {
  const dir = path.join(root, '.github/workflows');
  it.each(fs.readdirSync(dir).filter((f) => f.endsWith('.yml')))('%s is valid YAML with jobs', (file) => {
    const wf = parse(fs.readFileSync(path.join(dir, file), 'utf8')) as { on: unknown; jobs: Record<string, unknown> };
    expect(wf.on).toBeTruthy();
    expect(Object.keys(wf.jobs).length).toBeGreaterThan(0);
  });

  it('release.yml can publish with trusted publishing and only runs on version tags', () => {
    const wf = parse(fs.readFileSync(path.join(dir, 'release.yml'), 'utf8')) as {
      on: { push: { tags: string[] } };
      jobs: { release: { permissions: Record<string, string>; steps: { with?: Record<string, unknown>; run?: string }[] } };
    };
    expect(wf.on.push.tags).toEqual(['v[0-9]+.[0-9]+.[0-9]+']);
    expect(wf.jobs.release.permissions).toMatchObject({ 'id-token': 'write', contents: 'write' });
    const setupNode = wf.jobs.release.steps.find((s) => s.with?.['registry-url']);
    expect(setupNode?.with).toMatchObject({ 'node-version': 24, 'package-manager-cache': false });
    expect(wf.jobs.release.steps.some((s) => s.run?.includes('npm publish --provenance'))).toBe(true);
  });
});

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
