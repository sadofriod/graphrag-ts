import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.es2024,
        ...globals.node,
      },
    },
    rules: {
      complexity: ['error', { max: 12 }],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['**/*.{js,ts}'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 70, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
