import path from 'node:path';
import type { AnalyzeSnapshot, RouteData } from '../adapter/types.js';
import { shortKey } from '../model/chains.js';
import type { ImportChain } from '../model/chains.js';
import type { ContributionDiff } from '../model/diff.js';
import { formatBytes } from '../util/format.js';
import { catalogEntry, DOCS, isFrameworkPackage, isOptimizedByNext } from './catalog.js';
import { graphKnows, isStatic, staticReach } from './graph.js';
import type { Rule, RuleContext, RouteFinding } from './types.js';

// --- helpers ------------------------------------------------------------------

const grewFirstLoad = (c: ContributionDiff, min: number) => c.firstLoad.delta >= min;

/** Source keys of a package's browser JS on a route. */
const packageKeys = (route: RouteData | undefined, name: string) =>
  new Set(route?.parts.filter((p) => p.isClient && p.source.packageName === name).map((p) => p.source.key));

/**
 * Only re-minified by a new Next.js compiler: same version, same files, different bytes.
 * Seen on shadcn/ui's Next 16.4.2 → 16.4.5 PR, where @base-ui/react "grew" 2 kB without changing.
 */
function isCompilerDrift(ctx: RuleContext, p: ContributionDiff): boolean {
  return !!ctx.compilerChanged && sameFiles(ctx, p);
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));

/** Same version and the same files on this route in base and PR. */
function sameFiles(ctx: RuleContext, p: ContributionDiff): boolean {
  if (p.status !== 'changed' || p.versions || !p.packageName) return false;
  return sameSet(packageKeys(ctx.base.routes.get(ctx.route.route), p.packageName), packageKeys(ctx.pr.routes.get(ctx.route.route), p.packageName));
}

/** The package's statically imported files on this route (undefined without a module graph). */
function staticPackageKeys(snap: AnalyzeSnapshot, route: string, name: string): Set<string> | undefined {
  if (!graphKnows(snap, { key: `pkg:${name}`, packageName: name })) return undefined;
  const r = staticReach(snap, route);
  return r && new Set([...r.keys].filter((k) => k.startsWith(`pkg:${name}/`)));
}

/**
 * Only re-chunked: same version, same files, the same files statically imported, but more first-load bytes because
 * the bundler now keeps extra copies in up-front chunks. Seen on Dify, where lazy-loading one component made
 * es-toolkit, @tanstack/hotkeys and foxact "grow" on routes the PR didn't touch.
 */
function isChunkingDrift(ctx: RuleContext, p: ContributionDiff): boolean {
  if (!sameFiles(ctx, p)) return false;
  const name = p.packageName as string;
  const before = staticPackageKeys(ctx.base, ctx.route.route, name);
  const after = staticPackageKeys(ctx.pr, ctx.route.route, name);
  return !!before && !!after && sameSet(before, after);
}

/** Package rollups that grew on this route's first-load by at least `minBytes` (not counting compiler or chunking drift). */
const grownPackages = (ctx: RuleContext) =>
  ctx.route.packages.filter(
    (p) =>
      p.packageName &&
      !isFrameworkPackage(p.packageName) &&
      grewFirstLoad(p, ctx.options.minBytes) &&
      !isCompilerDrift(ctx, p) &&
      !isChunkingDrift(ctx, p),
  );

/**
 * Package name → its browser modules (source keys) that code outside the package imports directly. A barrel import
 * gives one entry (`index.js`) fanning out to many modules; subpath imports give an entry per module.
 */
const entryCache = new WeakMap<AnalyzeSnapshot, Map<string, Set<string>>>();
function packageEntries(snap: AnalyzeSnapshot): Map<string, Set<string>> {
  let out = entryCache.get(snap);
  if (out) return out;
  out = new Map();
  for (const m of snap.modules.values()) {
    if (m.layer !== 'app-client') continue;
    for (const ident of [...m.sync, ...m.async]) {
      const d = snap.modules.get(ident);
      const name = d?.source.packageName;
      if (!d || !name || d.layer !== 'app-client' || name === m.source.packageName) continue;
      let set = out.get(name);
      if (!set) out.set(name, (set = new Set()));
      set.add(d.source.key);
    }
  }
  entryCache.set(snap, out);
  return out;
}

const importedBy = (chain: ImportChain | undefined) => (chain?.importer ? ` Imported by ${shortKey(chain.importer)}.` : '');

const prRoute = (ctx: RuleContext): RouteData | undefined => ctx.pr.routes.get(ctx.route.route);

