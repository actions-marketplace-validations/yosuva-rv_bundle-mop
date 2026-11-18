// The ONLY place that understands raw `next analyze export` JSON Lines.
// Format notes: docs/analyze-format.md (observed on Next.js 16.4.6, schema_version 1).
import { detectAppRoot, normalizePath, parseIdent } from './paths.js';
import type {
  AnalyzeSnapshot,
  ChunkGroup,
  ChunkOutput,
  ChunkPart,
  ModuleNode,
  RouteData,
  RouteEntry,
} from './types.js';

export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

export class AdapterError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = 'AdapterError';
  }
}

export interface ParseOptions {
  /** Parse anyway when `schema_version` is not one we've verified (adds a warning instead of throwing). */
  allowUnknownSchema?: boolean;
}

type Raw = Record<string, unknown>;

// --- field readers ----------------------------------------------------------
const str = (r: Raw, k: string, line: number): string => {
  const v = r[k];
  if (typeof v !== 'string') throw new AdapterError(`${String(r.type)}.${k} must be a string`, line);
  return v;
};
const num = (r: Raw, k: string, line: number): number => {
  const v = r[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new AdapterError(`${String(r.type)}.${k} must be a number`, line);
  return v;
};
const strArr = (r: Raw, k: string, line: number): string[] => {
  const v = r[k];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new AdapterError(`${String(r.type)}.${k} must be a string[]`, line);
  }
  return v;
};
const obj = (r: Raw, k: string, line: number): Raw => {
  const v = r[k];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new AdapterError(`${String(r.type)}.${k} must be an object`, line);
  return v as Raw;
};

// --- raw (pre-normalisation) shapes -----------------------------------------
interface RawModule { ident: string; path: string; sync: string[]; async: string[]; traced: string[] }
interface RawPart { file: string; sourcePath: string; size: number; compressedSize: number }
interface RawRoute {
  route: string;
  seen: boolean;
  entries: RouteEntry[];
  coverage: { entries: string; groups: string };
  outputs: Omit<ChunkOutput, 'isClient' | 'isLazyOnly'>[];
  parts: RawPart[];
  groups: ChunkGroup[];
}

const isClientFile = (file: string) => file.startsWith('[client-fs]/');

/** Parses the full text of `next analyze export` output. */
export function parseNextAnalyzeExport(text: string, options: ParseOptions = {}): AnalyzeSnapshot {
  return parseNextAnalyzeLines(text.split('\n'), options);
}

