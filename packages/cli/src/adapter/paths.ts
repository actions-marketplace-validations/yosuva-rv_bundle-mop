import type { SourceRef } from './types.js';

const PROJECT = '[project]/';
const EXTERNALS = '[externals]/';
const NEXT_INTERNAL = '.next-internal/';
const TURBOPACK = '[turbopack]/';
const NEXT_GENERATED = '[next]/';
const CLIENT_FS = '[client-fs]/';

/**
 * Finds where the Next app lives under `[project]/` by locating its root layout.
 * Returns `''` for a standalone app, or e.g. `fixtures/basic/` inside a monorepo.
 */
export function detectAppRoot(paths: Iterable<string>): string {
  for (const p of paths) {
    if (!p.startsWith(PROJECT) || p.includes('/node_modules/')) continue;
    const m = /^\[project\]\/(.*?)(?:src\/)?app\/layout\.(?:tsx|ts|jsx|js)$/.exec(p);
    if (m) return m[1] ?? '';
  }
  return '';
}

/** Extracts a version from a pnpm virtual-store segment, e.g. `next@16.4.6_@types+node@22._1e2e` → `16.4.6`. */
function pnpmVersion(rel: string, name: string): string | undefined {
  const segs = [...rel.matchAll(/(?:^|\/)\.pnpm\/([^/]+)\/node_modules\//g)];
  const seg = segs.at(-1)?.[1];
  if (!seg) return undefined;
  const encoded = `${name.replace('/', '+')}@`;
  if (!seg.startsWith(encoded)) return undefined;
  const version = seg.slice(encoded.length).split('_')[0];
  return version || undefined;
}

/** Turns an analyzer path (module `path` or part `source_path`) into a machine-independent ref. */
export function normalizePath(path: string, appRoot: string): SourceRef {
  // Some part source paths carry an ident tag, e.g. `…/x.module.css [app-client] (css module)`.
  path = path.replace(/ \[[\w-]+\] \([^()]*\)$/, '');

  if (path.startsWith(EXTERNALS)) {
    const subpath = path.slice(EXTERNALS.length);
    return { key: `external:${subpath}`, kind: 'external', subpath };
  }
  // Turbopack's browser runtime: framework code with stable paths.
  if (path.startsWith(TURBOPACK)) {
    const subpath = `turbopack/${path.slice(TURBOPACK.length)}`;
    return { key: `internal:${subpath}`, kind: 'internal', subpath };
  }
  // Modules Next generates (e.g. next/font CSS). Names end in a config hash that changes between builds:
  // `geist_798ff10f.module.css` → `geist_*.module.css`.
  if (path.startsWith(NEXT_GENERATED)) {
    const subpath = `next/${path.slice(NEXT_GENERATED.length)}`.replace(/_[0-9a-f]{6,}(?=\.)/g, '_*');
    return { key: `internal:${subpath}`, kind: 'internal', subpath };
  }
  // Build output referenced by its own content-hashed filename (runtime chunks, font files).
  // The hash changes with any edit, so all of them in one folder share a key.
  if (path.startsWith(CLIENT_FS)) {
    const rest = path.slice(CLIENT_FS.length);
    const dir = rest.slice(0, rest.lastIndexOf('/') + 1);
    const ext = /\.[a-z0-9]+$/i.exec(rest)?.[0] ?? '';
    const subpath = `${dir}*${ext}`;
    return { key: `generated:${subpath}`, kind: 'generated', subpath };
  }
  if (!path.startsWith(PROJECT)) {
    return { key: `unknown:${path}`, kind: 'unknown', subpath: path };
  }

  const rel = path.slice(PROJECT.length);
  const slashed = `/${rel}`;
  const nm = slashed.lastIndexOf('/node_modules/');
  if (nm !== -1) {
    const segs = slashed.slice(nm + '/node_modules/'.length).split('/');
    const nameLen = segs[0]?.startsWith('@') ? 2 : 1;
    const packageName = segs.slice(0, nameLen).join('/');
    const subpath = segs.slice(nameLen).join('/');
    const ref: SourceRef = { key: `pkg:${packageName}/${subpath}`, kind: 'package', packageName, subpath };
    const packageVersion = pnpmVersion(rel, packageName);
    if (packageVersion) ref.packageVersion = packageVersion;
    return ref;
  }

  if (rel.startsWith(appRoot)) {
    const inApp = rel.slice(appRoot.length);
    if (inApp.startsWith(NEXT_INTERNAL)) {
      const subpath = inApp.slice(NEXT_INTERNAL.length);
      return { key: `internal:${subpath}`, kind: 'internal', subpath };
    }
    return { key: `app:${inApp}`, kind: 'app', subpath: inApp };
  }
  return { key: `workspace:${rel}`, kind: 'workspace', subpath: rel };
}

export interface ParsedIdent {
  layer?: string;
  kinds: string[];
  modifier?: string;
}

// `<path>[?query { ... }] [<layer>] (<kind>, <kind>)[ <modifier>]`. Parsed from the end because
// template idents embed other idents (with their own brackets) in the middle.
const IDENT_TAIL = / \[([\w-]+)\] \(([^()]*)\)(?: <([\w-]+)>)?$/;

export function parseIdent(ident: string): ParsedIdent {
  const m = IDENT_TAIL.exec(ident);
  if (!m) return { kinds: [] };
  const parsed: ParsedIdent = {
    layer: m[1],
    kinds: (m[2] ?? '').split(',').map((k) => k.trim()).filter(Boolean),
  };
  if (m[3]) parsed.modifier = m[3];
  return parsed;
}
