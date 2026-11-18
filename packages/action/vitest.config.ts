import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { 'bundle-mop': path.resolve(import.meta.dirname, '../cli/src/index.ts') } },
  test: { include: ['test/**/*.test.ts'] },
});
