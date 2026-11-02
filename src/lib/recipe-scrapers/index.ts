/**
 * `recipe-scrapers` is ESM-only; its exports map blocks `require()`. This
 * loader keeps a native dynamic `import()` in the compiled output (the .mts
 * sibling is emitted as .mjs) and hands the module to CommonJS callers.
 */
export async function loadRecipeScrapers(): Promise<
  typeof import('./native.mjs', { with: { 'resolution-mode': 'import' } })
> {
  return import('./native.mjs');
}
