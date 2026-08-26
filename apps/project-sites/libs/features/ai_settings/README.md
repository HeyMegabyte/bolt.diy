# ai_settings

Per-site **AI configuration** + **credit cap**. Extracted byte-verbatim from the
`src/routes/ai_admin.ts` monolith in route-decomposition **installment 18** — a
pure route move, no behavior change.

## Routes (5)

| Method | Path                                     | Purpose                                                    |
| ------ | ---------------------------------------- | ---------------------------------------------------------- |
| GET    | `/api/sites/:siteId/ai-settings`         | Read router prompt + chat persona + contact + Drive state  |
| PUT    | `/api/sites/:siteId/ai-settings`         | Upsert per-site AI settings (partial saves; email-gated)   |
| POST   | `/api/sites/:siteId/ai-settings/improve` | LLM-rewrite a persona / system-prompt string (Workers AI)  |
| GET    | `/api/sites/:siteId/credit-cap`          | Read the site's monthly AI credit cap                      |
| PUT    | `/api/sites/:siteId/credit-cap`          | Set / clear the site's monthly AI credit cap               |

Exported as `aiSettings` (a `Hono<AppContext>`), mounted via `app.route('/', aiSettings)`
in `src/index.ts` **before** both `api` and `aiAdmin`.

## Auth + scaffolding

- Every route: `need(c)` requires `orgId` **and** `userId` (401 otherwise);
  `siteOwned(c, orgId, siteId)` guards ownership (404, never 403).
- `HTTPError` / `need` / `siteOwned` / `safeJson` / `aiAdminOnError` are **imported**
  from the shared `src/lib/ai_admin_kit.ts` kit — no local copies. The module
  registers `aiSettings.onError(aiAdminOnError)`.

## Dependencies

- `c.env.DB` (D1) — `ai_site_settings`, `site_credit_caps`, `sites` tables.
- `c.env.AI` (Workers AI) — the `/improve` route (`@cf/meta/llama-3.1-8b-instruct-fp8`).
- `DEFAULT_ROUTER_PROMPT` + `DEFAULT_CHAT_SYSTEM_PROMPT` from `src/services/form_router.ts`
  (read-back defaults on the GET).
- `auditService.writeAuditLog` (`src/services/audit.ts`) — the PUT logs `ai_settings.updated`.
- `zod` — the PUT layers an inline email gate (`contact_email`/`reply_email` must be
  real emails ≤254 chars, or `''`/`null` to clear).

## Bodies

Read via a raw `as {…}` cast + `.catch(() => ({}))` (never a 5xx on a malformed body).
No `schemas.ts`: the moved handlers keep their original in-body validation (the PUT's
`z`-based email gate is inline).

## Tests

Covered by the existing Worker Jest suites (`src/__tests__/ai_settings_email_gate.test.ts`,
`src/__tests__/ai_admin_malformed_body.test.ts`) — both now mount `aiSettings` **before**
`aiAdmin` so the moved routes resolve to the real handler.

Flag: none (`__core__` class — core per-site AI config, org+user-scoped, not flag-gated).
Removal path: fold back into `ai_admin.ts` or delete the module + its `index.ts` mount.
