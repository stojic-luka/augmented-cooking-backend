import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  // NestJS DI resolves constructor dependencies from design:paramtypes
  // metadata. Vite's default transform (rolldown) cannot emit decorator
  // metadata, so TypeScript is compiled with swc instead — it reads
  // tsconfig.json and maps experimentalDecorators/emitDecoratorMetadata
  // onto its legacyDecorator/decoratorMetadata options. Without this every
  // Test.createTestingModule() call dies with "Nest can't resolve
  // dependencies" errors.
  plugins: [swc.vite()],
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
