import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import perfectionist from 'eslint-plugin-perfectionist';

/**
 * ESLint flat config for the Project Sites Angular frontend.
 *
 * @remarks
 * Mirrors the backend `eslint.config.mjs`. Added in item #32 to enforce
 * `eslint-plugin-perfectionist`'s import / named-import / object-key
 * sorters at WARN severity — non-blocking while the existing codebase
 * is brought into alignment.
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
    ignores: [
      'node_modules/',
      'dist/',
      '.angular/',
      'e2e/',
      '**/*.spec.ts',
      'src/**/*.d.ts',
    ],
  },
];
