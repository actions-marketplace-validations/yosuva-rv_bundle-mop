import type { Finding, Severity, SnapshotDiff } from 'bundle-mop';
import type { FailOn } from './inputs.js';

export interface Outcome {
  routesChanged: number;
  largestFirstLoadDelta: number;
}

export function summarize(diff: SnapshotDiff, minBytes: number): Outcome {
  let routesChanged = 0;
  let largestFirstLoadDelta = 0;
  for (const r of diff.routes) {
    if (r.status === 'unchanged') continue;
    const significant =
      r.status !== 'changed' || Math.abs(r.firstLoad.raw.delta) >= minBytes || Math.abs(r.lazy.raw.delta) >= minBytes;
    if (!significant) continue;
    routesChanged++;
    if (!r.isInternal) largestFirstLoadDelta = Math.max(largestFirstLoadDelta, r.firstLoad.raw.delta);
  }
  return { routesChanged, largestFirstLoadDelta };
}

const RANK: Record<Severity, number> = { info: 1, warning: 2, error: 3 };

/** Message explaining why the step fails, or undefined when it passes. */
export function failureFor(findings: Finding[], failOn: FailOn): string | undefined {
  if (failOn === 'none') return undefined;
  const hits = findings.filter((f) => RANK[f.severity] >= RANK[failOn]);
  if (!hits.length) return undefined;
  return `${hits.length} finding${hits.length === 1 ? '' : 's'} at or above "${failOn}" (fail-on): ${hits.map((f) => f.title).join('; ')}`;
}
