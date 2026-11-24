// Static-import reachability on a route's module graph: what loads up front no matter how Turbopack splits chunks.
import type { AnalyzeSnapshot } from '../adapter/types.js';

export interface StaticReach {
  /** Graph idents reachable from the route's entries through static (sync) imports only. */
  idents: Set<string>;
  /** Source keys of the browser (`[app-client]`) modules among them. */
  keys: Set<string>;
  /** Packages of the browser modules among them. */
  packages: Set<string>;
}

const full = new WeakMap<AnalyzeSnapshot, Map<string, StaticReach>>();

/**
 * Modules a route reaches through static imports only. With `without`, every module of that source key is skipped,
 * as if it were loaded with next/dynamic: what disappears is what lazy-loading that file would move out of first load.
 * Undefined when the route isn't in the snapshot.
 */
export function staticReach(snap: AnalyzeSnapshot, route: string, without?: string): StaticReach | undefined {
  const data = snap.routes.get(route);
  if (!data) return undefined;
  if (without === undefined) {
    const hit = full.get(snap)?.get(route);
    if (hit) return hit;
  }
  const out: StaticReach = { idents: new Set(), keys: new Set(), packages: new Set() };
  const queue: string[] = [];
  const push = (id: string) => {
    if (out.idents.has(id)) return;
    const m = snap.modules.get(id);
    if (without !== undefined && m?.source.key === without) return;
    out.idents.add(id);
    queue.push(id);
    if (m?.layer === 'app-client') {
      out.keys.add(m.source.key);
      if (m.source.packageName) out.packages.add(m.source.packageName);
    }
  };
  for (const e of data.entries) push(e.moduleIdent);
  for (let i = 0; i < queue.length; i++) for (const n of snap.modules.get(queue[i] as string)?.sync ?? []) push(n);
  if (without === undefined) {
    let byRoute = full.get(snap);
    if (!byRoute) full.set(snap, (byRoute = new Map()));
    byRoute.set(route, out);
  }
  return out;
}

const known = new WeakMap<AnalyzeSnapshot, { keys: Set<string>; packages: Set<string> }>();

/** Browser source keys and packages that appear in the module graph at all (statically or lazily). */
export function graphKnows(snap: AnalyzeSnapshot, keyOrPackage: { key: string; packageName?: string }): boolean {
  let k = known.get(snap);
  if (!k) {
    k = { keys: new Set(), packages: new Set() };
    for (const m of snap.modules.values()) {
      if (m.layer !== 'app-client') continue;
      k.keys.add(m.source.key);
      if (m.source.packageName) k.packages.add(m.source.packageName);
    }
    known.set(snap, k);
  }
  return isPackageRollup(keyOrPackage) ? k.packages.has(keyOrPackage.packageName as string) : k.keys.has(keyOrPackage.key);
}

/** Is this source key (or, for a package rollup `pkg:<name>`, any module of the package) statically reachable? */
export function isStatic(reach: StaticReach, c: { key: string; packageName?: string }): boolean {
  return isPackageRollup(c) ? reach.packages.has(c.packageName as string) : reach.keys.has(c.key);
}

/** Package rollup keys are `pkg:<name>` (scoped names contain one `/`: `pkg:@scope/name`). */
export function isPackageRollup(c: { key: string; packageName?: string }): boolean {
  return !!c.packageName && c.key === `pkg:${c.packageName}`;
}
