import nx from '@nx/eslint-plugin';

/**
 * projectsites.dev v2 — Nx module-boundaries enforcement.
 *
 * Tag matrix (per the doctrine §4):
 *   scope:web       apps/web          (Angular SSR/SSG marketing + dashboard)
 *   scope:mobile    apps/mobile       (Angular + Ionic + Capacitor)
 *   scope:edge      apps/control-plane, apps/tenant-runtime  (Workers)
 *   scope:shared    libs/*            (everything shared across scopes)
 *
 *   type:app           the application itself
 *   type:feature       libs/feature-* + libs/dashboard + libs/auth (Angular feature shells)
 *   type:ui            libs/ui                                     (pure presentational)
 *   type:data-access   libs/data-access                            (HTTP, RxJS, signals)
 *   type:domain        libs/domain                                 (Zod schemas, types)
 *   type:util          libs/util-*                                 (pure functions)
 *   type:worker        apps/control-plane, apps/tenant-runtime     (edge Workers)
 *
 * Dependency direction (strict):
 *   app/feature → data-access → domain → util
 *   app/feature → ui → util
 *   util         → util only
 *   worker       → domain + util only (no Angular features)
 *   scope:mobile → scope:shared only (never cross into web/edge)
 *   scope:web    → scope:shared only
 *   scope:edge   → scope:shared (domain+util tagged libs only)
 */
export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // SCOPE rules — apps can only consume libs tagged scope:shared
            {
              sourceTag: 'scope:web',
              onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'],
            },
            {
              sourceTag: 'scope:mobile',
              onlyDependOnLibsWithTags: ['scope:mobile', 'scope:shared'],
            },
            {
              sourceTag: 'scope:edge',
              onlyDependOnLibsWithTags: ['scope:edge', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },

            // TYPE rules — enforce Nx's app/feature → data-access → domain → util pyramid
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:data-access',
                'type:domain',
                'type:util',
              ],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:data-access',
                'type:domain',
                'type:util',
              ],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:util', 'type:domain'],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:data-access', 'type:domain', 'type:util'],
            },
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:domain', 'type:util'],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            {
              // Workers stay light — no Angular features ever
              sourceTag: 'type:worker',
              onlyDependOnLibsWithTags: ['type:domain', 'type:util', 'type:data-access'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {},
  },
];