/** Parses JSONL lines (blank lines ignored). Line numbers in errors are 1-based. */
export function parseNextAnalyzeLines(lines: Iterable<string>, options: ParseOptions = {}): AnalyzeSnapshot {
  const warnings: string[] = [];
  const unknownTypes = new Map<string, number>();
  let meta: { schemaVersion: number; snapshotName: string; moduleIndexHash: string; selectedRoutes: number } | undefined;
  const rawModules: RawModule[] = [];
  const rawRoutes = new Map<string, RawRoute>();

  const routeFor = (route: string): RawRoute => {
    let r = rawRoutes.get(route);
    if (!r) {
      r = { route, seen: false, entries: [], coverage: { entries: 'unknown', groups: 'unknown' }, outputs: [], parts: [], groups: [] };
      rawRoutes.set(route, r);
    }
    return r;
  };

  let lineNo = 0;
  for (const rawLine of lines) {
    lineNo++;
    const text = rawLine.trim();
    if (!text) continue;

    let rec: unknown;
    try {
      rec = JSON.parse(text);
    } catch {
      throw new AdapterError('invalid JSON (truncated export? check the exit code of `next analyze export`)', lineNo);
    }
    if (typeof rec !== 'object' || rec === null || Array.isArray(rec)) throw new AdapterError('record must be a JSON object', lineNo);
    const r = rec as Raw;
    const type = r.type;

    if (type !== 'meta' && !meta) throw new AdapterError(`expected a meta record first, got ${JSON.stringify(type)}`, lineNo);

    switch (type) {
      case 'meta': {
        if (meta) throw new AdapterError('duplicate meta record', lineNo);
        const schemaVersion = num(r, 'schema_version', lineNo);
        if (!(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(schemaVersion)) {
          const msg = `unsupported schema_version ${schemaVersion} (supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}). The Next.js analyzer format changed; see docs/analyze-format.md.`;
          if (!options.allowUnknownSchema) throw new AdapterError(msg, lineNo);
          warnings.push(msg);
        }
        meta = {
          schemaVersion,
          snapshotName: str(r, 'snapshot_name', lineNo),
          moduleIndexHash: str(r, 'module_index_hash', lineNo),
          // `selected_routes` < `route_count` when exported with --route.
          selectedRoutes: r.selected_routes === undefined ? num(r, 'route_count', lineNo) : num(r, 'selected_routes', lineNo),
        };
        break;
      }
      case 'module': {
        const deps = obj(r, 'dependencies', lineNo);
        const dep = (k: string) => (deps[k] === undefined ? [] : strArr(deps, k, lineNo));
        rawModules.push({ ident: str(r, 'ident', lineNo), path: str(r, 'path', lineNo), sync: dep('sync'), async: dep('async'), traced: dep('traced') });
        break;
      }
      case 'route': {
        const route = routeFor(str(r, 'route', lineNo));
        if (route.seen) throw new AdapterError(`duplicate route record for ${route.route}`, lineNo);
        route.seen = true;
        const entries = r.entries;
        if (!Array.isArray(entries)) throw new AdapterError('route.entries must be an array', lineNo);
        route.entries = entries.map((e) => {
          if (typeof e !== 'object' || e === null) throw new AdapterError('route entry must be an object', lineNo);
          const er = e as Raw;
          return {
            id: str(er, 'route_entry_id', lineNo),
            moduleIdent: str(er, 'module_ident', lineNo),
            modulePath: str(er, 'module_path', lineNo),
            role: str(er, 'role', lineNo),
            entryKind: str(er, 'entry_kind', lineNo),
          };
        });
        const cov = obj(r, 'coverage', lineNo);
        route.coverage = { entries: str(cov, 'entries', lineNo), groups: str(cov, 'groups', lineNo) };
        break;
      }
      case 'output':
        routeFor(str(r, 'route', lineNo)).outputs.push({
          file: str(r, 'filename', lineNo),
          modules: strArr(r, 'modules', lineNo),
          asyncLoaders: strArr(r, 'async_loaders', lineNo),
          coverage: str(r, 'coverage', lineNo),
        });
        break;
      case 'part':
        routeFor(str(r, 'route', lineNo)).parts.push({
          file: str(r, 'filename', lineNo),
          sourcePath: str(r, 'source_path', lineNo),
          size: num(r, 'size', lineNo),
          compressedSize: num(r, 'compressed_size', lineNo),
        });
        break;
      case 'group':
        routeFor(str(r, 'route', lineNo)).groups.push({
          id: num(r, 'id', lineNo),
          kind: str(r, 'kind', lineNo),
          triggerModuleIdent: str(r, 'trigger_module_ident', lineNo),
          triggerJoin: str(r, 'trigger_join', lineNo),
          outputs: strArr(r, 'outputs', lineNo),
        });
        break;
      default: {
        const key = String(type);
        unknownTypes.set(key, (unknownTypes.get(key) ?? 0) + 1);
      }
    }
  }

  if (!meta) throw new AdapterError('empty export: no meta record');
  for (const [type, count] of unknownTypes) warnings.push(`ignored ${count} record(s) of unknown type ${JSON.stringify(type)}`);

  // --- normalise ------------------------------------------------------------
  const appRoot = detectAppRoot(rawModules.map((m) => m.path));
  const refCache = new Map<string, ReturnType<typeof normalizePath>>();
  const ref = (p: string) => {
    let v = refCache.get(p);
    if (!v) refCache.set(p, (v = normalizePath(p, appRoot)));
    return v;
  };

  const modules = new Map<string, ModuleNode>();
  for (const m of rawModules) {
    if (modules.has(m.ident)) warnings.push(`duplicate module ident ${m.ident}`);
    const { layer, kinds, modifier } = parseIdent(m.ident);
    const node: ModuleNode = {
      ident: m.ident,
      path: m.path,
      source: ref(m.path),
      kinds,
      isClientBoundary: kinds.includes('client reference proxy'),
      isDynamicEntry: kinds.includes('next/dynamic entry'),
      isServerComponent: kinds.includes('Next.js Server Component'),
      sync: m.sync,
      async: m.async,
      traced: m.traced,
    };
    if (layer !== undefined) node.layer = layer;
    if (modifier !== undefined) node.modifier = modifier;
    modules.set(m.ident, node);
  }

  const routes = new Map<string, RouteData>();
  for (const r of rawRoutes.values()) {
    if (!r.seen) warnings.push(`records for route ${r.route} without a route record`);
    if (r.coverage.entries !== 'exact' || r.coverage.groups !== 'exact') {
      warnings.push(`route ${r.route}: coverage entries=${r.coverage.entries} groups=${r.coverage.groups}; lazy/first-load split may be wrong`);
    }
    const eager = new Set<string>();
    const lazy = new Set<string>();
    for (const g of r.groups) for (const o of g.outputs) (g.kind === 'async' ? lazy : eager).add(o);
    for (const o of eager) lazy.delete(o);

    routes.set(r.route, {
      route: r.route,
      entries: r.entries,
      coverage: r.coverage,
      groups: r.groups,
      outputs: r.outputs.map((o) => ({ ...o, isClient: isClientFile(o.file), isLazyOnly: lazy.has(o.file) })),
      parts: r.parts.map(
        (p): ChunkPart => ({ ...p, source: ref(p.sourcePath), isClient: isClientFile(p.file), isLazy: lazy.has(p.file) }),
      ),
    });
  }

  if (meta.selectedRoutes !== routes.size) {
    warnings.push(`meta says ${meta.selectedRoutes} route(s) but ${routes.size} were exported (truncated export?)`);
  }

  return {
    schemaVersion: meta.schemaVersion,
    snapshotName: meta.snapshotName,
    moduleIndexHash: meta.moduleIndexHash,
    appRoot,
    modules,
    routes,
    warnings,
  };
}
