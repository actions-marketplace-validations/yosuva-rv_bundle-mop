import { describe, expect, it } from 'vitest';
import { AdapterError, parseNextAnalyzeExport } from '../src/adapter/index.js';
import type { AnalyzeSnapshot, ModuleNode } from '../src/adapter/index.js';
import { loadSnapshot, readExport } from './helpers/fixtures.js';

const findModule = (snap: AnalyzeSnapshot, pred: (m: ModuleNode) => boolean): ModuleNode => {
  const m = [...snap.modules.values()].find(pred);
  if (!m) throw new Error('module not found');
  return m;
};

describe('adapter: fixtures/basic', () => {
  const snap = loadSnapshot('basic');

  it('reads meta and detects the monorepo app root', () => {
    expect(snap.schemaVersion).toBe(1);
    expect(snap.snapshotName).toBe('base');
    expect(snap.appRoot).toBe('fixtures/basic/');
    expect(snap.modules.size).toBe(1047);
    expect([...snap.routes.keys()].sort()).toEqual(['/', '/_global-error', '/_not-found', '/dashboard']);
    expect(snap.warnings).toEqual([]);
  });

  it('recovers the import chain page -> "use client" boundary -> DatePicker -> moment', () => {
    const boundary = findModule(snap, (m) => m.source.key === 'app:components/DashboardClient.tsx' && m.isClientBoundary);
    expect(boundary.layer).toBe('app-rsc');
    const clientIdent = boundary.sync.find((i) => snap.modules.get(i)?.layer === 'app-client');
    const client = snap.modules.get(clientIdent ?? '');
    expect(client?.source.key).toBe('app:components/DashboardClient.tsx');

    const datePicker = snap.modules.get(client?.sync.find((i) => i.includes('DatePicker.tsx')) ?? '');
    expect(datePicker).toMatchObject({ layer: 'app-client', source: { key: 'app:components/DatePicker.tsx' } });

    const moment = snap.modules.get(datePicker?.sync.find((i) => i.includes('moment.js')) ?? '');
    expect(moment?.source).toMatchObject({ key: 'pkg:moment/moment.js', packageName: 'moment', packageVersion: '2.31.0' });
    expect(moment?.layer).toBe('app-client');
  });

  it('flags server components and normalises part paths', () => {
    const page = findModule(snap, (m) => m.source.key === 'app:app/dashboard/page.tsx' && m.isServerComponent);
    expect(page.layer).toBe('app-rsc');
    const momentPart = snap.routes.get('/dashboard')?.parts.find((p) => p.source.key === 'pkg:moment/moment.js' && p.isClient);
    expect(momentPart).toMatchObject({ size: 61346, compressedSize: 19308, isLazy: false });
  });
});

describe('adapter: fixtures/dynamic-barrel', () => {
  const snap = loadSnapshot('dynamic-barrel');
  const lazy = snap.routes.get('/lazy');

  it('parses without warnings', () => {
    expect(snap.appRoot).toBe('fixtures/dynamic-barrel/');
    expect(snap.warnings).toEqual([]);
  });

  it('marks the next/dynamic entry and its async edge', () => {
    const lc = findModule(snap, (m) => m.source.key === 'app:components/LazyClient.tsx' && m.layer === 'app-client' && !m.isClientBoundary);
    expect(lc.async).toHaveLength(1);
    const heavy = snap.modules.get(lc.async[0] ?? '');
    expect(heavy).toMatchObject({ isDynamicEntry: true, source: { key: 'app:components/ui/Heavy.tsx' } });
  });

  it('marks the barrel <locals> node, including the edge to the tree-shaken re-export', () => {
    const barrel = findModule(snap, (m) => m.source.key === 'app:components/ui/index.ts' && m.layer === 'app-client');
    expect(barrel.modifier).toBe('locals');
    expect(barrel.sync.map((i) => snap.modules.get(i)?.source.key)).toEqual(['app:components/ui/Badge.tsx', 'app:components/ui/Unused.tsx']);
  });

  it('marks moment as lazy (only in the async group chunk)', () => {
    expect(lazy?.groups.filter((g) => g.kind === 'async')).toHaveLength(1);
    const momentParts = lazy?.parts.filter((p) => p.source.key === 'pkg:moment/moment.js' && p.isClient) ?? [];
    expect(momentParts).toHaveLength(1);
    expect(momentParts[0]).toMatchObject({ size: 61346, isLazy: true });
    const momentOutput = lazy?.outputs.find((o) => o.file === momentParts[0]?.file);
    expect(momentOutput?.isLazyOnly).toBe(true);
  });

  it('keeps chunks that belong to no group as non-lazy', () => {
    const grouped = new Set(lazy?.groups.flatMap((g) => g.outputs));
    const ungrouped = lazy?.parts.filter((p) => p.isClient && !grouped.has(p.file)) ?? [];
    expect(ungrouped.length).toBeGreaterThan(0);
    expect(ungrouped.every((p) => !p.isLazy)).toBe(true);
  });
});

describe('adapter: validation', () => {
  const meta = '{"type":"meta","schema_version":1,"snapshot_name":"t","module_index_hash":"h","route_count":0,"selected_routes":0}';

  it('parses a minimal export', () => {
    const snap = parseNextAnalyzeExport(`${meta}\n`);
    expect(snap.routes.size).toBe(0);
    expect(snap.warnings).toEqual([]);
  });

  it('rejects an empty export', () => {
    expect(() => parseNextAnalyzeExport('\n\n')).toThrow(AdapterError);
  });

  it('rejects unknown schema versions unless allowed', () => {
    const v2 = meta.replace('"schema_version":1', '"schema_version":2');
    expect(() => parseNextAnalyzeExport(v2)).toThrow(/unsupported schema_version 2/);
    const snap = parseNextAnalyzeExport(v2, { allowUnknownSchema: true });
    expect(snap.warnings[0]).toMatch(/unsupported schema_version 2/);
  });

  it('reports the line number of malformed JSON (truncated export)', () => {
    expect(() => parseNextAnalyzeExport(`${meta}\n{"type":"module","ident":`)).toThrow(/line 2: invalid JSON/);
  });

  it('reports wrongly typed fields', () => {
    const bad = `${meta}\n{"type":"part","route":"/","filename":"f","source_path":"p","size":"12","compressed_size":1}`;
    expect(() => parseNextAnalyzeExport(bad)).toThrow(/line 2: part\.size must be a number/);
  });

  it('requires meta first', () => {
    expect(() => parseNextAnalyzeExport('{"type":"module"}')).toThrow(/expected a meta record first/);
  });

  it('warns about (but survives) unknown record types', () => {
    const snap = parseNextAnalyzeExport(`${meta}\n{"type":"future_thing","x":1}\n{"type":"future_thing"}`);
    expect(snap.warnings).toContain('ignored 2 record(s) of unknown type "future_thing"');
  });

  it('warns when fewer routes arrive than meta promised (truncated export)', () => {
    const full = readExport('basic');
    const cut = full.slice(0, full.indexOf('{"type":"route","route":"/dashboard"'));
    const snap = parseNextAnalyzeExport(cut);
    expect(snap.warnings.some((w) => /meta says 4 route\(s\) but 3/.test(w))).toBe(true);
  });
});
