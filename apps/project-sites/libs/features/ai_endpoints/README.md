# ai_endpoints

AI endpoint management (CRUD + deploy/logs/duplicate/ai-helper/suggest),
extracted from `ai_admin.ts` (route-decomposition installment 15). These are the
per-site serverless functions (AI-prompt or Worker code) that back the public
`/api/ai/:slug/:endpoint` dispatcher. **Core, un-gated** routes (no feature flag)
— a route-organization module extracted from the `ai_admin.ts` monolith, not a
dark-launched feature.

## Routes (`handlers.ts` → `aiEndpoints`, mounted at `app.route('/', aiEndpoints)`)

| Method | Path                                                        | Auth         | Purpose                                              |
| ------ | ----------------------------------------------------------- | ------------ | ---------------------------------------------------- |
| GET    | `/api/sites/:siteId/ai-endpoints/:endpointId`               | orgId+userId | Fetch one endpoint (files, language, deploy status) |
| GET    | `/api/sites/:siteId/ai-endpoints`                           | orgId+userId | List endpoints (no bodies) + deploy/auth summary    |
| POST   | `/api/sites/:siteId/ai-endpoints`                           | orgId+userId | Create endpoint + starter files + first deploy      |
| PUT    | `/api/sites/:siteId/ai-endpoints/:endpointId`               | orgId+userId | Update metadata / files / auth mode                 |
| POST   | `/api/sites/:siteId/ai-endpoints/:endpointId/deploy`        | orgId+userId | Re-deploy from the IDE                               |
| GET    | `/api/sites/:siteId/ai-endpoints/:endpointId/logs`          | orgId+userId | Last 20 invocation logs                             |
| POST   | `/api/sites/:siteId/ai-endpoints/:endpointId/duplicate`     | orgId+userId | Clone endpoint (new slug, fresh deploy)             |
| POST   | `/api/sites/:siteId/ai-endpoints/:endpointId/ai-helper`     | orgId+userId | IDE AI helper (stub — LLM-backed ships later)       |
| DELETE | `/api/sites/:siteId/ai-endpoints/:endpointId`               | orgId+userId | Delete endpoint + tear down dispatched Worker       |
| POST   | `/api/sites/:siteId/ai-endpoints/suggest`                   | orgId+userId | LLM scaffolds a new endpoint (Zod-validated)        |

## Boundaries

- Every route requires BOTH an `orgId` AND a `userId` on the request context —
  the local `need(c)` helper throws `HTTPError(401)` when either is missing.
- Site ownership is guarded through the local `siteOwned(...)` helper — a
  missing/foreign site collapses to **404 (never 403)** so cross-org sites don't
  leak.
- Delegates to `services/ai_endpoints_ide.ts` (`deployEndpointFromFiles` /
  `normaliseSlug` / `safeParseJson` / `LANGUAGE_STARTERS` + the `IdeLanguage` /
  `EndpointAuthMode` types), `services/wfp_dispatch.ts` (`uploadUserWorker` /
  `deleteUserWorker` / `SUPPORTED_LANGUAGES` / `isWfpConfigured`), and
  `services/ai_admin_features.ts` (`suggestEndpoint`) for the LLM scaffolder.
  Audit writes go through `services/audit.ts` (`writeAuditLog`) via
  `c.executionCtx.waitUntil(...)`.
- No request body is Zod-validated at the boundary — the create/update/deploy/
  suggest bodies use the original in-body `as {…}` cast + `.catch(() => ({}))` +
  manual checks, so there is no `schemas.ts`.

## Extraction notes

Extracted VERBATIM from `ai_admin.ts` — only the route-registration receiver
changed (`aiAdmin.` → `aiEndpoints.`); the handler bodies are byte-for-byte
unchanged. The module reproduces ai_admin's EXACT error scaffolding (the
`HTTPError` class, the `need` / `siteOwned` / `safeJson` helpers, and a
byte-identical `onError`). Because this module contains ONLY these ai_admin-sourced
routes, exact reproduction = byte-identical behavior; no shared-`AppError` re-throw
is needed (there are no pre-existing non-ai_admin routes to fall through to).
