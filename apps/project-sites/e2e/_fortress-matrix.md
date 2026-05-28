# Fortress Matrix — projectsites.dev

> **Adversarial E2E-TDD campaign.** Every feature gets ≥2 journey specs:
> one cooperative happy-path + one adversarial break-it path. RED before
> GREEN. Hermetic, parallel-safe. Console errors / 4xx-5xx / axe violations
> = test fail.

Status as of 2026-05-28 — Phase 1 (12 highest-value features).

## Coverage

| Feature | Owned dir | Cooperative spec | Adversarial spec | Adversarial angles | Status |
|---|---|---|---|---|---|
| AUTH — magic-link + Google OAuth + protected-route guards | `_fortress/auth/` | `happy-path.spec.ts` | `adversarial.spec.ts` | empty email / expired token / signed-out deep-link / refresh mid-flow / RBAC leak | ✓ wired |
| BILLING-subscribe — $50/mo Stripe checkout + portal + cancel + grace | `_fortress/billing/` | `happy-path.spec.ts` | `adversarial.spec.ts` | double-submit / webhook replay / past-due banner / Stripe Connect onboarding cancel | ✓ wired |
| SITE-create-from-search — search → details → waiting → workflow → published | `_fortress/site-create/` | `happy-path.spec.ts` | `adversarial.spec.ts` | search debounce race / empty slug / duplicate-submit / 500 mid-workflow / abort + retry | ✓ wired |
| ADMIN-sites-detail — Logs / Snapshots+Rollback / SQL / Integrations tabs | `_fortress/admin-detail/` | `happy-path.spec.ts` | `adversarial.spec.ts` | tab-switch mid-poll / SQL DDL rejected / rollback on missing snapshot / paste-key fallback | ✓ wired |
| FEATURE-FLAGS — list + filter + toggle + rollout + kill-switch + audit | `_fortress/feature-flags/` | `happy-path.spec.ts` | `adversarial.spec.ts` | toggle race (two tabs) / 100% rollout snap / kill-switch instant disable / audit-log row | ✓ wired |
| DOMAIN-stack — registrar → DNS → SSL → DMARC/SPF/DKIM → GSC verify 7-tile board | `_fortress/domain-stack/` | `happy-path.spec.ts` | `adversarial.spec.ts` | bad TLD / CAA conflict / SSL pending → fail / GSC token absent gracefully | ✓ wired |
| LOGS-explorer — DSL search + level + cost-by-route + virtualized table | `_fortress/logs-explorer/` | `happy-path.spec.ts` | `adversarial.spec.ts` | invalid DSL / empty state / 1M rows render perf / range-pill clash | ✓ wired |
| SWARM-editor — 7-specialist run + SSE stream + conflict detect + Site DNA feedback | `_fortress/swarm-editor/` | `happy-path.spec.ts` | `adversarial.spec.ts` | flag-off 404 / SSE disconnect mid-run / specialist conflict surfaced / DNA upsert idempotent | ✓ wired |
| MARKETPLACE — industry filter → section card → fork → quality score | `_fortress/marketplace/` | `happy-path.spec.ts` | `(pending — agent ran out of turn)` | (will write next pass: fork-of-fork / industry tab race / quality-score regression) | ⚠ partial — 1 of 2 |
| PUBLIC-API-v1 — token mint → curl /v1/sites → revoke → 401 → re-mint | `_fortress/public-api/` | `happy-path.spec.ts` | `adversarial.spec.ts` | scope-mismatch / expired / flag-off 503 / rate-limit on bare token | ✓ wired |
| UNIFIED-INBOX — assign → AI-draft → channel-native send → SLA tick | `_fortress/inbox/` | `happy-path.spec.ts` | `adversarial.spec.ts` | conversation race (two reviewers) / SLA breach badge / AI-draft retry / channel send fail | ✓ wired |
| MULTIMODAL-COPILOT — visitor photo+voice+text → intent → admin reply | `(pending — agent stopped early)` | `(pending)` | `(pending)` | (will write next pass) | ✗ not started |

## Summary
- **Features in scope**: 12
- **Features fully wired (2 specs)**: 10
- **Partial (1 spec)**: 1 (marketplace)
- **Pending**: 1 (multimodal-copilot)
- **Total spec files**: 21
- **Adversarial angles applied (avg per feature)**: 4

## Next pass priorities
1. Finish `marketplace/adversarial.spec.ts` — fork-of-fork race + quality-score regression
2. Write `multimodal-copilot/{happy-path,adversarial}.spec.ts` — photo upload + Whisper STT + intent classify + admin reply
3. Expand to the remaining 314 wired features per `TEST-PLAN.md` — 2nd fortress wave queued

## Verification
- RED-before-GREEN audit: every spec was confirmed to fail for the right reason (selector missing / state not asserted / network 4xx surfaced) before the app code was nudged toward GREEN.
- Hermetic contract per spec: starts at `/`, navigates by UI only, seeds own data via `_fixtures/`, isolated browser context, no live 3rd-party calls (MSW boundary mocks).
- Zero console errors + zero 4xx-5xx + zero axe-core violations asserted in every journey.

## Cross-link
- `e2e/FEATURES.md` — durable feature inventory
- `e2e/COVERAGE.yml` — machine-readable feature→spec map (CI gate)
- `TEST-PLAN.md` — 326-feature wired matrix
- `docs/testing/feature-e2e-matrix.md` — full Requirement-18 matrix (pending; agent ran out of turn)
