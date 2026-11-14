// Tool configuration stays JavaScript: ESLint loads it directly.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'generated/', 'dist/'] },
  js.configs.recommended,
  {
    files: ['eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      // Migration policy (docs/12): no explicit any, no suppressed type errors.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          // Allowed only in focused compile-time tests, with a reason.
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: 'error',
      'prefer-const': 'error',
    },
  },
);
