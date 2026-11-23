// Import-chain tracing: why is a module in a route's browser bundle?
// BFS from the route's entry modules over sync + async edges gives the shortest chain.
import type { AnalyzeSnapshot, ModuleNode, SourceKind } from '../adapter/types.js';

/** One file in a chain. Consecutive graph nodes for the same file (layers, proxies, `<locals>`) are merged. */
export interface ChainStep {
  key: string;
  kind: SourceKind;
  packageName?: string;
  /** Layer of the last merged node, e.g. `app-rsc`, `app-client`. */
  layer?: string;
  /** This file is a `"use client"` boundary (server → client hop happens here). */
  isClientBoundary: boolean;
  /** Reached through a dynamic import (`next/dynamic` / `import()`). */
  viaDynamicImport: boolean;
  isServerComponent: boolean;
  /** Barrel / re-export module (`<locals>`). */
  isBarrel: boolean;
  /** Raw graph idents merged into this step (debugging). */
  idents: string[];
}

export interface ImportChain {
  route: string;
  /** From the first app/workspace file (Next's entry glue dropped) to the target. */
  steps: ChainStep[];
  /** `server` | `client_bootstrap`: the route entry the chain starts from. */
  entryKind: string;
  /** Any hop in the chain is a dynamic import, so the target is lazy along this chain. */
  viaDynamicImport: boolean;
  /** Key of the `"use client"` boundary the chain crosses, if any. */
  clientBoundary?: string;
  /** Last app/workspace file before the chain enters the target's package: where to change the import. */
  importer?: string;
}

interface Visit {
  from?: string;
  async: boolean;
}

/** Shortest-path tree over one route's module graph. Build once per route, query many times. */
export class RouteGraph {
  private readonly parent = new Map<string, Visit>();
  private readonly order: string[] = [];
  private readonly entryKindOf = new Map<string, string>();

  constructor(
    private readonly snapshot: AnalyzeSnapshot,
    readonly route: string,
  ) {
    const data = snapshot.routes.get(route);
    if (!data) throw new Error(`route ${route} not in snapshot ${snapshot.snapshotName}`);
    // Server entries first, so app chains start from the page rather than the client runtime.
    const entries = [...data.entries].sort((a, b) => Number(a.entryKind !== 'server') - Number(b.entryKind !== 'server'));
    for (const e of entries) {
      if (this.parent.has(e.moduleIdent)) continue;
      this.parent.set(e.moduleIdent, { async: false });
      this.entryKindOf.set(e.moduleIdent, e.entryKind);
      this.order.push(e.moduleIdent);
    }
    for (let i = 0; i < this.order.length; i++) {
      const id = this.order[i] as string;
      const m = snapshot.modules.get(id);
      if (!m) continue;
      // Sync before async, so a module only shows a dynamic hop when there's no static path.
      for (const n of m.sync) this.visit(n, id, false);
      for (const n of m.async) this.visit(n, id, true);
    }
  }

  private visit(ident: string, from: string, async: boolean) {
    if (this.parent.has(ident)) return;
    this.parent.set(ident, { from, async });
    this.order.push(ident);
  }

  /** Modules reachable from this route's entries. */
  get size(): number {
    return this.order.length;
  }

  /** Shortest chain to the first module (in BFS order) matching `pred`. */
  chainTo(pred: (m: ModuleNode) => boolean): ImportChain | undefined {
    for (const id of this.order) {
      const m = this.snapshot.modules.get(id);
      if (m && pred(m)) return this.build(id);
    }
    return undefined;
  }

  // First [app-client] module (in BFS order, so on the shortest chain) per source key and per package.
  // Built once on first use: scanning the whole order per query was O(modules × changes), which took
  // ~85 s on shadcn/ui (24k modules, ~1,600 changed modules on each of 33 routes).
  private firstByKey?: Map<string, string>;
  private firstByPackage?: Map<string, string>;

