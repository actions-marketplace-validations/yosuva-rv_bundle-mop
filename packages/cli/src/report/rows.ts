// Turns a route's changed modules into report rows, collapsing a package that changed in many
// small files (e.g. lodash/startCase pulling 32 helpers) into one package row.
import type { ContributionDiff, RouteDiff } from '../model/diff.js';

export interface ReportRow extends ContributionDiff {
  /** Package row (many modules of one package) rather than a single module. */
  isPackage: boolean;
  /** Changed modules this row stands for (1 for module rows). */
  moduleCount: number;
}

/** A package with at least this many changed modules on a route becomes one row. */
export const PACKAGE_GROUP_MIN = 3;

export function routeRows(route: RouteDiff, groupMin = PACKAGE_GROUP_MIN): ReportRow[] {
  const byPackage = new Map<string, ContributionDiff[]>();
  for (const m of route.modules) {
    if (!m.packageName) continue;
    const list = byPackage.get(m.packageName);
    if (list) list.push(m);
    else byPackage.set(m.packageName, [m]);
  }

  const grouped = new Set<string>();
  const rows: ReportRow[] = [];
  for (const p of route.packages) {
    const mods = p.packageName ? byPackage.get(p.packageName) : undefined;
    if (!mods || mods.length < groupMin) continue;
    grouped.add(p.packageName as string);
    rows.push({ ...p, isPackage: true, moduleCount: mods.length });
  }
  for (const m of route.modules) {
    if (m.packageName && grouped.has(m.packageName)) continue;
    rows.push({ ...m, isPackage: false, moduleCount: 1 });
  }

  return rows.sort(
    (x, y) =>
      Math.abs(y.firstLoad.delta) - Math.abs(x.firstLoad.delta) ||
      Math.abs(y.lazy.delta) - Math.abs(x.lazy.delta) ||
      x.key.localeCompare(y.key),
  );
}
