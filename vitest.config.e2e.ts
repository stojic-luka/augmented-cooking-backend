import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Same shape as vitest.config.ts; only the include pattern differs. See the
  // notes there for why unplugin-swc (decorator metadata) and Vite 8's
  // tsconfigPaths resolution are both required.
  resolve: { tsconfigPaths: true },
  plugins: [swc.vite()],
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['**/*.e2e-spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
