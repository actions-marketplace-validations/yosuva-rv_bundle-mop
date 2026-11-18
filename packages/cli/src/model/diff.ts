// Base-vs-PR diff over normalised snapshots. Keys are SourceRef keys and route paths,
// never chunk filenames (those are content hashes and change with any code change).
import type { AnalyzeSnapshot, ChunkPart, RouteData, SourceKind } from '../adapter/types.js';
import { routeSizes } from './sizes.js';

export type ChangeStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface Delta {
  base: number;
  pr: number;
  delta: number;
}

/** Bytes a source (module or package) contributes to one route's browser JS. */
export interface ContributionDiff {
  /** SourceRef key (`app:…`, `pkg:moment/moment.js`) or, for package rollups, `pkg:<name>`. */
  key: string;
  kind: SourceKind;
  packageName?: string;
  status: ChangeStatus;
  /** Raw bytes in first-load chunks. */
  firstLoad: Delta;
  /** Raw bytes in lazy-only (next/dynamic) chunks. */
  lazy: Delta;
  /** Summed per-part gzip across first-load + lazy. Estimate. */
  compressed: Delta;
  /** pnpm-only: package versions on each side, set only when they differ. */
  versions?: { base: string[]; pr: string[] };
  /** Moved between first-load and lazy (e.g. wrapped in / unwrapped from next/dynamic). */
  movedTo?: 'lazy' | 'firstLoad';
}

export interface RouteDiff {
  route: string;
  status: ChangeStatus;
  /** Next-internal routes such as `/_not-found` and `/_global-error`. */
  isInternal: boolean;
  client: { raw: Delta; compressed: Delta };
  firstLoad: { raw: Delta; compressed: Delta };
  lazy: { raw: Delta; compressed: Delta };
  /** Changed modules only, biggest first-load change first. */
  modules: ContributionDiff[];
  /** Changed packages only (modules rolled up by package name), biggest first-load change first. */
  packages: ContributionDiff[];
}

export interface SnapshotDiff {
  base: { snapshotName: string; moduleIndexHash: string };
  pr: { snapshotName: string; moduleIndexHash: string };
  /** All routes, changed first (biggest first-load change first), then added, removed, unchanged. */
  routes: RouteDiff[];
  summary: { changed: number; added: number; removed: number; unchanged: number };
  /** Adapter warnings from either side, prefixed `base:` / `pr:`. */
  warnings: string[];
}

const delta = (base: number, pr: number): Delta => ({ base, pr, delta: pr - base });

interface Acc {
  key: string;
  kind: SourceKind;
  packageName?: string;
  firstLoad: number;
  lazy: number;
  compressed: number;
  versions: Set<string>;
}

