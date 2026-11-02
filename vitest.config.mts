// Loaded as ESM so Vitest does not warn about a CommonJS config.
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  resolve: {
    alias: {
      '@novel/contracts': path.resolve(process.cwd(), 'packages/contracts/src/index.ts'),
      '@novel/core': path.resolve(process.cwd(), 'packages/core/src/index.ts'),
      '@novel/ai': path.resolve(process.cwd(), 'packages/ai/src/index.ts'),
      '@novel/db': path.resolve(process.cwd(), 'packages/db/src/index.ts'),
      '@novel/storage': path.resolve(process.cwd(), 'packages/storage/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['apps/**/*.spec.ts', 'apps/**/*.e2e-spec.ts', 'packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
