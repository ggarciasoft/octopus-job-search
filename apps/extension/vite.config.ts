import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * The service worker and the popup: ES modules, as the manifest declares.
 *
 * The content script is NOT built here. It is injected with
 * `chrome.scripting.executeScript({ files })`, which evaluates a plain script
 * with no module loader — an `import` statement in it fails at runtime, on the
 * employer's page, where it is least visible. `vite.content.config.ts` builds
 * that one as a self-contained IIFE, and `pnpm build` runs both.
 *
 * 07_APPLICATION_AUTOMATION.md: "packaged TypeScript code, no remotely
 * downloaded executable code." Nothing in either build fetches at runtime and
 * the manifest's CSP pins `script-src 'self'`.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, 'src/background.ts'),
        popup: resolve(import.meta.dirname, 'popup.html'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
