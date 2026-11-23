// Context lines shown above a report.
import { frameworkChanges } from '../model/framework.js';
import type { SnapshotDiff } from '../model/diff.js';

export { frameworkChanges } from '../model/framework.js';

/** One sentence, or undefined when no framework version changed. */
export function frameworkNote(diff: SnapshotDiff): string | undefined {
  const changes = frameworkChanges(diff);
  if (!changes.length) return undefined;
  const list = changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join(', ');
  const compiler = changes.some((c) => c.name === 'next');
  return `This PR changes ${list}.${compiler ? ' Compiler and minifier changes can shift the size of every package slightly.' : ''}`;
}
