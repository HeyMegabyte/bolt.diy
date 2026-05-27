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
