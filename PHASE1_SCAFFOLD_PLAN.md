# Phase 1 Scaffold — projectsites.dev v2

**Status:** scaffold landed at `./.v2-scaffold/` (quarantined). Requires manual merge to repo root.

**Generated:** 2026-05-26 by DevOps + Frontend Engineer sub-agent.

## What landed

Nx 22.7 + Angular 21.2 + Ionic 8 + Capacitor 6 + PrimeNG 17 + Tailwind 4 monorepo. Generated into `/tmp` first then mirrored into `.v2-scaffold/` so the existing root (Remix `bolt.diy` + `apps/project-sites/` Worker + `packages/shared/`) keeps working untouched.

### Projects (25 total)

**Apps (6):**
- `apps/web` — Angular 21 SSR app (esbuild, scoped `scope:web`)
- `apps/web-e2e` — Playwright E2E for web
- `apps/mobile` — Angular 21 + Capacitor 6 shell (scoped `scope:mobile`)
- `apps/mobile-e2e` — Playwright E2E for mobile web build
- `apps/control-plane` — TS library scaffold for the projectsites.dev Worker (`scope:edge,type:worker`)
- `apps/tenant-runtime` — TS library scaffold for the per-tenant Worker (`scope:edge,type:worker`)

**Libs (20)** — all tagged `scope:shared` with the appropriate `type:*`:
- `libs/ui` (`type:ui`) — pure presentational primitives
- `libs/auth` (`type:feature`) — auth + RBAC shells
- `libs/dashboard` (`type:feature`) — top-level dashboard shell
- `libs/data-access` (`type:data-access`) — HTTP, RxJS, signals
- `libs/domain` (`type:domain`) — Zod schemas + types (SSOT)
- `libs/feature-bookings, feature-quotes, feature-jobs, feature-crew, feature-sites, feature-billing, feature-team, feature-settings, feature-integrations, feature-snapshots, feature-sql, feature-logs` (`type:feature`)
- `libs/util-zod, util-rxjs, util-wasm` (`type:util`)

### Capacitor + Ionic
- `apps/mobile/capacitor.config.ts` written with `com.projectsites.mobile` bundle id and `webDir: ../../dist/apps/mobile/browser`.
- Capacitor packages installed (`@capacitor/core`, `@capacitor/cli`, `@ionic/angular`).
- Ionic platform syncs (`npx cap sync ios`, `npx cap sync android`) must be run after the first `nx build mobile --configuration=production` AND after `npx cap add ios` / `npx cap add android` are run (deferred to Phase 2 — needs Xcode + Android Studio).

### Module boundaries (eslint.config.mjs)
Strict tag matrix wired in `eslint.config.mjs`:
- `scope:web` → only `scope:web` + `scope:shared`
- `scope:mobile` → only `scope:mobile` + `scope:shared`
- `scope:edge` → only `scope:edge` + `scope:shared`
- `scope:shared` → only `scope:shared`
- Type pyramid: `app/feature → data-access → domain → util` enforced.
- Workers (`type:worker`) blocked from importing Angular features.

### CI
`.github/workflows/nx-affected.yml` runs `nx affected -t lint test build e2e` on PRs, full TypeDoc + Lighthouse + graph on main.

### TypeDoc
`typedoc.json` configured to scan `apps/{web,mobile,control-plane,tenant-runtime}/src` + `libs/`, output to `docs/api/`.

### Nx graph
Exported to `.v2-scaffold/docs/nx-graph.json` (96 KB, 25 nodes).

### Deps installed in scaffold
- Angular 21.2 + `@angular/cdk@21`
- `primeng@latest` + `primeicons@latest`
- `tailwindcss@latest` (v4)
- `@ionic/angular@latest`, `@capacitor/core@latest`, `@capacitor/cli@latest`
- `zod`, `ag-grid-community`, `ag-grid-angular`
- `@simplewebauthn/server`, `@simplewebauthn/browser`, `otplib`, `qrcode`
- `@ngx-translate/core`, `@ngx-translate/http-loader`
- Dev: `typedoc`, `@nx/playwright`, `@nx/vite`, `@analogjs/vitest-angular`, `@angular-eslint/*`

## What did NOT land — manual merge required

### Blockers preventing in-place `nx init` at repo root

The repo root currently has:
- `package.json` declaring `"name": "bolt"` with Remix dev scripts, Electron build chain, vitest config, and `"type": "module"`.
- `pnpm-workspace.yaml` declaring `apps/*`, `packages/*`, `.` as workspace members.
- `tsconfig.json` (Remix-flavored).
- An existing `apps/project-sites/` Worker + `apps/project-sites/frontend/` Angular 19 SPA that is the PRODUCTION deployment.
- Husky hooks, prettier config, eslint flat config (`eslint.config.mjs`) all already at root.

Running `nx init` in place would:
1. Overwrite `package.json` `name`, `scripts`, and `devDependencies` (destroys Remix/Electron build chain).
2. Conflict with the existing `eslint.config.mjs` (replaced wholesale).
3. Conflict with `pnpm-workspace.yaml` (Nx expects npm workspaces or no workspace declaration).
4. Conflict with `tsconfig.json` (Nx wants `tsconfig.base.json`).
5. Risk breaking the production `apps/project-sites/` Worker if path mapping changes.

