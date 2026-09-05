import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 ships real flat configs, so the FlatCompat shim is not
 * needed — and with it in place ESLint failed outright while trying to serialise
 * a circular plugin object.
 */
const eslintConfig = [
  { ignores: ['.next/**', 'node_modules/**', 'src/generated/**', 'index.html', 'agent/**'] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
];

export default eslintConfig;
