import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import perfectionist from 'eslint-plugin-perfectionist';

/**
 * ESLint flat config for the Project Sites Worker.
 *
 * @remarks
 * - `@typescript-eslint` handles TS-specific rules.
 * - `eslint-plugin-perfectionist` enforces consistent sort order on imports,
 *   named imports, and object keys at WARN severity (item #32). WARN-only
 *   prevents mass-fail when introducing the plugin to a large existing tree;
 *   bumps to ERROR can land in a follow-up sweep once warnings are zero.
 */
export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      perfectionist,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'perfectionist/sort-imports': ['warn', { type: 'natural', order: 'asc' }],
      'perfectionist/sort-named-imports': ['warn', { type: 'natural', order: 'asc' }],
      'perfectionist/sort-objects': ['warn', { type: 'natural', order: 'asc' }],
    },
  },
  {
    ignores: ['node_modules/', 'dist/', '**/*.test.ts', '**/__tests__/', 'cypress/'],
  },
];
