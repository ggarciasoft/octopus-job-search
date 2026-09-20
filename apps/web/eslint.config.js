import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat config for the web app.
 *
 * `eslint-plugin-react-hooks` is intentionally absent: it is not installed in
 * this workspace and 00_AI_IMPLEMENTATION_INSTRUCTIONS.md pins the dependency
 * set. Add it (and `reactHooks.configs['recommended-latest']`) when the lock
 * file gains the plugin.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
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
);
