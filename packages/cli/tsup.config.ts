import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  // tsup 8 injects `baseUrl` for the dts build, which TS 6 flags as deprecated.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
