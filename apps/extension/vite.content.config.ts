import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * The content script, as one self-contained file.
 *
 * `chrome.scripting.executeScript({ files: ['content.js'] })` evaluates a
 * classic script: no `import`, no module graph, no loader. `format: 'iife'`
 * plus `inlineDynamicImports` is what guarantees that, and
 * `emptyOutDir: false` keeps it from deleting the main build's output.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content.ts'),
      formats: ['iife'],
      name: 'JobGetterContent',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true, extend: true },
    },
  },
});
