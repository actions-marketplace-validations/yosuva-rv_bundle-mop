import { defineConfig } from 'tsup';

export default defineConfig({
  // index = library (no side effects), bin = executable (keeps its #! line).
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  // tsup 8 injects `baseUrl` for the dts build, which TS 6 flags as deprecated.
  dts: { entry: 'src/index.ts', compilerOptions: { ignoreDeprecations: '6.0' } },
  sourcemap: true,
});
