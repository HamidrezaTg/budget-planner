import eslint from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'client/dist/**',
      'client/public/sw.js',
      'dist/**',
      'desktop-client-tauri/**',
      'mobile/www/**',
      'mobile/android/app/src/main/assets/**',
      'mobile/ios/**/public/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: [
      'server/**/*.{js,mjs}',
      'tests/**/*.js',
      'scripts/**/*.js',
      '*.config.js',
      'client/*.config.js',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: ['mobile/tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: ['client/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'preserve-caught-error': 'off',
      'no-useless-escape': 'off',
    },
  },
];
