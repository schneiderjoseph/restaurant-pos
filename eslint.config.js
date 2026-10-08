import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

// Flat-config port of the former .eslintrc.cjs (ESLint 9+ no longer reads it).
export default tseslint.config(
  // TypeScript only, as the former `eslint . --ext ts,tsx`.
  {ignores: ['dist', '**/node_modules', '**/*.{js,cjs,mjs}']},
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: {...globals.browser, ...globals.es2015, ...globals.node},
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // The two rules of the former plugin:react-hooks/recommended (v4), not the v7 compiler set.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', {allowConstantExport: true}],
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-useless-catch': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      // Added to eslint:recommended in ESLint 10, after this config was written.
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
);
