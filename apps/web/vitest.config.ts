import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // Every test file still imports `describe`/`it`/`expect`/`vi` explicitly.
    // Globals are on only because @testing-library/dom detects fake timers by
    // looking for `globalThis.vi`; without it, `findBy*` hangs under
    // `vi.useFakeTimers()`.
    globals: true,
    restoreMocks: true,
  },
});
