// Known-heavy packages and lighter alternatives. Keep claims conservative and checkable.

export interface CatalogEntry {
  name: string;
  /** Only fire when one of these module keys ships (e.g. lodash's full build). Default: any module of the package. */
  keys?: string[];
  /** Why it's heavy. */
  why?: string;
  /** Suggested replacement, one line. */
  swap?: string;
  /** Typically used for formatting/parsing that can run in a Server Component instead of the browser. */
  serverCandidate?: boolean;
}

export const HEAVY_PACKAGES: CatalogEntry[] = [
  {
    name: 'moment',
    why: 'moment is a legacy project in maintenance mode, and its single object API cannot be tree-shaken.',
    swap: 'Use dayjs (similar API), date-fns (tree-shakeable; optimized by Next by default), or Intl.DateTimeFormat for plain formatting.',
    serverCandidate: true,
  },
  {
    name: 'moment-timezone',
    why: 'moment-timezone bundles moment plus time zone data.',
    swap: 'Use Intl.DateTimeFormat with the timeZone option, or date-fns with @date-fns/tz.',
    serverCandidate: true,
  },
  {
    name: 'lodash',
    keys: ['pkg:lodash/lodash.js'],
    why: 'The full lodash build ships when it is imported as a whole (e.g. `import _ from "lodash"`).',
    swap: 'Use named imports (`import { debounce } from "lodash"`), which Next rewrites to per-method imports, or lodash-es, or native methods.',
  },
  {
    name: 'underscore',
    why: 'underscore ships as one bundle.',
    swap: 'Most helpers have native equivalents (Array.prototype.map/filter/find, Object.entries, structuredClone).',
  },
  {
    name: 'jquery',
    why: 'jQuery duplicates work React already does.',
    swap: 'Use React state/refs and native DOM APIs (querySelector, fetch, classList).',
  },
  { name: 'luxon', serverCandidate: true },
  { name: 'marked', serverCandidate: true },
  { name: 'markdown-it', serverCandidate: true },
  { name: 'react-markdown', serverCandidate: true },
  { name: 'remark', serverCandidate: true },
  { name: 'unified', serverCandidate: true },
  { name: 'highlight.js', serverCandidate: true },
  { name: 'prismjs', serverCandidate: true },
  { name: 'shiki', serverCandidate: true },
  { name: 'sanitize-html', serverCandidate: true },
  { name: 'js-yaml', serverCandidate: true },
  { name: 'yaml', serverCandidate: true },
];

export const catalogEntry = (name: string): CatalogEntry | undefined => HEAVY_PACKAGES.find((e) => e.name === name);

/** Runtime every Next app ships; rules never flag these (they "grow" on every added route). */
const FRAMEWORK_PACKAGES = new Set(['next', 'react', 'react-dom', 'scheduler', 'styled-jsx', '@swc/helpers', 'client-only', 'server-only', '@next/env']);
export const isFrameworkPackage = (name: string): boolean => FRAMEWORK_PACKAGES.has(name);

// Next.js 16.4.6 defaults (next/dist/server/config.js); these never need optimizePackageImports.
const NEXT_OPTIMIZED = new Set([
  'lucide-react', 'date-fns', 'lodash-es', 'ramda', 'antd', 'react-bootstrap', 'ahooks', '@ant-design/icons',
  '@headlessui/react', '@headlessui-float/react', '@heroicons/react', '@visx/visx', '@tremor/react', 'rxjs',
  '@mui/material', '@mui/icons-material', 'recharts', 'react-use', 'effect', '@material-ui/core',
  '@material-ui/icons', '@tabler/icons-react', 'mui-core', 'react-icons',
]);
const NEXT_OPTIMIZED_SCOPES = ['@effect/'];
// Next also rewrites these with modularizeImports.
const NEXT_MODULARIZED = new Set(['lodash', '@mui/icons-material']);

export const isOptimizedByNext = (name: string): boolean =>
  NEXT_OPTIMIZED.has(name) || NEXT_MODULARIZED.has(name) || NEXT_OPTIMIZED_SCOPES.some((s) => name.startsWith(s));

export const DOCS = {
  optimizePackageImports: 'https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports',
  lazyLoading: 'https://nextjs.org/docs/app/guides/lazy-loading',
  serverComponents: 'https://nextjs.org/docs/app/getting-started/server-and-client-components',
} as const;
