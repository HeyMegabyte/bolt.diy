# admin_ai

Admin **AI assistant tools** — the dashboard's AI chat, trace-explainer,
natural-language search, and the two **SSE streaming** surfaces. Extracted
byte-verbatim from the `src/routes/ai_admin.ts` monolith in route-decomposition
**installment 18** — a pure route move, no behavior change.

## Routes (5)

| Method | Path                                 | Purpose                                                   |
| ------ | ------------------------------------ | --------------------------------------------------------- |
| POST   | `/api/admin/ai-chat`                 | Single-turn dashboard AI assistant (Workers AI)           |
| POST   | `/api/admin/traces/:traceId/explain` | 3-paragraph SRE explanation of an AI trace (D1+KV cached) |
| POST   | `/api/admin/search/ai`               | NL → parameterised org-scoped D1 SELECT                   |
| POST   | `/api/admin/ai/stream/palette`       | **SSE** — Cmd-K inline-answer stream                      |
| POST   | `/api/admin/ai/stream/chat`          | **SSE** — floating chat widget + `<tool>` envelopes       |

The two `/ai/stream/*` handlers return a `ReadableStream` with
`Content-Type: text/event-stream` — moved byte-verbatim (TransformStream +
per-token re-framing + tool-envelope scanning are unchanged).

Exported as `adminAi` (a `Hono<AppContext>`), mounted via `app.route('/', adminAi)`
in `src/index.ts` **before** both `api` and `aiAdmin`.

## Auth + scaffolding

- Every route: `need(c)` requires `orgId` **and** `userId` (401 otherwise). These are
  org-scoped operator tools; site ownership is confirmed inline (only ai-chat's optional
  `site_id` reads a site row, org-scoped) rather than via `siteOwned`.
- `HTTPError` / `need` / `aiAdminOnError` are **imported** from the shared
  `src/lib/ai_admin_kit.ts` kit — no local copies. The module registers
  `adminAi.onError(aiAdminOnError)`.

## Dependencies

- **LLM/AI seam** — Workers AI via `c.env.AI.run` on `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
  (ai-chat + both streams) and `@cf/meta/llama-3.1-8b-instruct-fp8` (trace-explain, inside
  the `explainTrace` service). The trace-explain + search routes call
  `explainTrace` / `aiSearch` from `src/services/ai_admin_features.ts` (auto-routed through
  AI Gateway); `AiTraceRow` is the trace row type. (`forecastCost`, the sibling export, is
  NOT used here — it stays in `ai_admin.ts` for `/api/admin/forecast/cost`.)
- `c.env.DB` (D1) — `ai_form_logs`, `ai_site_settings`, `sites`.
- `c.env.CACHE_KV` (KV) — per-org SSE rate-limit counters (`cmdk_ai_rate:*`, `aichat_rate:*`);
  the trace-explain KV hot cache lives inside `explainTrace`.
- `DASHBOARD_PERSONA_SYSTEM_PROMPT` (`src/prompts/dashboard_persona.ts`) — ai-chat + stream/chat.
- `DEFAULT_CHAT_SYSTEM_PROMPT` (`src/services/form_router.ts`) — ai-chat fallback system prompt.
- `auditService.writeAuditLog` (`src/services/audit.ts`) — fire-and-forget audit entries.

## Bodies

Read via a raw `as {…}` cast + `.catch(() => ({}))` (never a 5xx on a malformed body).
No `schemas.ts`: the moved handlers keep their original in-body validation.

## Tests

Covered by the existing Worker Jest suites (`src/__tests__/trace-explain.test.ts`,
`src/__tests__/ai-search.test.ts`) — both now mount `adminAi` **before** `aiAdmin` so the
moved routes resolve to the real handler.

Flag: none (`__core__` class — core operator AI tooling, org+user-scoped, not flag-gated).
Removal path: fold back into `ai_admin.ts` or delete the module + its `index.ts` mount.
