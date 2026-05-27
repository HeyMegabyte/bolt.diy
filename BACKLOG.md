# projectsites.dev v2 — Backlog

> Multi-turn build per the v2 doctrine. This file is the authoritative status board.
> Doctrine phases: Phase 0 (audit) → Phase 1 (scaffold) → Phase 2 (auth) → Phase 3 (dashboard) → Phase 4 (feature port) → Phase 5 (public surfaces + 1000-word) → Phase 6 (perf) → Phase 7 (testing) → Phase 8 (cleanup).
> Generated: 2026-05-26.

---

## Status snapshot (this turn)

| Phase | Status | Artifact |
| --- | --- | --- |
| 0 — Audit | ✅ DONE | [`AUDIT.md`](AUDIT.md) — 743 lines, homepage variants + resurrection vector + 27 admin sections + 123 D1 tables + design tokens |
| 1 — Nx + Angular 21 + Ionic + Capacitor + PrimeNG scaffold | ✅ DONE (quarantined) | [`.v2-scaffold/`](.v2-scaffold/) + [`PHASE1_SCAFFOLD_PLAN.md`](PHASE1_SCAFFOLD_PLAN.md). Merge to root deferred to Phase 8. |
| Governance docs | 🟡 PARTIAL | DECISIONS ✅, AUDIT ✅, BILLING / SECURITY / BACKLOG / ARCHITECTURE — agent dispatched |
| Resurrection guard | ✅ DONE | [`.cleanup-allowlist`](.cleanup-allowlist), [`tools/resurrection-check.sh`](tools/resurrection-check.sh), [`.github/workflows/resurrection-guard.yml`](.github/workflows/resurrection-guard.yml), [`lefthook.yml`](lefthook.yml) |
| Angular 19 → 21 bump (current project) | ✅ DONE | `apps/project-sites/frontend/package.json` @ ^21.2.14, control-flow migration ran on 9 components, typecheck clean |
| Stripe Link inline 1-click checkout | ✅ DONE | Worker endpoint live, 9/9 Playwright specs green under brian@megabyte.space stub, deployed |
| RxJS-first Angular rule | ✅ DONE | [`~/.claude/plugins/heymegabyte-claude-skills/rules/rxjs-first-angular.md`](https://github.com/heymegabyte/claude-skills/blob/master/rules/rxjs-first-angular.md) — SUPREME, pushed |
| 2 — Auth (libs/auth) | ⏸ Queued | OAuth (5 providers) + magic link + voice OTP + WebAuthn + TOTP |
| 3 — Single dashboard shell + role-switcher | ⏸ Queued | Capability model + super-admin gate + Cmd+K + notifications bell |
| 4 — Feature port (Logs → Snapshots → SQL → Integrations → Billing → Sites → AI Gateway → Quotes → Jobs → Crew → Bookings → Team → Settings) | ⏸ Queued | Per the order in doctrine §Phase 4 |
| 5 — Public surfaces + 1000-word doctrine | ⏸ Queued | Marketing home + /about + /pricing + 3 blog articles + /docs foundation + 3 template showcases |
| 6 — Performance budgets | ⏸ Queued | Lighthouse CI on every PR per §13 |
| 7 — Cross-browser test matrix | ⏸ Queued | Playwright × chromium/webkit/firefox/mobile-safari/mobile-chrome |
| 8 — Cleanup + resurrection-vector kill | ⏸ Queued | Delete legacy, merge `.v2-scaffold/` to root, tag `v2.0.0-angular` |

---

## The 50 stack improvements

Status: priority + trigger + owner. All ship before v1 unless marked `P3` (post-v1).

### Core framework (P0 — Phase 1/2)

1. **Zoneless change detection** `provideZonelessChangeDetection()` — drop Zone.js entirely. **P0 Phase 1**. Owner: Frontend Engineer.
2. **`httpResource()` for declarative HTTP→signal** — Angular 21 stable. **P0 Phase 4** alongside the data-access library.
3. **Incremental hydration** `withIncrementalHydration()` — viewport/interaction-gated. **P0 Phase 1**.
4. **`linkedSignal()` for derived state** — Angular 21 stable. **P0 Phase 3** in the dashboard shell.
5. **`resource()` async signal API** — **P0 Phase 4** for build progress + log tails.
6. **Signal `input.required<T>()` / `output()` / `model()`** — migrate every `@Input`/`@Output`. **P0 Phase 3-4**.
7. **`@defer` blocks everywhere** below-the-fold. **P0 Phase 3**.
8. **`afterNextRender()` for DOM teleport** (kills MutationObserver loops). **P0 Phase 3-4** as needed.
9. **`inject()` everywhere** — drop constructor DI. **P0 Phase 3** in new code.

### HTTP / real-time / streams (P0 — Phase 4)

10. **RxJS-first at every backend edge** — Observable<T> everywhere, `toSignal()` at template only. **P0 SUPREME** per [`rxjs-first-angular.md`](https://github.com/heymegabyte/claude-skills/blob/master/rules/rxjs-first-angular.md). Owner: every engineer.
11. **SSE via `EventSource` + `fromEvent`** — build progress, log tails. **P0 Phase 4** (Logs feature).
12. **WebSocket via `rxjs/webSocket`** — bidirectional chat, presence, cursor sync. **P0 Phase 4** (Jobs feature live tracking).
13. **Cloudflare Durable Object as WebSocket presence hub** — per-job chat + per-site log + per-user notifications. **P0 Phase 4**.
14. **Optimistic UI with rollback** — every mutation. **P1 Phase 4**.
15. **Retry with exponential backoff + jitter** via `retryWhen` — every HTTP call. **P0 Phase 4** in `libs/util-rxjs/`.
16. **Debounced search streams** (`debounceTime + switchMap`) — Cmd+K palette, every search input. **P0 Phase 3** (Cmd+K).
17. **`takeUntilDestroyed()` everywhere** — kill subscription leaks. **P0 every PR**.

### State (P1 — Phase 3)

18. **NgRx SignalStore for cross-feature shared state** — formalize the `AdminStateService` pattern. **P1 Phase 3**. Trigger: when 3+ features share state.
19. **Persisted signal stores** (localStorage + IndexedDB) — viewAs cookie, theme, recent searches. **P1 Phase 3**.
20. **TanStack Query for Angular as HTTP cache layer** — **P3 post-v1**, only if `httpResource()` proves insufficient.

### Testing (P0 — Phase 7)

21. **Vitest replaces Karma** via `@analogjs/vitest-angular`. **P0 Phase 1** scaffold (already wired in `.v2-scaffold/`).
22. **MSW unifies mocks** across dev + Storybook + Playwright. **P0 Phase 1**. Replaces `scripts/e2e_server.cjs`.
23. **Playwright Component Testing** for in-isolation runs. **P1 Phase 7**.
24. **Visual regression** via Percy or Chromatic. **P1 Phase 7**.
25. **Random-snapshot sampling** per [`e2e-visual-inspection.md`](https://github.com/heymegabyte/claude-skills/blob/master/rules/e2e-visual-inspection.md). **P0 Phase 7**.
26. **AI vision QA** on every new route (Sonnet 4.6 vision). **P0 Phase 7**.
27. **axe-core / Playwright at 6 breakpoints, 0 violations**. **P0 Phase 7**.

### Build / DX (P0 — Phase 1)

28. **Nx 20 workspace + Nx Cloud + `nx affected` CI**. **P0 Phase 1** ✅ (scaffold).
29. **Storybook 8 with auto-docs + interaction testing**. **P1 Phase 4** (one PR per feature lib).
30. **Lefthook git hooks** (not husky) + oxlint pre-commit speed pass. **P0 Phase 1** ✅ (lefthook.yml).
31. **Knip + jscpd + dependency-cruiser** weekly CI. **P1 Phase 6**.
32. **Bun runtime for tooling** (`bun --bun ng build`). **P2 Phase 6**.
33. **Renovate auto-bump weekly**. **P0 Phase 1**.

### SSR / hydration (P0 — Phase 1)

34. **`@angular/ssr` on Cloudflare Workers** (same edge as API). **P0 Phase 1** ✅ (scaffold has `--ssr=true`).
35. **Streaming SSR** with `Transfer-Encoding: chunked`. **P1 Phase 6**.
36. **Beasties (formerly Critters) for critical-CSS inlining**. **P1 Phase 6**.
37. **Speculation Rules prerender** for likely-next routes. **P1 Phase 6** in `apps/web/src/index.html`.

### UI / component library (P0 — Phase 3-5)

38. **Spartan UI on marketing surfaces; PrimeNG on admin**. **P0 Phase 5** (marketing) + **P0 Phase 3** (admin).
39. **Ionic 8 components on mobile-first surfaces**. **P0 Phase 1** ✅ (scaffold).
40. **Style Dictionary → CSS custom props** for cross-platform tokens. **P1 Phase 2** (design system).
41. **OKLCH color tokens + `color-mix(in oklch, ...)`** per [`text-contrast.md`](https://github.com/heymegabyte/claude-skills/blob/master/rules/text-contrast.md). **P0 Phase 2**.
42. **Container queries for component-level responsive**. **P0 every component**.
43. **View Transitions + scroll-driven animations + `@starting-style`**. **P0 Phase 3** (route transitions, role-switcher).

### Mobile + desktop (P1 — Phase 1, P3 — post-v1)

44. **Capacitor 6 for iOS + Android** — Camera, Filesystem, Push, Geolocation, Haptics. **P0 Phase 1** ✅ (scaffold) + **P1 Phase 4** (plugin gating).
45. **Tauri 2 for macOS + Windows + Linux desktop shells** + auto-updater. **P3 post-v1**.
46. **Deep-link routes** (`https://projectsites.dev/site/{slug}` → installed app). **P2 Phase 4** alongside the website-generator.

### i18n (P1 — Phase 5)

47. **Transloco replaces `@ngx-translate/core`** — lazy per-locale chunks, signal-native. **P1 Phase 5**. ES, FR, PT, ZH-Hans mirrors.

### Observability / AI-native (P0 — Phase 4)

48. **AI chat streaming via Workers AI Llama 3.3 70B FP8 + AI Gateway** logging/caching. **P0 Phase 4**.
49. **Long Animation Frames API** for INP diagnostics + per-route soft-nav web-vitals. **P0 Phase 6**.
50. **PostHog session replay + feature flags + autocapture** + Sentry `@sentry/angular` v9. **P0 Phase 2** for early signal.

---

## Doctrine §25 — explicitly out of scope for v1

These are tracked here so they don't get accidentally rebuilt. Promotion to active sprint requires a logged ADR.

| Item | Why deferred | Promotion trigger |
| --- | --- | --- |
| CSP Level 3 strict-dynamic + nonce | Doctrine §25 skip; v1 ships fast | Phase-2 SECURITY.md follow-up |
| Trusted Types + Security+ harden | Doctrine §25 skip | Same as above |
| Build-time validators | Doctrine §25 skip | Same as above |
| Slack integration | Doctrine §21 — remove existing stubs | Never (email-only for v1+) |
| Marketing rebrand workshop | Doctrine §25 | Brian decides |
| Stripe Payment Element (use Stripe Link) | Doctrine §11.2 — Link exclusively | Only if Stripe deprecates Link |
| Square Web Payments SDK | Doctrine §11.2 | Only if Stripe Connect breaks in a target country |
| Take-rate UI | Doctrine §11.3 — never surface | Never |
| Angular Material | Doctrine §3.1 — PrimeNG mandate | Never |
| NgModules | Doctrine §3.1 — standalone only | Never |
| Template-driven forms | Doctrine §3.1 — typed reactive only | Never |
| Angular < 21 | Doctrine §3.1 | Never; bump to 22 within 30 days of stable per §3.1 |

---

## Triggers — what unblocks the next phase

### Before Phase 2 (auth)
- Brian provisions or hands over the 5 OAuth client IDs/secrets per doctrine §23: Google, GitHub, Apple, Microsoft, Facebook
- Twilio Verify service SID (voice OTP + SMS magic link) per §23
- Resend API key for email magic links

### Before Phase 4 (feature port)
- Phase 3 dashboard shell merged so feature routes have a host

### Before Phase 5 (public + 1000-word)
- Phase 4 enough features ported that the dashboard reads "complete"
- Content Author engaged with editorial voice brief

### Before Phase 8 (cleanup)
- All Phases 1-7 green on preview deploy
- `.v2-scaffold/` proven equivalent to existing project on a parity-matrix test
- Brian sign-off on the deletion shortlist from AUDIT.md

---

## What ships next turn (default order, no acknowledgement needed)

1. Phase 2 auth library scaffold: `libs/auth` with the OAuth adapter, magic-link, voice-OTP, passkey, TOTP modules — pure code, env vars stubbed until user supplies them.
2. Phase 3 dashboard shell at `apps/web/src/app/dashboard/`: PrimeNG top bar + left rail + main outlet + right rail + footer + capability model + role-switcher + Cmd+K + notifications bell + super-admin gate.
3. Begin Phase 4 feature port in inventory order: Logs (WebSocket virtualized viewer) first.
4. Wire `nx affected` CI matrix to the new scaffold.
5. Open the draft PR per doctrine §24 ("draft PR open after Phase 1, kept current").

---

## Cross-links

- [`AUDIT.md`](AUDIT.md) — Phase 0 findings
- [`DECISIONS.md`](DECISIONS.md) — ADR log (8 seeded)
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — topology (pending)
- [`BILLING.md`](BILLING.md) — take-rate decision (pending)
- [`SECURITY.md`](SECURITY.md) — skip list + threat model (pending)
- [`PHASE1_SCAFFOLD_PLAN.md`](PHASE1_SCAFFOLD_PLAN.md) — Nx scaffold + merge plan
- [`.cleanup-allowlist`](.cleanup-allowlist) — resurrection-guard exception list
- [`apps/project-sites/CLAUDE.md`](apps/project-sites/CLAUDE.md) — current production stack docs
- [`apps/project-sites/frontend/CLAUDE.md`](apps/project-sites/frontend/CLAUDE.md) — current Angular 21 SPA docs
- [`~/.claude/plugins/heymegabyte-claude-skills/rules/rxjs-first-angular.md`](https://github.com/heymegabyte/claude-skills/blob/master/rules/rxjs-first-angular.md) — RxJS-first SUPREME rule
- [`~/.claude/plugins/heymegabyte-claude-skills/rules/angular-nx-monorepo.md`](https://github.com/heymegabyte/claude-skills/blob/master/rules/angular-nx-monorepo.md) — Nx + Angular 21 SUPREME rule

---

# Post-v1 Queue

> **Purpose:** Track work intentionally deferred past v1. Each item names what it is, why it's not in v1, the trigger that would promote it, the rough cost, and dependencies.
> **Cadence:** Reviewed monthly. Items promoted to the active sprint board move out of this section; items dropped get strikethrough + a "dropped because" line.

This is **not a roadmap** (a roadmap promises dates). This is a queue with **promotion triggers**: concrete conditions that justify pulling each item into active work.

## Post-v1 index

| # | Item | Cost | Trigger | Status |
|---|------|------|---------|--------|
| P1-01 | Tauri 2 desktop shells | ~120 hrs | Capacitor mobile lands + 50 tenants request desktop | Queued |
| P1-02 | Apollo Angular + GraphQL gateway | ~160 hrs | REST API >40 endpoints OR mobile asks for federated query | Queued |
| P1-03 | NgRx Signal Store formalization | ~40 hrs | `AdminStateService` pattern proves out across 3+ surfaces | Queued |
| P1-04 | Storybook 8 component library | ~60 hrs | `libs/ui` hits 20+ wrap-layer components | Queued |
| P1-05 | SAML / OIDC enterprise SSO | ~80 hrs | First Enterprise tier deal contingent on SSO | Queued (scaffolded behind flag) |
| P1-06 | SOC 2 Type II readiness | ~480 hrs | First Enterprise prospect requires it | Queued |
| P1-07 | Full i18n mirror (ES, FR, PT, ZH-Hans) | ~120 hrs | Tenant geo-demographics trigger per i18n rule | Queued |
| P1-08 | Stripe Payment Element migration | ~24 hrs | Stripe deprecates Link OR conversion data shifts | Contingent |
| P1-09 | WASM widgets (PDF gen, OCR, image processing) | ~200 hrs phased | First customer-pull feature requires it | Queued (3 phases) |
| P1-10 | LaunchDarkly migration | ~40 hrs | D1-backed feature flags hit limits (>1000 flags or <100ms latency) | Contingent |
| P1-11 | Square Web Payments fallback | ~80 hrs | Stripe Connect breaks materially in a target country | Contingent |
| P1-12 | CSP Level 3 strict-dynamic + Trusted Types | ~80 hrs | Threat escalation OR all third-party scripts ship nonce-compat | Queued |
| P1-13 | Penetration test | ~40 hrs internal + $8k vendor | v1 + 90 days post-launch | Scheduled |
| P1-14 | Bug bounty program | ~16 hrs setup | v1 + 60 days post-launch | Scheduled |
| P1-15 | Stripe Tax integration | ~60 hrs | First 50 tenants OR first multi-jurisdiction tenant | Queued |
| P1-16 | Mandatory FIDO2 hardware keys for super-admins | ~8 hrs | Second admin role added | Queued |
| P1-17 | Visual regression via Percy + Chromatic | ~24 hrs | Storybook (P1-04) ships | Depends on P1-04 |
| P1-18 | Cross-tenant analytics dashboard | ~80 hrs | Platform-wide reporting demand | Queued |
| P1-19 | Outbound webhook destination management | ~60 hrs | First tenant requests Zapier-like outbound | Queued |
| P1-20 | Tenant API keys + public REST docs | ~80 hrs | First developer-tenant requests programmatic site access | Queued |
| P1-21 | AI agent for tenant onboarding ("guide me") | ~100 hrs | Conversion data shows onboarding drop-off >40% | Queued |
| P1-22 | Real-time collaborative editing (multi-user) | ~200 hrs | Tenants seat >5 users on the same site | Queued |
| P1-23 | Marketplace search with vector embedding | ~80 hrs | Marketplace listings exceed 1000 entries | Queued |
| P1-24 | A/B testing infrastructure (server-side) | ~40 hrs | Brian wants pricing/conversion variants | Queued |
| P1-25 | Tenant billing portal (Stripe Customer Portal embedded) | ~16 hrs | Manual subscription change requests >5/wk | Queued |
| P1-26 | GitHub Actions → Cloudflare deploy via OIDC | ~8 hrs | Manual `wrangler deploy` happens >2x/wk | Queued |
| P1-27 | D1 → R2 export quarterly drill | ~4 hrs/quarter | Q1 2026, then quarterly | Scheduled |
| P1-28 | Service-bound rate-limit redesign (KV → Workers Rate Limiting API everywhere) | ~16 hrs | KV cost >$10/mo for rate-limit counters | Queued |
| P1-29 | Image optimization pipeline (Sharp → Cloudflare Images) | ~24 hrs | Tenant image bandwidth costs >$50/mo | Queued |
| P1-30 | Tenant-facing audit log viewer | ~40 hrs | First compliance-conscious tenant requests it | Queued |

## P1-01 Tauri 2 desktop shells

**What:** Native macOS / Windows / Linux desktop apps wrapping the Angular admin SPA.

**Why post-v1:** Mobile (Capacitor 6) is the higher-value cross-platform target. Desktop usage is browser-first for the first 6 months.

**Trigger:** Capacitor 6 mobile ships AND 50+ tenants explicitly request desktop AND we have a use case that demands native (file system, system tray, OS notifications) beyond what a PWA can do.

**Cost:** ~120 hours. Tauri 2 GA mid-2025; Rust scaffold + Angular embed + auto-update + code signing pipeline.

**Stack:** Tauri 2 + Rust core + Angular SPA loaded via `tauri://localhost`. Same Angular bundle as web; conditional native bridges via Tauri commands.

**Dependencies:** Capacitor mobile must ship first to prove the cross-platform architecture.

## P1-02 Apollo Angular + GraphQL gateway

**What:** A GraphQL layer in front of the Hono REST API. Apollo Client in the Angular apps. Schema-first design with code generation.

**Why post-v1:** REST + RxJS + `HttpClient` is sufficient at the v1 endpoint count (~25 routes). GraphQL adds value when (a) the mobile app needs federated queries, (b) different surfaces need different field sets, or (c) caching becomes a bottleneck.

**Trigger:** REST API surface >40 endpoints OR mobile app explicitly requests field-selection efficiency OR third tenant requests a public API.

**Cost:** ~160 hours.

**Stack:** GraphQL Yoga or Apollo Server on a Worker, federated to subgraphs per domain (auth, billing, sites, marketplace). Apollo Angular client with cache normalization.

## P1-03 NgRx Signal Store formalization

**What:** Replace ad-hoc service-based state (`AdminStateService` + visibility-aware polling pattern) with NgRx Signal Store for state-heavy domains.

**Why post-v1:** The `AdminStateService` pattern works. Premature abstraction risks trading working code for ceremony. Wait until 3+ surfaces independently want the same pattern.

**Trigger:** Three distinct features (admin dashboard, marketplace job tracking, notifications inbox) converge on the same state-shape needs.

**Cost:** ~40 hours.

**Stack:** `@ngrx/signals` (the new Signal Store) + `@ngrx/operators` for RxJS-bridged effects.

## P1-04 Storybook 8 component library

**What:** A documented, visually-tested component library for `libs/ui`.

**Why post-v1:** The wrap-layer around PrimeNG is small (~10 components in v1). Storybook ROI kicks in around 20+ components.

**Trigger:** `libs/ui` reaches 20 wrap-layer components OR a designer joins the team.

**Cost:** ~60 hours.

**Dependencies:** Required precursor for P1-17 (visual regression).

## P1-05 SAML / OIDC enterprise SSO

**What:** SSO for Enterprise-tier tenants via SAML 2.0 (Okta, Azure AD, OneLogin, Ping) and OIDC (Google Workspace, Auth0, Keycloak).

**Why post-v1:** Clerk supports SSO out of the box via their Enterprise plan. Scaffold the integration but don't enable until an Enterprise deal demands it.

**Trigger:** First Enterprise tier prospect explicitly contingent on SSO support.

**Cost:** ~80 hours.

**Pre-v1 prep:** Schema is SSO-ready (`users.external_id`, `orgs.idp_metadata_url` columns exist with nulls); UI surfaces are flag-gated behind `ENABLE_SSO=false`.

## P1-06 SOC 2 Type II readiness

**What:** Formal SOC 2 Type II audit prep: documented policies, control evidence collection, third-party auditor engagement.

**Why post-v1:** Substantive controls are in place (SECURITY.md § 2). Missing piece is *formal documentation and audit trail*. SOC 2 Type II requires 6 months of operational evidence before audit can begin.

**Trigger:** First Enterprise prospect requires SOC 2 Type II report as deal-gate.

**Cost:** ~480 hours over 9 months. Compliance platform ($15k/yr Drata or similar), policy authoring, control evidence collection, auditor engagement (~$30k–$50k), gap remediation.

## P1-07 Full i18n mirror (ES, FR, PT, ZH-Hans)

**What:** Per-locale route mirrors (`/es/*`, `/fr/*`, `/pt/*`, `/zh-Hans/*`) for marketing site, admin (translated UI strings), and tenant-runtime template defaults.

**Why post-v1:** Per `rules/i18n-by-demographics.md`, locales auto-fire when ≥10% community share is detected in the tenant's service area. v1 launches with English only; locale auto-fire kicks in per-tenant as they onboard.

**Trigger:** Tenant geo-demographics meet the auto-fire threshold OR Brian explicitly prioritizes a market expansion.

**Cost:** ~120 hours.

**Languages prioritized:** Spanish → Portuguese → French → Simplified Chinese.

## P1-08 Stripe Payment Element migration

**What:** Migrate from Stripe Link-only to Stripe Payment Element (full payment method matrix: cards, ACH, Apple Pay, Google Pay, BNPL, bank redirects).

**Why post-v1:** Per ADR-0004, Link is the v1 choice for conversion lift and integration simplicity.

**Trigger:** Either Stripe deprecates Link, or conversion data shows Link underperforming Payment Element in a target market.

**Cost:** ~24 hours.

## P1-09 WASM widgets (PDF generation, OCR, image processing)

**What:** Three Worker-deployed WASM modules:

- **PDF generation:** wkhtmltopdf or weasyprint compiled to WASM for invoices/receipts/exports
- **OCR:** Tesseract-WASM for tenant receipt-scanning feature
- **Image processing:** Sharp compiled to WASM for runtime resizing in tenant-runtime

**Trigger per phase:**

- PDF: first tenant requests branded PDF invoices
- OCR: first marketplace tenant requests scan-receipt-to-expense feature
- Image: tenant image bandwidth exceeds $50/mo (intersects with P1-29)

**Cost:** ~200 hours total, phased (~70 PDF, ~70 OCR, ~60 image).

**Stack:** Cloudflare Workers WASM runtime; each module a separate Worker bound as service binding.

## P1-10 LaunchDarkly migration

**What:** Move feature flags from D1-backed tables to LaunchDarkly.

**Why post-v1:** D1 + KV cache handles feature flags fine at our scale.

**Trigger:** Flag count exceeds 1000 OR per-user evaluation latency exceeds 100ms on a hot path.

**Cost:** ~40 hours.

## P1-11 Square Web Payments fallback

**What:** Add Square Web Payments SDK as alternative payment rail for the country exclusion list (BILLING.md § 6).

**Why post-v1:** Per ADR-0004, Stripe Link is the exclusive v1 rail. Square is explicitly skipped. This entry exists for the contingency where Stripe Connect breaks materially in a country we care about.

**Trigger:** Stripe Connect breaks materially in a country with ≥10 paying tenants OR an Enterprise prospect requires Square POS integration.

**Cost:** ~80 hours.

**Status:** Contingent only. Not pre-built.

## P1-12 CSP Level 3 strict-dynamic + Trusted Types

**What:** Per SECURITY.md § 3.1, the strict-dynamic CSP with per-response nonces + Trusted Types policies on every DOM mutation.

**Trigger:** Either (a) threat profile escalates (HIPAA, FedRAMP, finserv regulated tenant), or (b) all four third-party scripts (Stripe, Clerk, PostHog, Sentry) ship clean nonce-compatible loaders. Monitor third-party docs quarterly.

**Cost:** ~80 hours.

## P1-13 Penetration test

**When:** v1 + 90 days. Budget $8k. Vendor TBD (Trail of Bits, NCC Group, Doyensec shortlisted).

**Status:** Scheduled.

## P1-14 Bug bounty program

**When:** v1 + 60 days post-launch. Reward range $500–$5k. Scope: production domains.

**Status:** Scheduled.

## P1-15 Stripe Tax integration

**Why post-v1:** Per BILLING.md § 8, tax responsibility is explicitly deferred to tenants in v1.

**Trigger:** First 50 tenants milestone OR first multi-jurisdiction tenant.

**Cost:** ~60 hours.

## P1-16 Mandatory FIDO2 hardware keys for super-admins

**Why post-v1:** Currently single super-admin (Brian). Adding a hardware-key requirement on top of passkey is incremental risk reduction at low ROI for a single admin.

**Trigger:** Second admin role added.

**Cost:** ~8 hours.

## P1-17 Visual regression via Percy + Chromatic

**What:** Percy for full-page visual regression on marketing + admin; Chromatic for component-level on Storybook.

**Trigger:** Storybook (P1-04) ships.

**Cost:** ~24 hours.

## P1-18 Cross-tenant analytics dashboard

**What:** Platform-wide reporting (GMV across all tenants, signup funnel, retention cohorts, expansion revenue).

**Why post-v1:** Per ADR-0008, per-tenant D1 isolation means cross-tenant queries need fan-out. A nightly aggregation Workflow handles this; we just don't have a UI for it.

**Trigger:** Brian wants to look at the data more than weekly.

**Cost:** ~80 hours.

## P1-19 Outbound webhook destination management

**What:** Tenants configure outbound webhooks ("when a booking happens, POST to my Zapier") with retry, dead-letter, signing.

**Trigger:** First tenant requests Zapier-like outbound.

**Cost:** ~60 hours.

## P1-20 Tenant API keys + public REST docs

**What:** Programmatic access for tenants. Per-tenant API keys with scoped permissions, OpenAPI-generated public docs.

**Trigger:** First explicit developer-tenant signup + API request.

**Cost:** ~80 hours.

## P1-21 AI agent for tenant onboarding

**What:** A conversational onboarding copilot using Claude Opus 4.7 via AI Gateway. "Walk me through setting up my plumbing business site" → tool calls into platform APIs.

**Trigger:** Conversion data shows >40% drop-off in onboarding funnel.

**Cost:** ~100 hours.

## P1-22 Real-time collaborative editing (multi-user)

**What:** Two-or-more users editing the same tenant site simultaneously with conflict resolution.

**Trigger:** Tenants seat >5 users on the same site OR agency-tier tenant requests it.

**Cost:** ~200 hours.

**Stack:** Yjs CRDT or Automerge on Durable Object.

## P1-23 Marketplace search with vector embedding

**What:** Semantic search over marketplace listings via Vectorize.

**Trigger:** Marketplace listings exceed 1000 OR keyword search relevance complaints.

**Cost:** ~80 hours.

**Stack:** Vectorize index per tenant, embedding pipeline (Workers AI BGE-large), hybrid keyword+vector search ranking.

## P1-24 A/B testing infrastructure (server-side)

**Trigger:** Brian wants to test pricing or conversion variants experimentally.

**Cost:** ~40 hours.

## P1-25 Tenant billing portal (Stripe Customer Portal embedded)

**Trigger:** Manual subscription change requests exceed 5/week.

**Cost:** ~16 hours.

## P1-26 GitHub Actions → Cloudflare deploy via OIDC

**What:** Migrate manual `wrangler deploy` to GitHub Actions with Cloudflare OIDC trust policy.

**Trigger:** Manual deploys happen >2x/week.

**Cost:** ~8 hours.

## P1-27 D1 → R2 export quarterly drill

**What:** Quarterly restore-from-backup drill. Pick a random tenant DB, restore the nightly R2 backup to a scratch DB, verify integrity.

**When:** Q1 2026, then quarterly.

**Cost:** ~4 hours per drill.

**Status:** Scheduled.

## P1-28 Service-bound rate-limit redesign

**What:** Replace KV-backed rate-limit counters with Workers Rate Limiting API everywhere, including tier-quota counters.

**Trigger:** KV cost for rate-limit counters exceeds $10/mo OR counter latency exceeds 50ms budget.

**Cost:** ~16 hours.

## P1-29 Image optimization pipeline (Sharp → Cloudflare Images)

**What:** Move from build-time Sharp triplet generation (AVIF+WebP+JPEG) to runtime Cloudflare Images for tenant uploads.

**Trigger:** Tenant image bandwidth costs exceed $50/mo.

**Cost:** ~24 hours.

## P1-30 Tenant-facing audit log viewer

**What:** Tenants can see their own audit log (sign-ins, settings changes, payouts) in the admin UI.

**Trigger:** First compliance-conscious tenant requests it.

**Cost:** ~40 hours.

## Dropped (kept for transparency)

_None yet. First quarterly review on 2026-08-26._

## Promotion process

1. Each month, walk the index and re-evaluate triggers.
2. Items whose triggers fired → move into the active sprint board (top section of this file).
3. Items whose triggers became impossible → strikethrough with reason.
4. Items whose costs have changed materially → update Cost column.
5. New post-v1 items → append to the bottom with the next P1-NN number.
