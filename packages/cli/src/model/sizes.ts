import type { ChunkPart, RouteData } from '../adapter/types.js';

export interface SizePair {
  /** Minified bytes: exact. */
  raw: number;
  /** Sum of per-part gzip: overstates real gzip (up to ~1.9× on multi-part chunks). Show as an estimate. */
  compressed: number;
}

export interface RouteSizes {
  route: string;
  /** All browser JS for the route, lazy chunks included (what `route-summaries.json` reports). */
  client: SizePair;
  /** Browser JS needed before the page is interactive: client minus lazy-only chunks. */
  firstLoad: SizePair;
  /** Chunks loaded only via `next/dynamic` (async groups). */
  lazy: SizePair;
}

export const sumParts = (parts: Iterable<ChunkPart>): SizePair => {
  const total: SizePair = { raw: 0, compressed: 0 };
  for (const p of parts) {
    total.raw += p.size;
    total.compressed += p.compressedSize;
  }
  return total;
};

export function routeSizes(route: RouteData): RouteSizes {
  const client = route.parts.filter((p) => p.isClient);
  return {
    route: route.route,
    client: sumParts(client),
    firstLoad: sumParts(client.filter((p) => !p.isLazy)),
    lazy: sumParts(client.filter((p) => p.isLazy)),
  };
}
