# Convergence Gap Matrix

The ranked gap SSOT that `CONVERGENCE.md` Phase 0 calls for. Sourced from the
2026-08-06 whole-app gap audit (5 parallel specialist scans). The convergence loop
works this list top-down; a row flips to ✅ only when the fix is shipped + verified.

Status: ✅ done · 🔨 in-flight · ⬜ open. Each row carries the exact file:line so the
loop starts de-risked (no re-discovery).

## Security & data integrity

| # | Gap | Evidence | Tier | Effort | Status |
|---|-----|----------|------|--------|--------|
| 1 | Read-SSRF: `stock/save` fetched a client-controlled URL, no host guard | `routes/media.ts:337` | P0 | S | ✅ 2026-08-06 — `isSafeCrawlUrl` guard at the boundary |
| 2 | SSRF redirect bypass: crawler followed 3xx to internal hosts | `services/import_crawler.ts:110` | P1 | M | ✅ 2026-08-06 — manual redirect + per-hop revalidation + test |
| 3 | No rate limiting on money/AI-action endpoints | `middleware/rate_limit.ts` (0 `/api/ai-actions/*` rules) | P1 | S | ⬜ add per-org rules before `ai_payment_command` promotes |
| 4 | CSP `'unsafe-inline'`+`'unsafe-eval'` on the authed dashboard | `middleware/security_headers.ts:132` | P1 | L | ⬜ nonce the admin shell; drop `unsafe-eval`; tighten `connect-src` |
| 5 | Response-key mismatch → lying-empty UI (`{assets}` vs `{data}`) | `routes/media.ts:130` | P2 | S | ⬜ one envelope + Zod response contract |
| 6 | Swallowed SQL error → silent 404 on schema drift | `services/db.ts:181`, `middleware/auth.ts:56` | P1 | M | ⬜ surface `error` field; caller must distinguish empty vs failed |
| 7 | ~123 `features.ts` handlers read bodies as unvalidated `as` casts | `routes/features.ts:646,689` | P2 | M | ⬜ per-feature `zValidator` on flag promotion (dormant today) |

## AI generation pipeline

| # | Gap | Evidence | Tier | Effort | Status |
|---|-----|----------|------|--------|--------|
| 8 | Generation quality never gates publish (validators in `report` mode; readiness/vision/confidence all informational) | `build_validators.ts:1232`, `production_readiness.ts:99` | P1 | S→M | ⬜ flag-gate `strict` mode (default report → promote via admin) |
| 9 | No prompt versioning / eval-regression harness | `ai_workflows.registerAllPrompts()` | — | M | ⬜ add `version`/A-B fields + `prompt_evals` D1 table |
| 10 | Container-only builds = single point of failure (fallback exists, unused) | `external_llm.ts` vs `workflows/site-generation.ts` | — | L | ⬜ DLQ + surfaced exit codes + retry budget (or accept + document) |

## Reliability, cost & observability

| # | Gap | Evidence | Tier | Effort | Status |
|---|-----|----------|------|--------|--------|
| 11 | AI spend uncapped ($5–15/build, no per-org ceiling) | `libs/features/token_burn_meter/` (dark) | P1 | M | ⬜ enforce budget cap in `spend_log`; needs a threshold decision (Brian) |
| 12 | Queues never enabled → no retry/DLQ visibility | `wrangler.toml:125` (commented) | — | M | ⬜ enable QUEUE binding + failed-work dashboard |
| 13 | No alerting / error-budget enforcement (passive Sentry) | `lib/sentry.ts` | — | L | ⬜ SLO burn-rate → auto-killswitch on spike |
| 14 | `psnotify` notification center unbuilt (3 fragmented services) | `services/notifications.ts` | — | M | ⬜ DO inbox + prefs + web-push (backlog A23) |
| 15 | AI Gateway coverage partial (image/video/audio bypass it) | `services/external_llm.ts:41` | — | M | ⬜ route media gen through the Gateway |
| 16 | Thin log correlation + shallow health probe | `middleware/request_id.ts`, `routes/health.ts` | — | S | ⬜ add tenantId/featureSlug/model-version; probe model availability |

## Product & trust

| # | Gap | Evidence | Tier | Effort | Status |
|---|-----|----------|------|--------|--------|
| 17 | Build-failure is a golden-path black hole (no retry/logs/support) | `pages/waiting/waiting.component.ts:102` | P1 | M | ⬜ error detail + retry + support deep-link |
| 18 | Billing edge cases missing (dunning/failed-payment/downgrade/cancel) | `admin/sections/billing.component.ts` | — | L | ⬜ dunning flow + webhook hooks |
| 19 | "100% coverage" is false (730 boxes 0 checked; `E2E_API_KEY` fail-open) | `FEATURES_TO_TEST.md`, `frontend/CLAUDE.md` | P1 | M | 🔨 admin surface closed by admin-contract; extend pattern app-wide |
| 20 | No post-signup onboarding (`/admin/welcome` is a stub) | `app.routes.ts` (welcome route) | — | S–M | ⬜ 3-step first-run wizard from the dashboard hub |

## Cut from the audit (real but polish/hygiene/speculative)

- Admin untested at 375px · inconsistent empty/loading/error states · orphaned `users.phone` column · "NOT NULL without default" migration risk (no live instance found).
