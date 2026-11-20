/**
 * `64 B`, `61.3 kB`, `1.04 MB` (1 kB = 1000 B, 1 MB = 1000 kB, like Next.js).
 * MB gets two decimals so sizes near a 1 MB budget stay distinguishable.
 */
export function formatBytes(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1000) return `${sign}${abs} B`;
  // Switch at the point where kB would round up to "1000.0 kB".
  if (abs < 999_950) return `${sign}${(abs / 1000).toFixed(1)} kB`;
  return `${sign}${(abs / 1_000_000).toFixed(2)} MB`;
}

export const formatDelta = (n: number): string => (n > 0 ? `+${formatBytes(n)}` : n === 0 ? '±0 B' : formatBytes(n));
