import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC (not esbuild) so that emitDecoratorMetadata works for Nest dependency injection.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/cli/**', 'src/main.ts', '**/*.spec.ts'],
    },
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.spec.ts'] } },
      {
        extends: true,
        test: {
          name: 'db',
          include: ['test/**/*.{int,e2e}-spec.ts'],
          globalSetup: ['test/setup/global-setup.ts'],
          setupFiles: ['test/setup/env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
