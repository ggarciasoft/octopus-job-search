// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Unused arguments prefixed with _ are documentation of an interface the
      // implementation does not need, not dead code.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `any` defeats the point of the contract types. The scope chokepoint
      // uses `as never` casts instead, which stay local and explicit.
      '@typescript-eslint/no-explicit-any': 'error',
      // Output goes through the structured, redacted pino logger. A stray
      // console.log would bypass every redaction rule in src/logging.ts.
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-return-await': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Tests build real objects against a real database; a few long functions
    // and non-null assertions on freshly inserted rows are appropriate there.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
