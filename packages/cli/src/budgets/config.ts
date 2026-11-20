// bundle-mop.config.json: per-route size budgets. JSON (not TS/JS) so loading a PR's config
// never executes code.
import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'bundle-mop.config.json';

export type BudgetMetric = 'firstLoad' | 'lazy' | 'client';
export const BUDGET_METRICS: readonly BudgetMetric[] = ['firstLoad', 'lazy', 'client'];

export interface BudgetRule {
  /** Route pattern: exact (`/`), `*` = one segment, `**` = any number of segments. */
  route: string;
  firstLoad?: number;
  lazy?: number;
  client?: number;
}

export interface BudgetConfig {
  budgets: BudgetRule[];
  /** File it was loaded from, for messages. */
  source?: string;
}

export class ConfigError extends Error {
  constructor(message: string, source?: string) {
    super(source ? `${source}: ${message}` : message);
    this.name = 'ConfigError';
  }
}

const UNITS: Record<string, number> = { b: 1, kb: 1000, kib: 1024, mb: 1_000_000, mib: 1_048_576 };

/** `150 kB` → 150000 (1 kB = 1000 B, like Next.js). Also `150kB`, `146.5 KiB`, `2 MB`, or a number of bytes. */
export function parseSize(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value === 'string') {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib)?\s*$/i.exec(value);
    if (m) return Math.round(Number(m[1]) * (UNITS[(m[2] ?? 'b').toLowerCase()] as number));
  }
  throw new Error(`invalid size ${JSON.stringify(value)} (use e.g. "150 kB", "1.5 MB" or a number of bytes)`);
}

export function parseConfig(text: string, source?: string): BudgetConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`invalid JSON: ${(e as Error).message}`, source);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ConfigError('must be a JSON object', source);
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k !== 'budgets' && k !== '$schema') throw new ConfigError(`unknown key "${k}" (expected "budgets")`, source);
  }
  const list = obj.budgets ?? [];
  if (!Array.isArray(list)) throw new ConfigError('"budgets" must be an array', source);

  const budgets = list.map((entry, i): BudgetRule => {
    const at = `budgets[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new ConfigError(`${at} must be an object`, source);
    const e = entry as Record<string, unknown>;
    for (const k of Object.keys(e)) {
      if (k !== 'route' && !(BUDGET_METRICS as readonly string[]).includes(k)) {
        throw new ConfigError(`${at}: unknown key "${k}" (expected route, ${BUDGET_METRICS.join(', ')})`, source);
      }
    }
    if (typeof e.route !== 'string' || !(e.route === '**' || e.route.startsWith('/'))) {
      throw new ConfigError(`${at}.route must be a route pattern starting with "/" (or "**")`, source);
    }
    const rule: BudgetRule = { route: e.route };
    for (const metric of BUDGET_METRICS) {
      if (e[metric] === undefined) continue;
      try {
        rule[metric] = parseSize(e[metric]);
      } catch (err) {
        throw new ConfigError(`${at}.${metric}: ${(err as Error).message}`, source);
      }
    }
    if (!BUDGET_METRICS.some((m) => rule[m] !== undefined)) {
      throw new ConfigError(`${at} sets no limit (add ${BUDGET_METRICS.join(', ')})`, source);
    }
    return rule;
  });

  const config: BudgetConfig = { budgets };
  if (source) config.source = source;
  return config;
}

export function loadConfig(file: string): BudgetConfig {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new ConfigError(`cannot read config: ${(e as NodeJS.ErrnoException).code ?? String(e)}`, file);
  }
  return parseConfig(text, file);
}

/** First `bundle-mop.config.json` found in `dirs` (in order), or undefined. */
export function findConfig(dirs: string[]): string | undefined {
  for (const d of dirs) {
    const f = path.join(d, CONFIG_FILE);
    if (fs.existsSync(f)) return f;
  }
  return undefined;
}

// --- route patterns -------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** `/` exact; `*` one segment (or part of one); `**` any number of segments, including none. */
export function routePattern(pattern: string): RegExp {
  if (pattern === '**') return /^.*$/;
  let re = '';
  for (const seg of pattern.split('/').slice(1)) {
    re += seg === '**' ? '(?:/.*)?' : `/${seg.split('*').map(escapeRe).join('[^/]*')}`;
  }
  return new RegExp(`^${re}$`);
}

export function matchesRoute(pattern: string, route: string): boolean {
  return routePattern(pattern).test(route);
}
