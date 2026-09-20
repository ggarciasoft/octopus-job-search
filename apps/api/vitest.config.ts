import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Each suite that needs PostgreSQL starts one container for the whole
    // file (see tests/helpers/postgres.ts). Starting a container per test
    // would dominate the run time; sharing one across files would couple them.
    fileParallelism: false,
    // Container start-up plus migrations is well under this, but Docker on a
    // cold image cache is not.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
    reporters: ['default'],
  },
});
