// ESLint flat config: browser rules for src/, Node rules for electron/ + scripts/, and a hard ban on eval-style code.
import js from '@eslint/js';
import globals from 'globals';

const noEval = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
};

export default [
  {
    ignores: [
      'dist/**',
      'dist-web/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
      'release/**',
      'scratch/**',
      'node_modules/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  { rules: noEval },
  { files: ['src/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  {
    files: [
      'electron/**/*.js',
      'scripts/**/*.mjs',
      'vite.config.js',
      'eslint.config.js',
      'playwright.config.js',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['electron/preload.cjs', 'scripts/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
