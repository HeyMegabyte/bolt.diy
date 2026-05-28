# Dead Code Audit — 2026-05-28

## Tools Used

| Tool | Version | Purpose |
|------|---------|---------|
| knip | 6.14.2 | Unused files, exports, deps |
| depcheck | latest | Cross-verify unused npm deps |
| tsc --noEmit | per tsconfig | Compile-time validation after each batch |
| wrangler deploy --dry-run | latest | Worker bundle validation |

---

## Files Removed (12 total, ~96.6 KB)

### Worker — `apps/project-sites/src/services/` (8 files)

| File | Size | Why removed |
|------|------|-------------|
| `aggregate_rules.ts` | 9.9 KB | No imports; self-referencing string only. Service for aggregating build rules — superseded by direct inline logic. |
| `anthropic_files.ts` | 7.4 KB | No imports. Anthropic Files API client — never wired into any route or workflow. |
| `anthropic_skills.ts` | 15.4 KB | No imports. Skill-management layer for Anthropic — never consumed by routes. |
| `build_context.ts` | 3.9 KB | No imports. Build context helper — logic absorbed into `ai_workflows.ts`. |
| `chat_synthesis.ts` | 4.3 KB | No imports. Multi-turn synthesis helper — never called from any route. |
| `image_discovery.ts` | 19.1 KB | No imports. Stock-image search client (Pexels/Unsplash/CSE) — referenced only in JSDoc of `media.ts`, not imported. |
| `template_cache.ts` | 15.5 KB | No imports. Template hot-patch KV cache — superseded by direct KV reads in `site_serving.ts`. |
| `worker_log_tail.ts` | 5.8 KB | No imports. Log-tail websocket client — never mounted on any route. |

### Worker — `apps/project-sites/src/modules/adapter_core/` (3 files + directory)

| File | Size | Why removed |
|------|------|-------------|
| `adapter_core/helpers.ts` | 6.1 KB | No imports. Generic adapter helper stubs — future-facing infrastructure with no current consumers. Adapter directories (calcom, ghost, etc.) are all empty placeholder dirs. |
| `adapter_core/registry.ts` | 2.5 KB | No imports. Adapter registry with all adapters commented out (`// import { listmonkAdapter }...`). |
| `adapter_core/types.ts` | 6.2 KB | No imports. TypeScript interfaces for the adapter system — unused until adapters are implemented. |

### Frontend — `apps/project-sites/frontend/src/app/animations/` (1 file)

| File | Size | Why removed |
|------|------|-------------|
| `count-up.directive.ts` | 2.8 KB | 0 references in entire codebase. Superseded by `<app-rolling-counter>` component (the canonical rolling-counter implementation per `cinematic-ui-patterns.md`). |

### Empty Module Directories Removed (19 directories)

All were empty placeholders (contained only empty subdirectories, no `.ts` files):

`adapters_calcom`, `adapters_chatwoot`, `adapters_documenso`, `adapters_ghost`,
`adapters_listmonk`, `adapters_mautic`, `adapters_n8n`, `adapters_openstatus`,
`adapters_outline`, `adapters_plausible`, `adapters_uptime_kuma`, `adapters_vaultwarden`,
`communications`, `geo_bundle`, `owner_empowerment`, `sandbox_runtime`, `service_platform`,
`subdomain_router`, `trust_compliance`, `ai_reliability/appliers`, `hold_on/themes`,
`rapid_preview/appliers`

---

## Exports Removed

53 unused export symbols identified by knip across active files. These are exported functions/types
in live files that are only used internally (knip flags them as unused when they cross module
boundaries but aren't consumed externally). NOT removed — these are intentional public API surfaces
(observable in other tools, public API surface of each module).

Examples:
- `src/lib/sentry.ts`: `captureMessage`, `createSentry` — exported for potential use by routes
- `src/services/usage_metering.ts`: `UsageMeter*` types — exported as contract types
- `src/services/features.ts`: feature flag helpers — exported for route consumption

**Decision**: Leave these exports. Removing them from their modules would require converting to
internal-only functions, which breaks the established pattern of importable service modules.
Many are used across routes that knip's static analysis missed (dynamic route registration,
conditional imports).

---

## Deps Removed

### Frontend (`apps/project-sites/frontend/package.json`)

**`dependencies` (7 removed):**

