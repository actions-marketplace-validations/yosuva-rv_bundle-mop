/** `64 B`, `61.3 kB` (1 kB = 1000 B, like Next.js). */
export function formatBytes(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  return abs < 1000 ? `${sign}${abs} B` : `${sign}${(abs / 1000).toFixed(1)} kB`;
}

export const formatDelta = (n: number): string => (n > 0 ? `+${formatBytes(n)}` : n === 0 ? '±0 B' : formatBytes(n));
