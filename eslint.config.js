import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.e2e/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The simulation must stay deterministic and free of I/O: no Math.random, clocks, or Node/DOM APIs.
    files: ['packages/sim/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded Rng from rng.ts.' },
        {
          object: 'Date',
          property: 'now',
          message: 'The simulation must not read the real clock.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'The simulation must not read the real clock.' },
        { name: 'performance', message: 'The simulation must not read the real clock.' },
        { name: 'fetch', message: 'The simulation must not do I/O.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'path', 'os'], message: 'The simulation must not do I/O.' },
          ],
        },
      ],
    },
  },
  {
    // Layering: the browser UI only talks to the helper through @aw/shared types.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aw/sim', '@aw/server', '@aw/brain'],
              message: 'The UI may only import @aw/shared.',
            },
          ],
        },
      ],
    },
  },
);
