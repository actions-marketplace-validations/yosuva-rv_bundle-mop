import { describe, expect, it } from 'vitest';
import { detectAppRoot, normalizePath, parseIdent } from '../src/adapter/index.js';

const PNPM_NEXT =
  '[project]/node_modules/.pnpm/next@16.4.6_@types+node@22._1e2e598766d08c23d26cdf74c9327f47/node_modules/next/dist/client/app-next-turbopack.js';

describe('detectAppRoot', () => {
  it('finds a monorepo app by its root layout', () => {
    expect(detectAppRoot([PNPM_NEXT, '[project]/fixtures/basic/app/layout.tsx'])).toBe('fixtures/basic/');
  });
  it('returns empty string for a standalone app', () => {
    expect(detectAppRoot(['[project]/app/layout.tsx'])).toBe('');
  });
  it('handles src/app', () => {
    expect(detectAppRoot(['[project]/apps/web/src/app/layout.js'])).toBe('apps/web/');
  });
  it('ignores layouts inside node_modules', () => {
    expect(detectAppRoot(['[project]/node_modules/x/app/layout.tsx', '[project]/web/app/layout.tsx'])).toBe('web/');
  });
});

describe('normalizePath', () => {
  const root = 'fixtures/basic/';

  it('strips the pnpm hash and keeps the version separately', () => {
    expect(normalizePath(PNPM_NEXT, root)).toEqual({
      key: 'pkg:next/dist/client/app-next-turbopack.js',
      kind: 'package',
      packageName: 'next',
      packageVersion: '16.4.6',
      subpath: 'dist/client/app-next-turbopack.js',
    });
  });

  it('handles scoped pnpm packages', () => {
    const ref = normalizePath('[project]/node_modules/.pnpm/@swc+helpers@0.5.17/node_modules/@swc/helpers/esm/_interop.js', root);
    expect(ref).toMatchObject({ key: 'pkg:@swc/helpers/esm/_interop.js', packageName: '@swc/helpers', packageVersion: '0.5.17' });
  });

  it('gives the same key for npm and pnpm layouts', () => {
    const npm = normalizePath('[project]/node_modules/moment/moment.js', '');
    const pnpm = normalizePath('[project]/node_modules/.pnpm/moment@2.31.0/node_modules/moment/moment.js', root);
    expect(npm.key).toBe('pkg:moment/moment.js');
    expect(pnpm.key).toBe(npm.key);
    expect(npm.packageVersion).toBeUndefined();
    expect(pnpm.packageVersion).toBe('2.31.0');
  });

  it('uses the innermost package for nested node_modules', () => {
    expect(normalizePath('[project]/node_modules/a/node_modules/b/index.js', '').key).toBe('pkg:b/index.js');
  });

  it('does not take a version from an unrelated .pnpm segment', () => {
    const ref = normalizePath('[project]/node_modules/.pnpm/next@16.4.6/node_modules/styled-jsx/index.js', root);
    expect(ref.packageName).toBe('styled-jsx');
    expect(ref.packageVersion).toBeUndefined();
  });

  it('classifies app, workspace, internal, external and unknown paths', () => {
    expect(normalizePath('[project]/fixtures/basic/components/DatePicker.tsx', root)).toMatchObject({ key: 'app:components/DatePicker.tsx', kind: 'app' });
    expect(normalizePath('[project]/packages/ui/src/button.tsx', root)).toMatchObject({ key: 'workspace:packages/ui/src/button.tsx', kind: 'workspace' });
    expect(normalizePath('[project]/fixtures/basic/.next-internal/server/app/page/actions.js', root)).toMatchObject({ key: 'internal:server/app/page/actions.js', kind: 'internal' });
    expect(normalizePath('[externals]/node:zlib', root)).toMatchObject({ key: 'external:node:zlib', kind: 'external' });
    expect(normalizePath('[output]/x.js', root)).toMatchObject({ kind: 'unknown' });
  });
});

describe('normalizePath: framework and generated sources (seen on shadcn/ui)', () => {
  const root = 'apps/v4/';

  it('names the Turbopack runtime as internal', () => {
    expect(normalizePath('[turbopack]/browser/runtime/base/runtime-base.ts', root)).toEqual({
      key: 'internal:turbopack/browser/runtime/base/runtime-base.ts',
      kind: 'internal',
      subpath: 'turbopack/browser/runtime/base/runtime-base.ts',
    });
  });

  it('drops the changing config hash from next/font modules', () => {
    expect(normalizePath('[next]/internal/font/google/geist_798ff10f.module.css', root).key).toBe('internal:next/internal/font/google/geist_*.module.css');
    expect(normalizePath('[next]/internal/font/google/vazirmatn_33215607.js', root).key).toBe('internal:next/internal/font/google/vazirmatn_*.js');
  });

  it('strips an ident tag from a source path', () => {
    expect(normalizePath('[next]/internal/font/google/vazirmatn_33215607.module.css [app-client] (css module)', root).key).toBe(
      'internal:next/internal/font/google/vazirmatn_*.module.css',
    );
  });

  it('gives hashed build output a stable key per folder and extension', () => {
    const a = normalizePath('[client-fs]/_next/static/media/3fd1b3eda9c5392f-s.28efgb-r-zxeb.woff2', root);
    const b = normalizePath('[client-fs]/_next/static/media/2537dffe910bb2e4-s.28efgb-r-zxeb.woff2', root);
    expect(a).toEqual({ key: 'generated:_next/static/media/*.woff2', kind: 'generated', subpath: '_next/static/media/*.woff2' });
    expect(b.key).toBe(a.key); // same font, new hash: no longer "removed + added"
    expect(normalizePath('[client-fs]/_next/static/chunks/12kecf9glx065.js', root).key).toBe('generated:_next/static/chunks/*.js');
  });
});

describe('parseIdent', () => {
  it('reads layer and kinds', () => {
    expect(parseIdent('[project]/app/page.tsx [app-rsc] (ecmascript, Next.js Server Component)')).toEqual({
      layer: 'app-rsc',
      kinds: ['ecmascript', 'Next.js Server Component'],
    });
  });
  it('reads the <locals> modifier', () => {
    expect(parseIdent('[project]/components/ui/index.ts [app-client] (ecmascript) <locals>')).toEqual({
      layer: 'app-client',
      kinds: ['ecmascript'],
      modifier: 'locals',
    });
  });
  it('parses template idents that embed other idents', () => {
    const ident =
      '[project]/node_modules/next/dist/esm/build/templates/app-page.js?page=/page { MODULE_0 => "[project]/app/layout.tsx [app-rsc] (ecmascript, Next.js Server Component)" } [app-rsc] (ecmascript)';
    expect(parseIdent(ident)).toEqual({ layer: 'app-rsc', kinds: ['ecmascript'] });
  });
  it('tolerates idents without a layer', () => {
    expect(parseIdent('weird ident')).toEqual({ kinds: [] });
  });
});
