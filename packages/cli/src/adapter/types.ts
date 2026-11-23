// Normalised model of a `next analyze export` snapshot.
// Everything outside src/adapter/ works with these types, never with raw JSONL.

/**
 * `internal`: framework code with no package path (`[turbopack]/…` runtime, `[next]/…` generated modules,
 * `.next-internal/…`). `generated`: build output referenced by its own hashed filename (`[client-fs]/…`).
 */
export type SourceKind = 'app' | 'workspace' | 'package' | 'external' | 'internal' | 'generated' | 'unknown';

/** What kind of file an output is, from its extension. Only `js` counts as JavaScript. */
export type AssetType = 'js' | 'css' | 'font' | 'other';

/** A machine-independent identity for a source file. */
export interface SourceRef {
  /**
   * Stable diff key, e.g. `app:components/DatePicker.tsx`, `pkg:moment/moment.js`,
   * `workspace:packages/ui/src/button.tsx`, `external:path`, `internal:server/app/page/actions.js`.
   * Package keys deliberately omit the version so a version bump is a size change, not a new module.
   */
  key: string;
  kind: SourceKind;
  packageName?: string;
  /** Known for pnpm layouts (from the `.pnpm/<name>@<version>` segment); undefined for npm/yarn. */
  packageVersion?: string;
  /** Path inside the package (packages) or the app/workspace (others). */
  subpath: string;
}

export interface ModuleNode {
  ident: string;
  path: string;
  source: SourceRef;
  /** e.g. `app-client` (browser), `app-ssr`, `app-rsc`. Undefined if the ident has no layer tag. */
  layer?: string;
  /** Kind labels from the ident, e.g. `ecmascript`, `client reference proxy`. */
  kinds: string[];
  /** Trailing ident modifier without brackets, e.g. `locals` (seen on barrel / re-export modules). */
  modifier?: string;
  /** `"use client"` boundary node (`client reference proxy`). */
  isClientBoundary: boolean;
  /** Target of a `next/dynamic` import. */
  isDynamicEntry: boolean;
  isServerComponent: boolean;
  sync: string[];
  async: string[];
  traced: string[];
}

export interface RouteEntry {
  id: string;
  moduleIdent: string;
  modulePath: string;
  role: string;
  /** `server` | `client_bootstrap` seen so far. */
  entryKind: string;
}

export interface ChunkOutput {
  /** Analyzer filename, e.g. `[client-fs]/_next/static/chunks/abc.js`. Content-hashed: never diff on it. */
  file: string;
  modules: string[];
  asyncLoaders: string[];
  /** `exact` | `not_a_chunk` | `unsupported` seen so far. */
  coverage: string;
  assetType: AssetType;
  /** Browser JavaScript: a `[client-fs]` output that is a `.js` file (CSS and fonts are not). */
  isClient: boolean;
  /** Loaded only via `async` (next/dynamic) groups, so not first-load JS. */
  isLazyOnly: boolean;
}

export interface ChunkGroup {
  id: number;
  /** `bootstrap` | `render_dependent` | `async` seen so far. */
  kind: string;
  triggerModuleIdent: string;
  triggerJoin: string;
  outputs: string[];
}

export interface ChunkPart {
  file: string;
  sourcePath: string;
  source: SourceRef;
  /** Minified bytes. Exact (matches `next build`). */
  size: number;
  /** Per-part gzip. Summing these overstates whole-file gzip; treat sums as estimates. */
  compressedSize: number;
  /** From the output file's extension. Fonts and CSS are listed as client files by the analyzer too. */
  assetType: AssetType;
  /**
   * Browser JavaScript: in a `[client-fs]` `.js` output. All JS sizes, diffs and rules use only these parts.
   * (Next's own route-summaries.json also counts CSS and fonts; on shadcn/ui that was ~0.5 MB per route.)
   */
  isClient: boolean;
  isLazy: boolean;
}

export interface RouteData {
  route: string;
  entries: RouteEntry[];
  outputs: ChunkOutput[];
  parts: ChunkPart[];
  groups: ChunkGroup[];
  coverage: { entries: string; groups: string };
}

export interface AnalyzeSnapshot {
  schemaVersion: number;
  snapshotName: string;
  moduleIndexHash: string;
  /** Prefix under `[project]/` where the Next app lives: `''` standalone, `fixtures/basic/` in a monorepo. */
  appRoot: string;
  modules: Map<string, ModuleNode>;
  routes: Map<string, RouteData>;
  /** Non-fatal oddities (unknown record types, coverage gaps). */
  warnings: string[];
}
