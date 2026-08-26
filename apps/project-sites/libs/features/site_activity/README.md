# site_activity

Per-site, read-only activity surface: contact-form submissions and AI operation logs. Backs BOTH the admin **Forms** view (`form_submissions` — the owner's lead inbox) AND the admin **AI-Logs** view (`ai_form_logs` — router/chat/endpoint/tool traces), each list + single-row.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/sites/:siteId/form-submissions` | List recent contact-form submissions (paged, true total) |
| GET | `/api/sites/:siteId/form-submissions/:subId` | Single submission + its AI form logs |
| GET | `/api/sites/:siteId/ai-logs` | List AI trace rows (LLM/tool/router, paged, true total) |
| GET | `/api/sites/:siteId/ai-logs/:logId` | Single AI trace row (full input/output + timing) |

## Provenance

Extracted VERBATIM from `src/routes/ai_admin.ts` (route-decomposition installment 19). Only the route receiver changed (`aiAdmin.` → `siteActivity.`); handler bodies are byte-for-byte unchanged. All four routes are read-only `GET`s with no request body → no `schemas.ts`.

## Dependencies

- **Kit** (`src/lib/ai_admin_kit.ts`): `HTTPError`, `need`, `siteOwned`, `safeJson`, `aiAdminOnError`. No local scaffolding.
- **D1** (`c.env.DB`): `form_submissions` + `ai_form_logs` tables (parameterized SQL, true COUNT for the count pills).

## Wiring

`src/index.ts` mounts `siteActivity` before both `api` and `aiAdmin`. No feature flag — org+user-scoped via `need()` + `siteOwned()` (404 non-leak), same class as `aiSettings`/`aiEndpoints`/`aiContext`.
