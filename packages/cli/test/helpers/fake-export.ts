// Builds small, valid `next analyze export` JSONL for edge-case tests. It goes through the real
// adapter (no hand-built AnalyzeSnapshot), so these tests also exercise parsing.
import { parseNextAnalyzeExport } from '../../src/adapter/index.js';
import type { AnalyzeSnapshot } from '../../src/adapter/index.js';

export interface FakePart {
  /** Raw analyzer path, e.g. `[project]/app/page.tsx` or a pnpm/npm node_modules path. */
  path: string;
  size: number;
  compressed?: number;
  /** Put the part in a chunk loaded only by an `async` (next/dynamic) group. */
  lazy?: boolean;
  /** Server-side part (not `[client-fs]`): must be ignored by client sizes. */
  server?: boolean;
  /** Override the chunk filename (to simulate content-hash changes). */
  file?: string;
}

export const pnpm = (name: string, version: string, sub: string) =>
  `[project]/node_modules/.pnpm/${name.replace('/', '+')}@${version}/node_modules/${name}/${sub}`;

export interface FakeModule {
  /** Full ident, e.g. `[project]/app/page.tsx [app-client] (ecmascript)`. Path = text before ` [`. */
  ident: string;
  sync?: string[];
  async?: string[];
}

export interface FakeGraph {
  modules: FakeModule[];
  /** Entry idents per route (entry_kind `server`). */
  entries: Record<string, string[]>;
}

/** `[project]/app/x.tsx` + layer/kind → ident. */
export const ident = (path: string, layer = 'app-client', kind = 'ecmascript') => `${path} [${layer}] (${kind})`;

export function fakeExportText(name: string, routes: Record<string, FakePart[]>, graph?: FakeGraph): string {
  const rec = (r: object) => JSON.stringify(r);
  const routeNames = Object.keys(routes);
  const lines = [
    rec({ type: 'meta', schema_version: 1, snapshot_name: name, module_index_hash: `hash-${name}`, route_count: routeNames.length, selected_routes: routeNames.length }),
    rec({ type: 'module', ident: '[project]/app/layout.tsx [app-rsc] (ecmascript)', path: '[project]/app/layout.tsx', dependencies: { sync: [], async: [], traced: [] } }),
  ];
  for (const m of graph?.modules ?? []) {
    const path = m.ident.slice(0, m.ident.indexOf(' ['));
    lines.push(rec({ type: 'module', ident: m.ident, path, dependencies: { sync: m.sync ?? [], async: m.async ?? [], traced: [] } }));
  }
  for (const [route, parts] of Object.entries(routes)) {
    const fileOf = (p: FakePart) =>
      p.file ?? (p.server ? `[output]/.next/server/app${route}.js` : `[client-fs]/_next/static/chunks/${p.lazy ? 'lazy' : 'main'}.js`);
    const entries = (graph?.entries[route] ?? []).map((e, i) => ({
      route_entry_id: `${route}|${i}`,
      module_ident: e,
      module_path: e.slice(0, e.indexOf(' [')),
      role: 'route',
      entry_kind: 'server',
    }));
    lines.push(rec({ type: 'route', route, entries, coverage: { entries: 'exact', groups: 'exact' } }));
    const files = [...new Set(parts.map(fileOf))];
    for (const f of files) lines.push(rec({ type: 'output', route, filename: f, modules: [], async_loaders: [], coverage: 'exact' }));
    for (const p of parts) {
      lines.push(rec({ type: 'part', route, filename: fileOf(p), source_path: p.path, size: p.size, compressed_size: p.compressed ?? Math.round(p.size / 3) }));
    }
    const eager = [...new Set(parts.filter((p) => !p.lazy && !p.server).map(fileOf))];
    const lazy = [...new Set(parts.filter((p) => p.lazy).map(fileOf))];
    if (eager.length) lines.push(rec({ type: 'group', route, id: 0, kind: 'render_dependent', trigger_module_ident: 'x', trigger_join: 'joined', outputs: eager }));
    if (lazy.length) lines.push(rec({ type: 'group', route, id: 1, kind: 'async', trigger_module_ident: 'y', trigger_join: 'joined', outputs: lazy }));
  }
  return lines.join('\n') + '\n';
}

export const fakeSnapshot = (name: string, routes: Record<string, FakePart[]>, graph?: FakeGraph): AnalyzeSnapshot =>
  parseNextAnalyzeExport(fakeExportText(name, routes, graph));
