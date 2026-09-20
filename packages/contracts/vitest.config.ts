import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The generator writes real files; keep suites in one process so two of
    // them cannot race on the same artifact.
    fileParallelism: false,
  },
});
