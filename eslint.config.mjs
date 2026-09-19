// Flat ESLint config. Deliberately small: the base recommended sets, plus a
// handful of project-specific `no-restricted-*` rules that turn the
// invariants written in CLAUDE.md and .claude/rules/ into build failures
// instead of prose an agent can skim past. Every custom rule below has a
// message naming the doc that explains it.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import next from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** Relative specifier with no extension on the final segment (`./foo`). */
const RELATIVE_WITHOUT_EXTENSION = String.raw`/^\.{1,2}\/(?:[^/]*\/)*[^./]+$/`;

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      'public/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // `_`-prefixed args are the documented way to say "required by the
      // signature, unused here" (e.g. `_request` in route handlers).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-console': ['error', { allow: ['error', 'warn'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // -------------------------------------------------------------------------
  // Layering: only `lib/queries/**` and `lib/storage.ts` may touch the DB.
  // -------------------------------------------------------------------------
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'middleware.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/db', '**/lib/db/*', 'drizzle-orm', 'drizzle-orm/*', 'postgres'],
              message:
                'Only lib/queries/** and lib/storage.ts may reach the database. Add a query function there and call it. See .claude/rules/data-access.md.',
            },
            {
              group: ['../*', '../../*', '../../../*'],
              message:
                'Under app/ and components/, import across directories with the `@/` alias, not a relative path. See .claude/rules/imports.md.',
            },
            {
              // `regex`, not `group`: pattern groups are gitignore-style
              // globs, so a regex written there silently matches nothing.
              regex: String.raw`\.tsx?$`,
              message:
                'Under app/ and components/, omit the file extension — webpack resolves it. See .claude/rules/imports.md.',
            },
          ],
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // `lib/**` and `scripts/**` run under bare `node --experimental-strip-types`
  // (npm test, npm run smoke, npm run db:seed), which resolves neither the
  // `@/` alias nor extensionless specifiers.
  // -------------------------------------------------------------------------
  {
    files: ['lib/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/*', '@/**'],
              message:
                'lib/ and scripts/ run under bare node, which cannot resolve the `@/` alias. Use a relative path with an explicit .ts extension. See .claude/rules/imports.md.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `ImportDeclaration[source.value=${RELATIVE_WITHOUT_EXTENSION}]`,
          message:
            'Add the explicit .ts extension — `node --experimental-strip-types` does not resolve extensionless imports. See .claude/rules/imports.md.',
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // The middleware import graph runs on the Edge runtime.
  // -------------------------------------------------------------------------
  {
    files: ['middleware.ts', 'lib/auth.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:crypto',
              message:
                'This module runs on the Edge runtime, which has no node:crypto. Use Web Crypto (crypto.subtle). See .claude/rules/auth.md.',
            },
            {
              name: 'crypto',
              message:
                'This module runs on the Edge runtime, which has no node:crypto. Use Web Crypto (crypto.subtle). See .claude/rules/auth.md.',
            },
          ],
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // React / Next.
  // -------------------------------------------------------------------------
  {
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    ...reactHooks.configs['recommended-latest'],
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      // The tree is clean, so this is an error rather than the plugin's
      // default warning: a stale closure in the editor's autosave wiring is
      // exactly the class of bug that survives review and shows up as
      // "my edit didn't save".
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    plugins: { '@next/next': next },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      // Components never call `fetch` directly: every request goes through
      // lib/api-client.ts, which attaches the auth token and maps 401 to a
      // logout. See .claude/rules/components.md.
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Call through lib/api-client.ts instead of fetch() — it attaches the auth token and handles 401. See .claude/rules/components.md.',
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Tests and scripts are allowed to talk to stdout and to reach for node:*.
  // -------------------------------------------------------------------------
  {
    files: ['**/*.test.ts', 'scripts/**/*.ts', 'e2e/**/*.ts', 'lib/queries/test-fixtures.ts'],
    rules: { 'no-console': 'off' },
  },

  // The latex sidecar is plain CommonJS Node with no TypeScript and no bundler.
  {
    files: ['services/latex/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { 'no-console': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },

  // Must stay last: turns off every rule Prettier owns.
  prettier,
);
