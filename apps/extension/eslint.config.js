import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat config for the shared fill planner.
 *
 * The planner is environment-free by design — no DOM, no network, no Node
 * API — so the globals below are deliberately the bare ES set rather than
 * `globals.browser`. A `document` reference here should fail to lint, because
 * the whole point of this package is that it runs identically in a content
 * script, in a test and in nothing at all.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {},
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` hides contract drift, which is the one thing this repository
      // cannot afford (no hand-written parallel types).
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
