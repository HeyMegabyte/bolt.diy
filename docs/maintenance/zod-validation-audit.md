# Zod Validation Audit — Wave 2C

**Date:** 2026-05-28
**Scope:** `apps/project-sites/src/` — env schema + Wave 2C route handlers

---

## 1. Env Schema (`src/lib/env.ts`)

**Env keys validated: 10 required + 83 optional = 93 total**

| Key | Required | Notes |
|-----|----------|-------|
| `POSTHOG_API_KEY` | ✅ | Server-side analytics |
| `STRIPE_SECRET_KEY` | ✅ | Payment processing |
| `STRIPE_PUBLISHABLE_KEY` | ✅ | Frontend checkout |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Webhook signature verify |
| `CF_API_TOKEN` | ✅ | Custom hostname provisioning |
| `CF_ZONE_ID` | ✅ | DNS zone management |
| `GOOGLE_CLIENT_ID` | ✅ | OAuth 2.0 |
| `GOOGLE_CLIENT_SECRET` | ✅ | OAuth 2.0 |
| `GOOGLE_PLACES_API_KEY` | ✅ | Business search |
| `ENVIRONMENT` | ✅ | Deployment tag |
| All other 83 keys | Optional | Degrade gracefully when absent |

`parseEnv(env)` is wired as the **first middleware** in `src/index.ts` — fires before `requestIdMiddleware` on every request. A missing required secret throws `ZodError` → `errorHandler` → RFC7807 `VALIDATION_ERROR` 500.

---

## 2. Route Handlers Zod-Gated

**Total handlers gated: 9** (across 6 files)

| File | Handler | Schema | Status |
|------|---------|--------|--------|
| `routes/swarm.ts` | `POST /api/swarm/:siteId/start` | `SwarmStartBodySchema` | ✅ Added |
| `routes/site_dna.ts` | `POST /api/site-dna/:siteId/feedback` | `DnaFeedbackBodySchema` | ✅ Added |
| `routes/inbox.ts` | `POST /api/inbox/conversations/:id/reply` | `ReplyBodySchema` | ✅ Added |
| `routes/inbox.ts` | `POST /api/inbox/conversations/:id/assign` | `AssignBodySchema` | ✅ Added |
| `routes/inbox.ts` | `POST /api/inbox/conversations/:id/status` | `ConversationStatusBodySchema` | ✅ Added |
| `routes/copilot.ts` | `PUT /api/sites/:siteId/copilot/config` | `CopilotConfigBodySchema` | ✅ Added |
| `routes/public_api.ts` | `POST /v1/sites` | `CreateSiteBodySchema` | ✅ Added |
| `routes/public_api.ts` | `PATCH /v1/sites/:id` | `PatchSiteBodySchema` | ✅ Added |
| `routes/site_branches.ts` | `POST /api/sites/:siteId/branches` | `createBranchSchema` | ✅ Pre-existing |
| `routes/site_branches.ts` | `POST /api/sites/:siteId/branches/:branchId/merge` | `mergeBranchSchema` | ✅ Pre-existing |
| `routes/logs.ts` | `POST /api/logs/search` | `searchSchema` | ✅ Pre-existing |
| `routes/logs.ts` | `GET /api/logs/cost-by-route` | `costByRouteSchema` | ✅ Pre-existing |
| `routes/domain_stack.ts` | `POST /api/domains/:hostname/stack` | `startSchema` | ✅ Pre-existing |

**Routes with no body (no Zod needed):**
- `section_marketplace.ts` — POST fork has no request body
- `content.ts` — POST approve/reject/trigger have no body (path param only)
- `pseo.ts` — POST approve/reject/generate have no body (path param only)

---

## 3. RFC7807 Error Envelope

Confirmed: `src/middleware/error_handler.ts` already handles `ZodError` and returns the canonical envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "request_id": "<uuid>",
    "details": {
      "issues": [
        { "path": "field_name", "message": "human-readable message" }
      ]
    }
  }
}
```

HTTP status: `400`. No changes needed to `error_handler.ts`.

---

## 4. Type Inference

All new schemas export `z.infer<typeof Schema>` types. Inferred types are used in handler signatures instead of hand-written interfaces, ensuring compile-time safety.

---

## 5. TypeScript Gate

`tsc --noEmit` passes with 0 new errors introduced by this change. Pre-existing errors in `src/lib/log.ts` (5 `@ts-expect-error` unused directives) and `src/services/sentry.ts` (1 `release` property mismatch) are unrelated to this work.

---

## Files Touched

| File | Change |
|------|--------|
| `src/lib/env.ts` | NEW — 93-key Zod env schema + `parseEnv()` |
| `src/index.ts` | Wire `parseEnv` as first middleware |
| `src/routes/swarm.ts` | Added `SwarmStartBodySchema` + `zValidator` |
| `src/routes/site_dna.ts` | Added `DnaFeedbackBodySchema` + `zValidator` |
| `src/routes/inbox.ts` | Added 3 schemas + `zValidator` on reply/assign/status |
| `src/routes/copilot.ts` | Added `CopilotConfigBodySchema` + `zValidator` on PUT config |
| `src/routes/public_api.ts` | Added `CreateSiteBodySchema` + `PatchSiteBodySchema` + `zValidator` |
| `docs/maintenance/zod-validation-audit.md` | NEW — this file |
