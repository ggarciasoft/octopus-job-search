import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * Dev server configuration.
 *
 * The browser always talks to its own origin and the dev server forwards
 * `/api` and `/internal` to the Fastify app. That keeps the session cookie a
 * first-party HttpOnly cookie in development exactly as it is in production
 * (09_SECURITY_PRIVACY.md: SameSite=Lax, no wildcard CORS with credentials),
 * so no CORS policy has to be loosened just to run `pnpm dev`.
 *
 * `VITE_API_ORIGIN` overrides the target; the default is the Compose port from
 * 10_DEPLOYMENT.md.
 */
export const DEFAULT_API_ORIGIN = 'http://localhost:8080';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const apiOrigin = env.VITE_API_ORIGIN || DEFAULT_API_ORIGIN;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.VITE_PORT || 5173),
      proxy: {
        '/api': { target: apiOrigin, changeOrigin: true },
        // Proxied for local debugging only. The web app never calls the
        // internal worker protocol; it uses a separate credential
        // (04_API_CONTRACTS.md) and is not reachable from the browser in
        // production.
        '/internal': { target: apiOrigin, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
    },
  };
});