function aggregate(parts: ChunkPart[], keyOf: (p: ChunkPart) => string | undefined): Map<string, Acc> {
  const out = new Map<string, Acc>();
  for (const p of parts) {
    if (!p.isClient) continue;
    const key = keyOf(p);
    if (key === undefined) continue;
    let a = out.get(key);
    if (!a) {
      a = { key, kind: p.source.kind, firstLoad: 0, lazy: 0, compressed: 0, versions: new Set() };
      if (p.source.packageName) a.packageName = p.source.packageName;
      out.set(key, a);
    }
    if (p.isLazy) a.lazy += p.size;
    else a.firstLoad += p.size;
    a.compressed += p.compressedSize;
    if (p.source.packageVersion) a.versions.add(p.source.packageVersion);
  }
  return out;
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

function diffContributions(base: Map<string, Acc>, pr: Map<string, Acc>): ContributionDiff[] {
  const keys = new Set([...base.keys(), ...pr.keys()]);
  const out: ContributionDiff[] = [];
  for (const key of keys) {
    const b = base.get(key);
    const p = pr.get(key);
    const any = (p ?? b) as Acc;
    const d: ContributionDiff = {
      key,
      kind: any.kind,
      status: !b ? 'added' : !p ? 'removed' : 'unchanged',
      firstLoad: delta(b?.firstLoad ?? 0, p?.firstLoad ?? 0),
      lazy: delta(b?.lazy ?? 0, p?.lazy ?? 0),
      compressed: delta(b?.compressed ?? 0, p?.compressed ?? 0),
    };
    if (any.packageName) d.packageName = any.packageName;
    const bv = b?.versions ?? new Set<string>();
    const pv = p?.versions ?? new Set<string>();
    if (b && p && !sameSet(bv, pv)) d.versions = { base: [...bv].sort(), pr: [...pv].sort() };
    if (d.status === 'unchanged' && (d.firstLoad.delta || d.lazy.delta || d.compressed.delta || d.versions)) {
      d.status = 'changed';
    }
    if (b && p) {
      if (b.firstLoad > 0 && p.firstLoad === 0 && p.lazy > 0) d.movedTo = 'lazy';
      else if (b.lazy > 0 && p.lazy === 0 && p.firstLoad > 0) d.movedTo = 'firstLoad';
    }
    if (d.status !== 'unchanged') out.push(d);
  }
  return out.sort(
    (x, y) =>
      Math.abs(y.firstLoad.delta) - Math.abs(x.firstLoad.delta) ||
      Math.abs(y.lazy.delta) - Math.abs(x.lazy.delta) ||
      x.key.localeCompare(y.key),
  );
}

const EMPTY_ROUTE = (route: string): RouteData => ({
  route,
  entries: [],
  outputs: [],
  parts: [],
  groups: [],
  coverage: { entries: 'exact', groups: 'exact' },
});

export function diffRoute(route: string, base: RouteData | undefined, pr: RouteData | undefined): RouteDiff {
  const bs = routeSizes(base ?? EMPTY_ROUTE(route));
  const ps = routeSizes(pr ?? EMPTY_ROUTE(route));
  const bParts = base?.parts ?? [];
  const pParts = pr?.parts ?? [];
  const modules = diffContributions(aggregate(bParts, (p) => p.source.key), aggregate(pParts, (p) => p.source.key));
  const byPackage = (p: ChunkPart) => (p.source.packageName ? `pkg:${p.source.packageName}` : undefined);
  const packages = diffContributions(aggregate(bParts, byPackage), aggregate(pParts, byPackage));

  const sizes = (k: 'client' | 'firstLoad' | 'lazy') => ({
    raw: delta(bs[k].raw, ps[k].raw),
    compressed: delta(bs[k].compressed, ps[k].compressed),
  });
  const client = sizes('client');
  const status: ChangeStatus = !base
    ? 'added'
    : !pr
      ? 'removed'
      : modules.length || client.raw.delta || client.compressed.delta
        ? 'changed'
        : 'unchanged';

  return {
    route,
    status,
    isInternal: route.startsWith('/_'),
    client,
    firstLoad: sizes('firstLoad'),
    lazy: sizes('lazy'),
    modules,
    packages,
  };
}

const STATUS_ORDER: Record<ChangeStatus, number> = { changed: 0, added: 1, removed: 2, unchanged: 3 };

export function diffSnapshots(base: AnalyzeSnapshot, pr: AnalyzeSnapshot): SnapshotDiff {
  const names = new Set([...base.routes.keys(), ...pr.routes.keys()]);
  const routes = [...names]
    .map((r) => diffRoute(r, base.routes.get(r), pr.routes.get(r)))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        Math.abs(b.firstLoad.raw.delta) - Math.abs(a.firstLoad.raw.delta) ||
        a.route.localeCompare(b.route),
    );
  const summary = { changed: 0, added: 0, removed: 0, unchanged: 0 };
  for (const r of routes) summary[r.status]++;
  return {
    base: { snapshotName: base.snapshotName, moduleIndexHash: base.moduleIndexHash },
    pr: { snapshotName: pr.snapshotName, moduleIndexHash: pr.moduleIndexHash },
    routes,
    summary,
    warnings: [...base.warnings.map((w) => `base: ${w}`), ...pr.warnings.map((w) => `pr: ${w}`)],
  };
}