  private index() {
    if (this.firstByKey && this.firstByPackage) return { byKey: this.firstByKey, byPackage: this.firstByPackage };
    const byKey = new Map<string, string>();
    const byPackage = new Map<string, string>();
    for (const id of this.order) {
      const m = this.snapshot.modules.get(id);
      if (!m || m.layer !== 'app-client') continue;
      if (!byKey.has(m.source.key)) byKey.set(m.source.key, id);
      if (m.source.packageName && !byPackage.has(m.source.packageName)) byPackage.set(m.source.packageName, id);
    }
    this.firstByKey = byKey;
    this.firstByPackage = byPackage;
    return { byKey, byPackage };
  }

  /** Why is this source key in the browser bundle? Targets `[app-client]` modules. */
  chainToKey(key: string): ImportChain | undefined {
    const id = this.index().byKey.get(key);
    return id === undefined ? undefined : this.build(id);
  }

  /** Why is this package in the browser bundle? Ends at the module where the chain enters the package. */
  chainToPackage(name: string): ImportChain | undefined {
    const id = this.index().byPackage.get(name);
    return id === undefined ? undefined : this.build(id);
  }

  private build(target: string): ImportChain {
    const nodes: { m: ModuleNode | undefined; ident: string; async: boolean }[] = [];
    let cur: string | undefined = target;
    let entryKind = 'unknown';
    while (cur !== undefined) {
      const v = this.parent.get(cur);
      nodes.unshift({ m: this.snapshot.modules.get(cur), ident: cur, async: v?.async ?? false });
      if (v?.from === undefined) entryKind = this.entryKindOf.get(cur) ?? 'unknown';
      cur = v?.from;
    }

    const steps: ChainStep[] = [];
    for (const { m, ident, async } of nodes) {
      const key = m?.source.key ?? `unknown:${ident}`;
      let step = steps.at(-1);
      if (!step || step.key !== key) {
        step = {
          key,
          kind: m?.source.kind ?? 'unknown',
          isClientBoundary: false,
          viaDynamicImport: false,
          isServerComponent: false,
          isBarrel: false,
          idents: [],
        };
        if (m?.source.packageName) step.packageName = m.source.packageName;
        steps.push(step);
      }
      step.idents.push(ident);
      if (m?.layer) step.layer = m.layer;
      if (async) step.viaDynamicImport = true;
      if (m?.isClientBoundary) step.isClientBoundary = true;
      if (m?.isServerComponent) step.isServerComponent = true;
      if (m?.modifier === 'locals') step.isBarrel = true;
    }

    // Drop Next's entry glue (route templates, runtime) before the first app/workspace file.
    const firstOwn = steps.findIndex((s) => s.kind === 'app' || s.kind === 'workspace');
    const trimmed = firstOwn > 0 ? steps.slice(firstOwn) : steps;

    const chain: ImportChain = {
      route: this.route,
      steps: trimmed,
      entryKind,
      viaDynamicImport: trimmed.some((s) => s.viaDynamicImport),
    };
    const boundary = trimmed.find((s) => s.isClientBoundary);
    if (boundary) chain.clientBoundary = boundary.key;
    const targetPkg = trimmed.at(-1)?.packageName;
    if (targetPkg) {
      const enter = trimmed.findIndex((s) => s.packageName === targetPkg);
      const importer = trimmed
        .slice(0, enter)
        .reverse()
        .find((s) => s.kind === 'app' || s.kind === 'workspace');
      if (importer) chain.importer = importer.key;
    }
    return chain;
  }
}

/** Short display label for a key: `app:components/X.tsx` → `components/X.tsx`, `pkg:moment/moment.js` → `moment/moment.js`. */
export const shortKey = (key: string): string => key.replace(/^(app|pkg|workspace|internal|external|unknown):/, '');

/** One-line rendering: `app/page.tsx → components/X.tsx ("use client") → moment/moment.js`. */
export function formatChain(chain: ImportChain): string {
  return chain.steps
    .map((s) => {
      const tags: string[] = [];
      if (s.viaDynamicImport) tags.push('dynamic import');
      if (s.isClientBoundary) tags.push('"use client"');
      if (s.isBarrel) tags.push('barrel');
      return `${shortKey(s.key)}${tags.length ? ` (${tags.join(', ')})` : ''}`;
    })
    .join(' → ');
}
