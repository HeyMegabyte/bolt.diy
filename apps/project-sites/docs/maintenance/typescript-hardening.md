# TypeScript Hardening — projectsites.dev

Audit date: 2026-05-28
Auditor: ts-strict swarm agent

## Per-Package Settings

### `apps/project-sites/tsconfig.json` (Worker)

| Flag | Before | After |
|---|---|---|
| `strict` | ✅ | ✅ |
| `noImplicitOverride` | ❌ | ✅ |
| `noFallthroughCasesInSwitch` | ❌ | ✅ |
| `target` / `module` | ESNext/ESNext | ES2023/ES2022 |
| `noUncheckedIndexedAccess` | ❌ | ⏳ deferred (303 errors across wide surface — next hardening wave) |
| `exactOptionalPropertyTypes` | ❌ | ⏳ deferred (690 errors — bulk of errors in route handlers using `undefined` spread into optional-property shapes) |
| `noPropertyAccessFromIndexSignature` | ❌ | ⏳ deferred (579 errors — most in D1 result rows accessed via dot notation) |

### `apps/project-sites/frontend/tsconfig.json` (Angular SPA)

| Flag | Before | After |
|---|---|---|
| `strict` | ✅ | ✅ |
| `noImplicitOverride` | ✅ | ✅ |
| `noFallthroughCasesInSwitch` | ✅ | ✅ |
| `noImplicitReturns` | ✅ | ✅ |
| `noPropertyAccessFromIndexSignature` | ✅ | ✅ |
| `noUncheckedIndexedAccess` | ❌ | ⏳ deferred (110 errors — mostly array index access in signal-computed chains) |
| `exactOptionalPropertyTypes` | ❌ | ⏳ deferred (181 errors — mainly in PrimeNG + form binding patterns) |

### `packages/sdk/tsconfig.json`

| Flag | Before | After |
|---|---|---|
| `strict` | ✅ | ✅ |
| `noUncheckedIndexedAccess` | ✅ | ✅ |
| `exactOptionalPropertyTypes` | ✅ | ✅ |
| `noImplicitOverride` | ❌ | ✅ |
| `noFallthroughCasesInSwitch` | ❌ | ✅ |
| `noPropertyAccessFromIndexSignature` | ❌ | ✅ |
| `target` / `module` | ES2022/ESNext | ES2023/ES2022 |

Zero own-code errors.

### `packages/psctl/tsconfig.json`

| Flag | Before | After |
|---|---|---|
| `strict` | ✅ | ✅ |
| `noUncheckedIndexedAccess` | ✅ | ✅ |
| `exactOptionalPropertyTypes` | ❌ | ✅ |
| `noImplicitOverride` | ❌ | ✅ |
| `noFallthroughCasesInSwitch` | ❌ | ✅ |
| `noPropertyAccessFromIndexSignature` | ❌ | ✅ |
| `target` / `module` | ES2022/ESNext | ES2023/ES2022 |

Pre-existing errors: missing `@projectsites/sdk` module (workspace build order issue, not our code). Zero own-code errors introduced by new flags.

## `any` Killed (Worker — this wave)

| File | Count | Replacement |
|---|---|---|
| `src/services/image_optimization.ts` | 9 | `JsquashImageData` interface + `WorkerResizeOptions` from `@jsquash/resize/meta` |
| `src/services/css_minify.ts` | 1 | Typed `import()` cast with inline interface |
| `src/routes/search.ts` | 2 | `Record<string, unknown>` with bracket access |
| `src/routes/public_api.ts` | 2 | Hono `Context<{ Bindings: Env; Variables: V1Vars }>` |

**Total `any` killed: 14**

## `@ts-ignore` / `@ts-expect-error` Removed

| File | Count | Reason removed |
|---|---|---|
| `src/lib/log.ts` | 3 | `process.env` is now typed by `@cloudflare/workers-types` (unused directive) |

**Total `@ts-ignore`/`@ts-expect-error` removed: 3**

## Remaining Justified Suppressions

None. All suppressions in this wave were unused directives that could be cleanly removed.

## `noImplicitOverride` Fixes Applied

Added `override` keyword to:
- `src/container.ts` — `defaultPort`, `enableInternet`, `sleepAfter`, `entrypoint` on `SiteBuilderContainer`
- `src/durable_objects/app_runtime.ts` — `defaultPort` on `AppRuntimeContainer`
- `src/durable_objects/conversation_hub.ts` — `fetch()` on `ConversationHub`
- `src/durable_objects/voice_browse_agent.ts` — `defaultPort` on `VoiceBrowseAgent`
- `src/workflows/content-freshness-workflow.ts` — `run()` on `ContentFreshnessWorkflow`
- `src/workflows/pseo-generation-workflow.ts` — `run()` on `PseoGenerationWorkflow`

Also added `release?: string` and `environment?: string` to `SentryEvent` interface in `src/services/sentry.ts` — these were being spread into the event but were missing from the interface type.

## Type Fix — `src/services/sentry.ts`

`SentryEvent` interface was missing `release` and `environment` optional fields. The `sendToSentry` function was spreading `{ release, environment }` into the event before calling `scrubSentryEvent(event)`, which is typed as `SentryEvent → SentryEvent`. Without the fields in the interface, this was a hidden type error only surfaced under `noImplicitOverride` flag (due to strict mode narrowing). Added both as optional fields.

## Deferred Flags — Next Wave

Enable these flags one at a time with a dedicated fix pass:

1. **`noUncheckedIndexedAccess` (worker)** — 303 errors. Primary patterns:
   - `lines[i]` array access in parsers → guard with `?? ''` or explicit check
   - D1 result row columns → type D1 row shapes in `services/db.ts`
   - `prompts/parser.ts` — most dense file (15 errors), needs systematic `?? ''` narrowing

2. **`noPropertyAccessFromIndexSignature` (worker)** — 579 errors. Primary patterns:
   - D1 query results accessed via `row.field` on `Record<string, unknown>` shapes → switch to `row['field']` or type D1 row shapes
   - `voice_browse_helpers.ts` — biggest cluster, tool-dispatch action objects need discriminated union

3. **`exactOptionalPropertyTypes` (worker)** — 690 errors. Primary patterns:
   - `entrypoint?: readonly string[]` spread as `entrypoint: string[] | undefined` → use `...(entrypoint ? { entrypoint } : {})` patterns
   - D1 insert helpers where optional fields are spread without undefined-exclusion

4. **`noUncheckedIndexedAccess` (SPA)** — 110 errors in Angular component array accesses
5. **`exactOptionalPropertyTypes` (SPA)** — 181 errors in PrimeNG/form binding patterns

## wrangler types

`wrangler types` generates `worker-configuration.d.ts` which is auto-included via the types config. Verify after every `wrangler.toml` binding change with:

```bash
cd apps/project-sites && npx wrangler types
```

The generated file lands at `worker-configuration.d.ts` in the project root and is git-ignored. Run it in CI before typecheck to ensure binding types stay fresh.