Per the doctrine Phase 8 (cleanup) handles the bolt.diy + project-sites sunset, NOT this phase. So scaffold lives at `.v2-scaffold/` until then.

### Merge plan for Phase 8 cutover (when bolt.diy is sunset)

1. **Snapshot legacy state** — `git tag legacy-bolt-diy-pre-v2-cutover` before any merge.
2. **Move scaffold into place** atomically:
   ```bash
   mv .v2-scaffold/apps/web apps/web
   mv .v2-scaffold/apps/web-e2e apps/web-e2e
   mv .v2-scaffold/apps/mobile apps/mobile
   mv .v2-scaffold/apps/mobile-e2e apps/mobile-e2e
   mv .v2-scaffold/apps/control-plane apps/control-plane
   mv .v2-scaffold/apps/tenant-runtime apps/tenant-runtime
   mv .v2-scaffold/libs libs
   ```
3. **Merge root configs** (manual diff/merge — DO NOT clobber):
   - `package.json` — merge `devDependencies` (`@nx/*`, `@angular/*`, `@analogjs/vitest-angular`, etc.) into the root `package.json`. Keep Remix/Electron scripts during the transition window (they coexist). Add Nx scripts (`nx`, `affected`, `graph`).
   - `nx.json` — copy verbatim from `.v2-scaffold/nx.json` to root. No existing file conflicts.
   - `tsconfig.base.json` — copy from `.v2-scaffold/tsconfig.base.json`. Keep existing `tsconfig.json` until Remix is removed.
   - `eslint.config.mjs` — REPLACE root version with `.v2-scaffold/eslint.config.mjs`. Audit existing rules first; merge any project-specific overrides.
   - `.github/workflows/nx-affected.yml` — copy to `.github/workflows/`.
   - `typedoc.json` — copy to root.
   - `docs/nx-graph.json` — copy to root `docs/`.
   - `vitest.workspace.ts` — copy from scaffold.
4. **pnpm → npm workspace switch**:
   - Delete `pnpm-workspace.yaml`, `pnpm-lock.yaml`.
   - Add `"workspaces": ["apps/*", "libs/*", "packages/*"]` to root `package.json` (npm format).
   - Run `npm install --legacy-peer-deps`.
5. **Test affected graph**: `npx nx graph` should show 25 projects + paths to the legacy bolt.diy/project-sites surfaces during transition.
6. **Wire wrangler** into `apps/control-plane` and `apps/tenant-runtime` (Worker entries + `wrangler.jsonc` per app).
7. **Sunset bolt.diy + apps/project-sites** per Phase 8 (out of this phase's scope).

### What's deferred to Phase 2+

- **Capacitor native platforms** (`npx cap add ios` / `npx cap add android`) — needs Xcode + Android Studio installation.
- **PrimeNG theme tokens + Tailwind v4 config** — `apps/web/src/styles.scss` needs `@import 'primeng/resources/themes/...'` + Tailwind `@import "tailwindcss"` directive. Branding decisions still owed by the Architect agent's `AUDIT.md`.
- **Storybook** — recommended in CLAUDE.md PART 5.2 but not generated yet (`npx nx g @nx/storybook:configuration ui --uiFramework=@storybook/angular`).
- **Workers wrangler.jsonc** for `apps/control-plane` + `apps/tenant-runtime` — needs bindings list from the Architect agent.
- **`apps/web/src/index.html` PWA manifest, JSON-LD floor, SSR routes** — Phase 2 content/architecture.
- **i18n locale skeleton** — `apps/web/src/assets/i18n/{en,es}.json` needs seeding from the existing `apps/project-sites/frontend/src/assets/i18n/*.json`.

## Verification

```bash
cd .v2-scaffold
npm install --legacy-peer-deps          # already done during scaffold (node_modules removed for diff hygiene)
npx nx graph --file=docs/nx-graph.json  # 25 projects, no cycles
npx nx show projects                    # lists all 25
npx nx run-many -t lint                 # passes on empty scaffold
```

## Commits surfaced this phase

- `chore(scaffold): nx 22 + angular 21 workspace at .v2-scaffold/`
- `feat(scaffold): web + mobile + workers + 20 libs with tagged module boundaries`
- `feat(scaffold): capacitor config, typedoc, nx-affected CI`

## Final summary

✅ Nx 22 + Angular 21 + Ionic + Capacitor + PrimeNG + Tailwind v4 + Zod + AG Grid scaffold complete at `.v2-scaffold/`.
✅ All 25 projects scoped & typed per doctrine §4.
✅ ESLint module boundaries enforced.
✅ TypeDoc + Nx Affected CI wired.
✅ `docs/nx-graph.json` exported (96 KB, 25 nodes).
🛑 In-place merge BLOCKED until Phase 8 sunsets bolt.diy + apps/project-sites. Merge plan above.
🟡 Capacitor native shells, PrimeNG theme, Storybook deferred to Phase 2.
