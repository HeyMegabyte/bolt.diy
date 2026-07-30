# ProjectSites.dev — Product Features & Architecture Requirements

> **Single source of truth for the convergence loop.** Every requirement here must be verified by authenticated E2E tests. If a feature is listed here and doesn't work, the loop isn't done.

## AI Model Routing

The platform uses TIERED routing via `chooseProviderForTier(env, tier)` in `src/services/external_llm.ts`:

| Tier | Primary | Fallback | Used For |
|------|---------|----------|----------|
| `premium` | Anthropic Claude | OpenAI | Architecture, security review, complex generation |
| `standard` | DeepSeek | OpenAI | Implementation, content generation, build agents |
| `instant` | Workers AI (free) | DeepSeek | Pre-routing, classification, embeddings, fast responses |

Pipeline: `external_llm.ts → LiteLLM (decision layer) → AI Gateway (execution layer: cache + rate-limit + spend control) → upstream provider`

**This is the canonical description.** The old text listing specific models ("Claude Opus 4.7, Sonnet 4.6, Llama 3.3 70B FP8, GPT-5") was a snapshot that drifted from implementation. The tier names themselves are stable.

## Auth Surface

Six auth methods must be functional on BOTH `/signin` and `/auth/sign-up`:
1. Email + password (form submission → session)
2. Magic link (enter email → link sent → click → signed in)
3. Google OAuth (click button → Google consent → callback → signed in)
4. GitHub OAuth (click button → GitHub consent → callback → signed in)
5. Sign-up link (between sign-in and sign-up pages)
6. 2FA enrollment + verification (TOTP)

Legacy auth handles Google/GitHub OAuth (`GET /api/auth/google`, `GET /api/auth/github`). Better Auth (`better_auth` flag) owns email/password + magic link + 2FA when enabled. Both systems must coexist until cutover.

## Feature Flags

- 90 flags in `src/modules/feature_flags/registry.ts` (FLAG_REGISTRY) + D1 `feature_flags` table
- Every flag referenced in a frontend component MUST exist in the registry + D1
- `app-flag-gate-notice` component checks flags; if a flag is missing, it shows "not enabled"
- Promotion: experimental → beta → stable → deprecated → killswitch
- Admin UI at `/admin/feature-flags` (sysadmin-gated)
- Public API at `GET /api/feature-flags` returns flag booleans
- KV cache 60s TTL on flag state; admin mutations invalidate immediately

## Admin Sections (25+ routes)

Every section must:
1. Render content (not stuck skeleton, not blank, not "not enabled" when flag IS on)
2. Have an authenticated E2E journey test
3. Show zero console errors
4. Pass axe-core at 6 breakpoints
5. Handle loading → data → error states

## Platform Services (ADR-0034)

| Service | Runtime | Status |
|---------|---------|--------|
| Listmonk (mail) | CF Container | LIVE |
| Twenty CRM | CF Container | LIVE |
| Langfuse (traces) | CF Container | LIVE |
| Payload CMS | CF Container | LIVE |
| AI Gateway | CF managed | LIVE |
| LiteLLM | CF Container | LIVE — decision layer |
| Stripe | Managed SaaS | Billing |
| Unkey Cloud | Managed SaaS | API keys |
| Deepgram | Managed SaaS | STT |
| SES | Managed SaaS | Email |

**Removed (per ADR-0034):** Inngest→CF Workflows v2, Postiz→native social, Lago→Stripe Meters, Novu→psnotify, Nango→native OAuth+Composio. Zero Fly.io instances.

## Quality Gates

- **A11y**: axe-core 0 violations at 6 breakpoints (375/390/768/1024/1280/1920), WCAG 2.2 AA
- **Perf**: LCP ≤ 2.0s, CLS ≤ 0.05, INP ≤ 100ms
- **SEO**: title 50-60 chars, meta desc 120-156 chars, canonical, OG 1200×630, JSON-LD per page type
- **Security**: CSP Level 3 strict-dynamic, HSTS, Trusted Types, all standard security headers
- **Code**: TSC 0 errors, feature-drift 0 violations, no bare as-casts at Zod boundaries

## Key Architecture Decisions

- Cloudflare-first: Workers + D1 + KV + R2 + DOs + Containers. No portability layer.
- Better Auth embedded in main worker via Kysely D1 dialect. Flag-gated behind `better_auth`.
- LiteLLM sits BEFORE AI Gateway — determines whether to call AI and which model.
- AI Gateway handles caching, rate limiting, spend controls, routing.
- Langfuse handles prompt tracing, evals, feedback (self-hosted CF Container at traces.projectsites.dev).
- Native OAuth adapters in `src/services/oauth/` — Google + GitHub adapters with AES-GCM D1 token storage.
- `app.on()` blocks sub-app routing; use `app.use()` for middleware that passes through.
- Feature flags referenced in frontend MUST exist in FLAG_REGISTRY + D1, or components show "not enabled."

## E2E Testing Requirements

**Every admin section needs BOTH:**
- Auth-gate check (`/admin/{section}` → redirects to `/signin` when unauthenticated)
- Authenticated journey test (sign in → navigate → assert content renders, no stuck skeleton, no console errors)

Anti-pattern: 27 specs tested only redirect gates and caught zero admin-functionality bugs.