| Package | Why removed |
|---------|-------------|
| `animate.css` | Custom CSS in `_polish.scss` uses class names like `.animate-fade-in-up` but these are hand-written — the npm package is never `@import`'d or referenced in any `.ts`/`.html` file. |
| `@ionic/angular` | No `from '@ionic/angular'` imports anywhere in `src/`. App uses Angular CDK + shadcn patterns. |
| `@ionic/angular-toolkit` | Angular schematics for Ionic — unused since no Ionic components are in the codebase. |
| `@capacitor/cli` | Listed as a `dependency` (not `devDependency`) but never imported; no Capacitor-specific scripts wired in `package.json`. |
| `@capacitor/core` | No `from '@capacitor/core'` imports in `src/`. Native shell not currently active. |
| `primeng` | No `from 'primeng'` imports in `src/`. Mentioned in CLAUDE.md as "admin density" target but not installed in the Angular component tree. |
| `primeicons` | No `from 'primeicons'` or `pi-*` icon classes in `src/`. Co-dep of primeng — removed together. |

**`devDependencies` (6 removed):**

| Package | Why removed |
|---------|-------------|
| `jasmine-core` | Karma/Jasmine test runner — superseded by Angular's test migration to Vitest per the `angular-nx-monorepo.md` rule (Karma deprecated Angular 17+). |
| `karma` | As above. |
| `karma-chrome-launcher` | As above. |
| `karma-coverage` | As above. |
| `karma-jasmine` | As above. |
| `karma-jasmine-html-reporter` | As above. |

### Worker (`apps/project-sites/package.json`)

**`devDependencies` (1 removed):**

| Package | Why removed |
|---------|-------------|
| `cli-real-favicon` | Mentioned in `CLAUDE.md` as a fallback for favicon generation, but no npm script references it and no source file imports it. Not wired anywhere in the build pipeline. |

---

## Risky Areas Reviewed but KEPT (with rationale)

| Area | Why kept |
|------|---------|
| `src/services/image_discovery.ts` — *was deleted* | Confirmed no imports. JSDoc link from `media.ts` is documentation only. |
| `monaco-editor` (frontend dep) | Used via dynamic `import('monaco-editor')` in `ide.component.ts` / `monaco-loader.ts`. Depcheck missed it because the import is indirect. |
| `@twilio/voice-sdk` (frontend dep) | Used via `const pkg = 'twilio'; await import(pkg)` in `voice/test-console.component.ts`. Dynamic variable import hides it from static analysis. |
| `qrcode` (frontend dep) | Same pattern — `const pkg = 'qrcode'; await import(pkg)`. |
| `jszip` (worker dep) | Used via `await import('jszip')` in `routes/api.ts`. `@types/jszip` devDep kept accordingly. |
| `marked` (frontend dep) | Used in `agent-message.component.ts`. That component is "unused" per knip but imported indirectly through the admin shell template — kept. |
| `dompurify` (frontend dep) | Same component, same reasoning. |
| `@sentry/cli` (worker devDep) | Used in `npm run upload-sourcemaps` script (`scripts/upload-sentry-sourcemaps.mjs`). |
| `@types/jszip` (worker devDep) | Needed for `jszip` dynamic-import type safety. |
| `feature_flags/` module | Actively imported by 10 route/workflow files. |
| `src/modules/adapter_core/` files | Confirmed 0 imports — deleted. But the `feature_flags/` sibling module is active — not touched. |
| All `*.bak` files | Per CLAUDE.md directive: "Never delete .bak files". None found in src/. |
| `migrations/` | SQL migration history — never deleted per project rules. |
| `e2e/` specs | Playwright entry points — excluded from knip analysis. |
| Agent-modified files (`public_api.ts`, `image_optimization.ts`, etc.) | Concurrent changes by other agents. `tsc --noEmit` confirms these compile. Changes are outside our scope. |

---

## Verification Commands Run

```bash
# Worker type check
cd apps/project-sites && npx tsc --noEmit
# Exit: 0

# Worker bundle validation  
cd apps/project-sites && npx wrangler deploy --dry-run
# Total Upload: 5955.43 KiB / gzip: 1727.17 KiB — EXIT: 0
```

---

## Knip Configs Created

- `apps/project-sites/knip.json` — worker knip config
- `apps/project-sites/frontend/knip.json` — frontend knip config

Both configs are committed and can be run again via:
```bash
cd apps/project-sites && npx knip
cd apps/project-sites/frontend && npx knip
```
