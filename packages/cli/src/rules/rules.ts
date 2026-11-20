import path from 'node:path';
import type { RouteData } from '../adapter/types.js';
import { shortKey } from '../model/chains.js';
import type { ImportChain } from '../model/chains.js';
import type { ContributionDiff } from '../model/diff.js';
import { formatBytes } from '../util/format.js';
import { catalogEntry, DOCS, isFrameworkPackage, isOptimizedByNext } from './catalog.js';
import type { Rule, RuleContext, RouteFinding } from './types.js';

// --- helpers ------------------------------------------------------------------

const grewFirstLoad = (c: ContributionDiff, min: number) => c.firstLoad.delta >= min;

/** Package rollups that grew on this route's first-load by at least `minBytes`. */
const grownPackages = (ctx: RuleContext) =>
  ctx.route.packages.filter((p) => p.packageName && !isFrameworkPackage(p.packageName) && grewFirstLoad(p, ctx.options.minBytes));

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
      if (!p.packageName || isFrameworkPackage(p.packageName) || p.firstLoad.delta < ctx.options.largeBytes) continue;
      if (!chain?.clientBoundary || chain.viaDynamicImport || !chain.importer) continue;

      const steps = chain.steps;
      const importerIdx = steps.findIndex((s) => s.key === chain.importer);
      const parent = importerIdx > 0 ? steps[importerIdx - 1] : undefined;
      const importer = chain.importer;
      let suggestion = `Load the component that uses ${p.packageName} with next/dynamic so it's fetched only when rendered.`;
      if (parent && (parent.kind === 'app' || parent.kind === 'workspace')) {
        const name = componentName(importer);
        suggestion += `\n\n\`\`\`tsx\n// ${shortKey(parent.key)}\nimport dynamic from 'next/dynamic';\nconst ${name} = dynamic(() => import('${importPath(parent.key, importer)}'));\n\`\`\``;
      }
      out.push({
        ruleId: this.id,
        severity: 'info',
        title: `Lazy-load ${shortKey(importer)} to keep ${p.packageName} out of first-load JS`,
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
      const f: RouteFinding = {
        ruleId: this.id,
        severity: 'warning',
        title: `${label} moved from lazy to first-load JS (+${formatBytes(c.firstLoad.delta)})`,
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