/** Package name → set of versions shipped as browser JS on a route. */
function packageVersions(route: RouteData | undefined): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const p of route?.parts ?? []) {
    if (!p.isClient || !p.source.packageName || !p.source.packageVersion) continue;
    let s = out.get(p.source.packageName);
    if (!s) out.set(p.source.packageName, (s = new Set()));
    s.add(p.source.packageVersion);
  }
  return out;
}

const componentName = (key: string) => {
  const base = path.posix.basename(shortKey(key)).replace(/\.[jt]sx?$/, '');
  const name = base === 'index' ? path.posix.basename(path.posix.dirname(shortKey(key))) : base;
  const pascal = name.replace(/(^|[-_.\s]+)(\w)/g, (_, __, c: string) => c.toUpperCase());
  return /^[A-Za-z_$]/.test(pascal) ? pascal : `Lazy${pascal}`;
};

/** Relative import specifier from one app file to another, without extension. */
const importPath = (fromKey: string, toKey: string) => {
  let rel = path.posix.relative(path.posix.dirname(shortKey(fromKey)), shortKey(toKey)).replace(/\.[jt]sx?$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
};

const staticReachable = (ctx: RuleContext, c: { key: string; packageName?: string }) => {
  const r = staticReach(ctx.base, ctx.route.route);
  return !!r && isStatic(r, c);
};

/**
 * Code moved into first-load JS, but its static reachability didn't change: Turbopack re-split shared chunks.
 * Only claimed when both module graphs know the code (synthetic or partial exports fall back to the import story).
 * Dify: lazy-loading one component moved copies of `service/use-workflow.ts` (already statically imported) into
 * up-front chunks on 11 unrelated routes.
 */
function chunkingOnly(ctx: RuleContext, c: { key: string; packageName?: string }): boolean {
  if (!graphKnows(ctx.base, c) || !graphKnows(ctx.pr, c)) return false;
  const before = staticReach(ctx.base, ctx.route.route);
  const after = staticReach(ctx.pr, ctx.route.route);
  if (!before || !after) return false;
  return isStatic(before, c) === isStatic(after, c);
}

/** Own browser files on the route that statically import the package, sorted. */
function packageImporters(ctx: RuleContext, pkg: string): string[] {
  const all = staticReach(ctx.pr, ctx.route.route);
  const out = new Set<string>();
  for (const id of all?.idents ?? []) {
    const m = ctx.pr.modules.get(id);
    if (!m || m.layer !== 'app-client' || (m.source.kind !== 'app' && m.source.kind !== 'workspace')) continue;
    if (m.sync.some((d) => ctx.pr.modules.get(d)?.source.packageName === pkg)) out.add(m.source.key);
  }
  return [...out].sort();
}

interface LazyTarget {
  /** The file to load with next/dynamic. */
  key: string;
  /** Browser files that import it statically: each needs the dynamic import. */
  importers: string[];
  /** First-load bytes on the route that only `key` pulls in: the estimated saving. */
  saves: number;
}

/**
 * The file to lazy-load so a package leaves a route's first load: the deepest own file on the chain, below the
 * `"use client"` boundary, that every static path to the package goes through. Undefined if there's none
 * (the package is also imported elsewhere on the route). Dify: lexical came in through note-editor/context.tsx,
 * but editor.tsx and the toolbar import it too; the file to wrap was note-node/index.tsx.
 */
function lazyTarget(ctx: RuleContext, pkg: string, chain: ImportChain): LazyTarget | undefined {
  const route = ctx.route.route;
  const all = staticReach(ctx.pr, route);
  if (!all?.packages.has(pkg)) return undefined;
  const steps = chain.steps;
  const boundary = steps.findIndex((s) => s.isClientBoundary);
  const importer = steps.findIndex((s) => s.key === chain.importer);
  if (boundary < 0 || importer <= boundary) return undefined;
  for (let i = importer; i > boundary; i--) {
    const s = steps[i];
    if (!s || (s.kind !== 'app' && s.kind !== 'workspace')) continue;
    const without = staticReach(ctx.pr, route, s.key);
    if (!without || without.packages.has(pkg)) continue;
    const gone = new Set([...all.keys].filter((k) => !without.keys.has(k)));
    const saves = (prRoute(ctx)?.parts ?? []).filter((p) => p.isClient && !p.isLazy && gone.has(p.source.key)).reduce((n, p) => n + p.size, 0);
    const importers = new Set<string>();
    for (const id of all.idents) {
      const m = ctx.pr.modules.get(id);
      if (!m || m.layer !== 'app-client' || m.source.key === s.key || (m.source.kind !== 'app' && m.source.kind !== 'workspace')) continue;
      if (m.sync.some((d) => ctx.pr.modules.get(d)?.source.key === s.key)) importers.add(m.source.key);
    }
    // The chain's own parent first, so the snippet matches the chain shown in the report.
    const parent = steps[i - 1]?.key;
    const ordered = [...importers].sort((a, b) => Number(b === parent) - Number(a === parent) || a.localeCompare(b));
    return { key: s.key, importers: ordered, saves };
  }
  return undefined;
}

// --- rules --------------------------------------------------------------------

/** Known-heavy package added or grown: suggest a lighter alternative. */
export const heavyPackage: Rule = {
  id: 'heavy-package',
  description: 'A known-heavy package was added to (or grew in) first-load JS; suggests a lighter alternative.',
  check(ctx) {
    const out: RouteFinding[] = [];
    const shipped = new Set(prRoute(ctx)?.parts.filter((p) => p.isClient).map((p) => p.source.key));
    for (const p of grownPackages(ctx)) {
      const entry = catalogEntry(p.packageName as string);
      if (!entry?.swap) continue;
      if (entry.keys && !entry.keys.some((k) => shipped.has(k))) continue;
      const f: RouteFinding = {
        ruleId: this.id,
        severity: 'warning',
        title: `${entry.name} ${p.status === 'added' ? 'adds' : 'grows first-load JS by'} ${formatBytes(p.firstLoad.delta)}${p.status === 'added' ? ' to first-load JS' : ''}`,
        message: `${entry.why ?? ''}${importedBy(p.chain)}`.trim(),
        suggestion: entry.swap,
        subject: p.key,
        packageName: entry.name,
        bytes: p.firstLoad.delta,
      };
      if (p.chain) f.chain = p.chain;
      out.push(f);
    }
    return out;
  },
};

/** Formatting/parsing library pulled into the browser through a "use client" boundary. */
export const serverCandidate: Rule = {
  id: 'server-candidate',
  description: 'A library that usually only formats or parses data reaches the browser through a "use client" boundary.',
  check(ctx) {
    const out: RouteFinding[] = [];
    for (const p of grownPackages(ctx)) {
      const entry = catalogEntry(p.packageName as string);
      const chain = p.chain;
      if (!entry?.serverCandidate || !chain?.clientBoundary || chain.viaDynamicImport) continue;
      const boundary = shortKey(chain.clientBoundary);
      out.push({
        ruleId: this.id,
        severity: 'info',
        title: `${entry.name} runs in the browser because of "use client" in ${boundary}`,
        // Skip "Imported by X" when X is the boundary file itself; it would just repeat the name.
        message: `${entry.name} reaches the browser through the "use client" boundary in ${boundary}.${chain.importer === chain.clientBoundary ? '' : importedBy(chain)} Server Component code isn't sent to the browser.`,
        suggestion: `If the ${entry.name} work only formats or parses data, do it in a Server Component and pass the result to the client component as props. Keep only the interactive part behind "use client".`,
        docs: DOCS.serverComponents,
        subject: p.key,
        packageName: entry.name,
        bytes: p.firstLoad.delta,
        chain,
      });
    }
    return out;
  },
};

/** Large package added to first-load through a client component: suggest next/dynamic. */
export const lazyLoadCandidate: Rule = {
  id: 'lazy-load-candidate',
  description: 'A large package was added to first-load JS through a client component; suggests next/dynamic.',
  check(ctx) {
    const out: RouteFinding[] = [];
    for (const p of ctx.route.packages) {
      const chain = p.chain;
      if (!p.packageName || isFrameworkPackage(p.packageName) || p.firstLoad.delta < ctx.options.largeBytes || isCompilerDrift(ctx, p) || isChunkingDrift(ctx, p)) continue;
      if (!chain?.clientBoundary || chain.viaDynamicImport || !chain.importer) continue;

      const target = lazyTarget(ctx, p.packageName, chain);
      let suggestion: string;
      let splitFrom: string | undefined;
      if (target) {
        // Every static path to the package goes through `target`: lazy-loading it removes the package from first load.
        const files = target.importers;
        suggestion = `Load ${shortKey(target.key)} with next/dynamic so it (and ${p.packageName}) is fetched only when it renders.`;
        if (target.saves > 0) suggestion += ` That moves about ${formatBytes(target.saves)} out of first-load JS on this route.`;
        if (files[0]) {
          suggestion += `\n\n\`\`\`tsx\n// ${shortKey(files[0])}\nimport dynamic from 'next/dynamic';\nconst ${componentName(target.key)} = dynamic(() => import('${importPath(files[0], target.key)}'));\n\`\`\``;
          if (files.length > 1) suggestion += `\n\nChange the import in each file that imports it: ${files.map(shortKey).join(', ')}.`;
        }
      } else {
        // No single file to wrap: a snippet would be a guess (on Dify it named a file that exports a React context).
        // The chain's own importer first, so the list starts where the report's chain ends.
        const files = packageImporters(ctx, p.packageName).sort((a, b) => Number(b === chain.importer) - Number(a === chain.importer));
        const shown = files.slice(0, 5).map(shortKey).join(', ');
        if (files.length === 1 && files[0] === chain.clientBoundary) {
          // The "use client" file imports the package itself (the demo's LastUpdated.tsx → moment): there is
          // nothing below it to wrap, so the package code has to move into its own component first.
          splitFrom = files[0];
          suggestion = `The "use client" file ${shortKey(files[0])} imports ${p.packageName} itself. Move the code that uses ${p.packageName} into a child component, and load that with next/dynamic inside ${shortKey(files[0])}, so ${p.packageName} is fetched only when that part renders.`;
        } else {
          suggestion = `Lazy-load the feature that uses ${p.packageName} with next/dynamic. No single file removes it from this route: ${files.length} ${files.length === 1 ? 'file imports' : 'files import'} it statically (${shown}${files.length > 5 ? ', …' : ''}). Wrap the component that renders the ones you can defer, and measure.`;
        }
      }
      if (target) suggestion += `\n\nThis assumes the file's default export is the component; for a named export use \`import('…').then((m) => m.Name)\`.`;
      out.push({
        ruleId: this.id,
        severity: 'info',
        title: target
          ? `Lazy-load ${shortKey(target.key)} to keep ${p.packageName} out of first-load JS`
          : splitFrom
            ? `Split the ${p.packageName} code out of ${shortKey(splitFrom)} and lazy-load it`
            : `Lazy-load the code that uses ${p.packageName} to keep it out of first-load JS`,
        message: `${p.packageName} adds ${formatBytes(p.firstLoad.delta)} to first-load JS.${importedBy(chain)}`,
        suggestion,
        docs: DOCS.lazyLoading,
        subject: p.key,
        packageName: p.packageName,
        bytes: p.firstLoad.delta,
        chain,
      });
    }
    return out;
  },
};

/** Many modules from one package (barrel imports): suggest optimizePackageImports. */
export const optimizePackageImports: Rule = {
  id: 'optimize-package-imports',
  description: 'Many modules from one package ship (often a barrel import); suggests experimental.optimizePackageImports.',
  check(ctx) {
    const out: RouteFinding[] = [];
    const parts = prRoute(ctx)?.parts.filter((p) => p.isClient) ?? [];
    for (const p of grownPackages(ctx)) {
      const name = p.packageName as string;
      if (isOptimizedByNext(name)) continue;
      const modules = new Set(parts.filter((x) => x.source.packageName === name).map((x) => x.source.key));
      if (modules.size < ctx.options.moduleThreshold) continue;
      // Already imported by subpath (most modules are imported directly from outside the package, e.g. Dify's
      // `@lexical/react/LexicalComposerContext`): there is no barrel for optimizePackageImports to trim.
      const entries = packageEntries(ctx.pr).get(name);
      if (entries && [...modules].filter((k) => entries.has(k)).length * 2 > modules.size) continue;
      const f: RouteFinding = {
        ruleId: this.id,
        severity: 'info',
        title: `${modules.size} modules of ${name} ship to the browser`,
        message: `${name} contributes ${modules.size} modules (${formatBytes(p.firstLoad.pr)} first-load). Importing from its index (barrel) can pull in more than you use.${importedBy(p.chain)}`,
        suggestion: `Import from specific subpaths, or add it to optimizePackageImports (experimental):\n\n\`\`\`js\n// next.config.js\nmodule.exports = { experimental: { optimizePackageImports: ['${name}'] } };\n\`\`\``,
        docs: DOCS.optimizePackageImports,
        subject: p.key,
        packageName: name,
        bytes: p.firstLoad.delta,
      };
      if (p.chain) f.chain = p.chain;
      out.push(f);
    }
    return out;
  },
};

/** A package now ships in two or more versions on a route (pnpm layouts). */
export const duplicatePackage: Rule = {
  id: 'duplicate-package',
  description: 'The same package ships in more than one version on a route (pnpm layouts only).',
  check(ctx) {
    const out: RouteFinding[] = [];
    const before = packageVersions(ctx.base.routes.get(ctx.route.route));
    const after = packageVersions(prRoute(ctx));
    const parts = prRoute(ctx)?.parts.filter((p) => p.isClient) ?? [];
    for (const [name, versions] of after) {
      if (versions.size < 2 || isFrameworkPackage(name)) continue;
      const was = before.get(name) ?? new Set<string>();
      if (was.size === versions.size && [...versions].every((v) => was.has(v))) continue; // not new in this PR
      const list = [...versions].sort();
      const perVersion = list.map((v) => {
        const bytes = parts.filter((x) => x.source.packageName === name && x.source.packageVersion === v).reduce((a, x) => a + x.size, 0);
        return `${v} (${formatBytes(bytes)})`;
      });
      const smallest = Math.min(
        ...list.map((v) => parts.filter((x) => x.source.packageName === name && x.source.packageVersion === v).reduce((a, x) => a + x.size, 0)),
      );
      const pkg = ctx.route.packages.find((p) => p.packageName === name);
      const f: RouteFinding = {
        ruleId: this.id,
        severity: 'warning',
        title: `${name} ships in ${list.length} versions: ${list.join(', ')}`,
        message: `Browser JS on this route includes ${name} ${perVersion.join(' and ')}.`,
        suggestion: `Align the versions so one copy ships: run \`pnpm why ${name}\` to see who depends on each, then upgrade the dependent or add a pnpm override.`,
        subject: `pkg:${name}`,
        packageName: name,
        bytes: smallest,
      };
      if (pkg?.chain) f.chain = pkg.chain;
      out.push(f);
    }
    return out;
  },
};

/** Something that was lazy-loaded in base now ships in first-load JS. */
export const lostLazyLoading: Rule = {
  id: 'lost-lazy-loading',
  description: 'Code that was lazy-loaded in the base branch now ships in first-load JS.',
  check(ctx) {
    const out: RouteFinding[] = [];
    const candidates = [
      ...ctx.route.packages,
      ...ctx.route.modules.filter((m) => m.kind === 'app' || m.kind === 'workspace'),
    ];
    for (const c of candidates) {
      if (c.movedTo !== 'firstLoad' || c.firstLoad.delta < ctx.options.minBytes) continue;
      if (c.packageName && isFrameworkPackage(c.packageName)) continue;
      const label = c.packageName ?? shortKey(c.key);
      const title = `${label} moved from lazy to first-load JS (+${formatBytes(c.firstLoad.delta)})`;
      const f: RouteFinding = chunkingOnly(ctx, c)
        ? {
            // The bytes are real, but no import explains them: blaming one would send people hunting for nothing.
            ruleId: this.id,
            severity: 'info',
            title,
            message: `No import change explains this: ${label} ${staticReachable(ctx, c) ? 'was already imported statically in the base branch' : 'is still only loaded with a dynamic import'}. The bundler now puts a copy of it in a chunk this route loads up front. This is usually a side effect of a change elsewhere, such as a new next/dynamic import that changed how shared code is split.`,
            suggestion: 'Nothing to undo on this route. If the size matters, look at the next/dynamic changes in this PR.',
            docs: DOCS.lazyLoading,
            subject: c.key,
            bytes: c.firstLoad.delta,
          }
        : {
            ruleId: this.id,
            severity: 'warning',
            title,
            message: `${label} was loaded with a dynamic import in the base branch; now a static import pulls it into first-load JS.${importedBy(c.chain)}`,
            suggestion: 'Check whether a next/dynamic wrapper was removed or a new static import was added along the chain below.',
            docs: DOCS.lazyLoading,
            subject: c.key,
            bytes: c.firstLoad.delta,
          };
      if (c.packageName) f.packageName = c.packageName;
      if (c.chain) f.chain = c.chain;
      out.push(f);
    }
    return out;
  },
};

export const BUILTIN_RULES: Rule[] = [heavyPackage, lostLazyLoading, duplicatePackage, serverCandidate, lazyLoadCandidate, optimizePackageImports];
