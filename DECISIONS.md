# Architecture Decision Records — projectsites.dev v2

> **Format:** [MADR 3.0](https://adr.github.io/madr/) — Markdown Any Decision Record, v3.0.
> **Cadence:** One ADR per material architectural commitment. Append-only. Status transitions
> recorded inline. Never edit the "Decision" of an accepted ADR — supersede with a new ADR.
> **Numbering:** Zero-padded, monotonic. `ADR-0001` … `ADR-NNNN`. Never reused.
> **Owner:** Architect role. Co-signed by Brian Zalewski for any change to `Status: Accepted`.

## Index

| #    | Title                                                    | Status   | Date       | Supersedes |
| ---- | -------------------------------------------------------- | -------- | ---------- | ---------- |
| 0001 | Adopt Nx 20 monorepo as workspace shell                  | Accepted | 2026-05-26 | —          |
| 0002 | Angular 21 + standalone + signals + zoneless             | Accepted | 2026-05-26 | —          |
| 0003 | PrimeNG 18 + Tailwind v4 as the UI substrate             | Accepted | 2026-05-26 | —          |
| 0004 | Stripe Link exclusively for all payment capture          | Accepted | 2026-05-26 | —          |
| 0005 | Cloudflare-native runtime: Workers + D1 + R2 + DO        | Accepted | 2026-05-26 | —          |
| 0006 | RxJS-first at the backend edge, signals at the template  | Accepted | 2026-05-26 | —          |
| 0007 | Server-Sent Events as the default real-time transport    | Accepted | 2026-05-26 | —          |
| 0008 | One D1 database per tenant site, auto-provisioned        | Accepted | 2026-05-26 | —          |

---

## ADR-0001 — Adopt Nx 20 monorepo as workspace shell

- **Status:** Accepted
- **Date:** 2026-05-26
- **Deciders:** Brian Zalewski, Architect
- **Tags:** `tooling`, `monorepo`, `build`

### Context and problem statement

The current `bolt.diy` repo is a flat pnpm workspace with three top-level packages
(`app/`, `apps/project-sites/`, `packages/shared/`) and no cross-project graph awareness.
`pnpm install` is broken at the root because `electron-builder`'s SSH transport pulls a
dependency that fails on Apple Silicon. Sub-packages survive only because each runs
`npm install --legacy-peer-deps` in isolation, which forfeits hoisting, dedup, and any
notion of "affected" change detection. Adding more apps (control-plane Worker, tenant
runtime template, Ionic mobile shell, Angular SSR worker, future Tauri desktop shell)
on top of this substrate would compound the install pain and erase the chance of fast PR
feedback.

We need a workspace tool that:

1. Computes the **affected graph** so PR CI only re-runs what actually changed
2. Caches builds, tests, lints, typechecks — both locally and remotely (Nx Cloud)
3. Generates new apps and libraries with `nx g` schematics that bake in our stack defaults
4. Co-exists with Cloudflare Wrangler builds and Angular CLI builds without rewriting either
5. Has first-class Angular support — Angular 21, signals, zoneless, standalone

### Considered options

| Option            | Affected graph | Cache | Angular plugin   | Maturity | Verdict        |
| ----------------- | -------------- | ----- | ---------------- | -------- | -------------- |
| **Nx 20**         | Yes            | Local + Remote (Nx Cloud) | First-class `@nx/angular` | High | **Chosen**     |
| Turborepo         | Yes            | Local + Remote (Vercel)   | Generic only      | High | Rejected — Angular generators are second-class; ties remote cache to Vercel |
| Rush              | Yes            | Local only       | Generic only      | High | Rejected — heavy ceremony, weak Angular integration |
| pnpm workspaces   | No             | No               | None              | High | Rejected — current state, demonstrably broken |
| Bazel             | Yes            | Local + Remote   | Custom rulesets   | Medium | Rejected — overkill, Angular rules brittle |

### Decision

Adopt **Nx 20** as the workspace shell. Migrate the existing three packages into
`apps/web`, `apps/control-plane`, `libs/shared`, `libs/ui`, `libs/data-access`, and seed
new apps (`apps/tenant-runtime`, `apps/mobile`, `apps/cli`) under the same graph. Enable
Nx Cloud for remote caching with a per-org access token. Use `nx g @nx/angular:app` and
`nx g @nx/angular:lib` for every new surface — never `ng new` directly.

### Consequences

**Positive:**

- PR CI runs only the affected projects. Typical PR touching one Angular component
  triggers ~2–4 project rebuilds instead of the whole tree.
- `nx graph` produces a queryable dependency map. Architectural drift (e.g., a worker
  importing a UI lib) is caught by Nx module boundaries lint rules.
- Schematics enforce stack defaults: every new Angular app ships with signals, zoneless,
  standalone, ESLint flat config, Vitest, Tailwind v4, PrimeNG preset.
- Nx Cloud distributes CI execution across multiple agents, cutting wall-time roughly
  in half on a 4-agent fan-out.

**Negative:**

- `nx.json` adds a layer of config above each project's `project.json`. Onboarding cost
  is a 30-minute read for new contributors.
- Nx Cloud is a paid SaaS above the free tier. Budgeted at ~$30/mo for the team.
- Migrating the existing `pnpm-workspace.yaml` paths requires moving `apps/project-sites`
  to `apps/control-plane` and rewiring imports. One-time pain, ~4 hours.

**Mitigations:**

- Provide a `nx affected:graph` view in CI artifacts so reviewers see the blast radius
  of every PR.
- Document the migration as a single `migrate-to-nx.md` runbook (see [[ARCHITECTURE.md]]
  appendix).
- Set up `nx repair` as a `predeploy` step so schema drift between Nx versions surfaces
  immediately.

### References

- Nx 20 release notes — affected graph + Nx Cloud DTE (distributed task execution)
- `~/.claude/plugins/heymegabyte-claude-skills/rules/angular-nx-monorepo.md` — the user-level
  rule that mandates Nx for every Angular workspace
- ADR-0002 (Angular 21) — depends on this scaffold

---

## ADR-0002 — Angular 21 + standalone + signals + zoneless

- **Status:** Accepted
- **Date:** 2026-05-26
- **Deciders:** Brian Zalewski, Architect
- **Tags:** `frontend`, `angular`, `reactivity`

### Context and problem statement

The user-facing surfaces of projectsites.dev v2 — the marketing site, the admin SPA, the
tenant runtime (generated business sites), the mobile shell, and the future desktop shell
— all need a single frontend framework. Brian has explicitly pinned the project to
**Angular** (per `~/.claude/CLAUDE.md` § Frontend Stack: "explicitly says Angular" OR
"signal-heavy enterprise tooling is load-bearing"). React+Vite is the default in the
user-level rule, but ProjectSites.dev is one of the two named exceptions.

The question is no longer "Angular vs React" — it's "which Angular configuration?" Angular
17 brought standalone components and signals. Angular 18 stabilized `linkedSignal` and
`resource`. Angular 19 made zoneless change detection a first-class provider. Angular 20
deprecated `*ngIf` / `*ngFor` in favor of `@if` / `@for`. Angular 21 (current stable)
removes them entirely in v22.

Locking the choice now avoids three later-stage migrations.

### Considered options

| Configuration                                          | Verdict       |
| ------------------------------------------------------ | ------------- |
| Angular 17 + NgModules + RxJS-only                     | Rejected — legacy ceremony, no signals, deprecated control flow |
| Angular 19 + standalone + signals + Zone.js            | Rejected — Zone.js patches everything async; performance ceiling is lower |
| **Angular 21 + standalone + signals + zoneless**       | **Chosen**    |
| Angular 21 + standalone + RxJS-only (no signals)       | Rejected — signals are the inter-component contract Brian's projects need |

### Decision

Adopt **Angular 21** with:

- **Standalone components only.** No NgModules. `bootstrapApplication(AppComponent)`
  with `provideRouter`, `provideHttpClient(withFetch(), withInterceptors([...]))`,
  `provideAnimationsAsync()`, `provideZonelessChangeDetection()` in `app.config.ts`.
- **Signals for component + service state.** `signal`, `computed`, `effect`,
  `linkedSignal`, `resource` for HTTP. No RxJS subjects in component state.
- **RxJS for HTTP / WebSocket / event streams only** (see ADR-0006 for the boundary
  rule).
- **Zoneless change detection** via `provideZonelessChangeDetection()`. Drop `zone.js`
  from `polyfills`.
- **Typed Reactive Forms.** `FormGroup<T>`, `FormControl<T>`. No template-driven forms.
- **`@defer` blocks** for below-the-fold and role-conditional rendering.
- **Lazy-loaded routes** via `loadComponent` / `loadChildren`. Every route lazy.
- **Modern control flow** (`@if`, `@for`, `@switch`, `@defer`) — never `*ngIf` /
  `*ngFor`.

### Consequences

**Positive:**

- Signals deliver fine-grained change detection without Zone.js. Hot paths (typing in a
  search input, dragging the timeline scrubber) no longer fan out to the whole component
  tree.
- Standalone components remove the NgModule import-export-declarations ceremony. Every
  component is a single file with its own imports list.
- Zoneless cuts the framework runtime by ~30 KB gzipped and removes the async-stack
  noise from Sentry traces.
- Typed forms catch field-shape drift at compile time.
- `@defer` makes "load this section only when in viewport" a one-line directive.

**Negative:**

- Some third-party Angular libraries still ship NgModules. Need to wrap them in a
  standalone shim or wait for the maintainer to migrate.
- Zoneless surfaces every `setTimeout` / unhandled promise that previously hid behind
  Zone.js's monkey-patching. One-time audit cost.
- Signals + RxJS interop (`toSignal`, `toObservable`) adds a small mental model layer.
  Mitigated by ADR-0006's strict boundary rule.

**Mitigations:**

- Maintain a `libs/ui/legacy-module-shim` for the handful of NgModule-only deps until
  they migrate. Audit quarterly.
- Add a Vitest + Playwright "zoneless smoke" suite that asserts every route mounts
  without Zone.js patching. CI gate.
- Document the signals ↔ RxJS interop pattern in `rules/rxjs-first-angular.md` (see
  ADR-0006).

### References

- Angular 21 release notes — zoneless GA
- Angular Signals RFC
- ADR-0001 (Nx 20) — workspace scaffold
- ADR-0006 (RxJS-first at the edge) — interop contract
- `~/.claude/plugins/heymegabyte-claude-skills/rules/angular-nx-monorepo.md`

---

## ADR-0003 — PrimeNG 18 + Tailwind v4 as the UI substrate

- **Status:** Accepted
- **Date:** 2026-05-26
- **Deciders:** Brian Zalewski, Architect
- **Tags:** `ui`, `design-system`, `frontend`

### Context and problem statement

projectsites.dev v2 needs a UI substrate that delivers:

1. ~150 polished components out of the box (admin dashboards have dense surface area)
2. Theming via CSS custom properties so the marketing site, admin, and tenant runtime can
   diverge brand-wise without forking components
3. First-class Angular 21 + standalone + signals support
4. No vendor lock-in on the design tokens — must work with the W3C DTCG tokens spec
5. Accessibility ≥ WCAG 2.2 AA out of the box (we still audit, but the baseline can't
   be "rebuild from div")

Angular Material is the obvious incumbent. PrimeNG is the obvious alternative. Tailwind
is the utility layer regardless.

### Considered options

| UI library              | Components | Tailwind compat | Standalone | A11y baseline | Verdict       |
| ----------------------- | ---------- | --------------- | ---------- | ------------- | ------------- |
| Angular Material 21     | ~50        | Conflicts with `.mat-*` overrides | Yes  | Strong       | Rejected — opinionated visual style, hard to rebrand |
| **PrimeNG 18**          | ~150       | Compatible via `tailwind-primeng` preset | Yes  | Strong       | **Chosen**    |
| Spartan UI (Angular shadcn) | ~30   | Native            | Yes  | Strong       | Rejected — too thin for admin density |
| Build-from-scratch + CDK | ~0        | Native            | Yes  | Manual       | Rejected — months of work for table-stakes components |
| Nebular                 | ~40        | Limited           | Yes  | Medium       | Rejected — slower release cadence, smaller community |

### Decision

Adopt **PrimeNG 18** as the component library + **Tailwind v4** as the utility layer
+ **W3C DTCG tokens** as the design source of truth.

- PrimeNG components via the `Aura` preset, themed with CSS custom properties driven
  from `tokens.json` (DTCG-compliant).
- Tailwind v4 CSS-first config in `app.css`. No `tailwind.config.ts`.
- `@tailwindcss/primeui` plugin bridges PrimeNG component classes to Tailwind utilities
  so `p-button` can be extended with `class="!rounded-2xl"` without specificity wars.
- Custom components live in `libs/ui/` and wrap PrimeNG primitives — never ship raw
  PrimeNG to product surfaces. The wrap layer is where we apply brand tokens,
  motion choreography, and accessibility refinements.

**Banned:**

- Angular Material in any app
- Bootstrap, Bulma, or any non-Tailwind CSS framework
- Inline `[ngStyle]` / `[ngClass]` for static bindings (use `class` / `style` directly)
- CSS-in-JS (Emotion, Styled Components) — Tailwind + CSS custom properties only

### Consequences

**Positive:**

- PrimeNG gives us TreeTable, Calendar, Charts, DataView, Splitter, OrgChart, Mention,
  PickList — admin-dense components Material doesn't ship.
- Tailwind v4's CSS-first config simplifies the toolchain (no PostCSS plugin chain, no
  JS config file). Vite picks it up natively.
- DTCG tokens become the cross-platform handoff format. Mobile (Ionic) and future
  desktop (Tauri) consume the same `tokens.json`.
- Theme swap is a one-line CSS variable override per tenant site.

**Negative:**

- PrimeNG's default visual style needs aggressive rebranding. Budgeted as a one-time
  ~16-hour design token + wrap-layer pass.
- The `tailwind-primeng` preset is community-maintained. Pin the version.
- Some PrimeNG components (Mention, AutoComplete) ship with their own template-driven
  form integrations. Wrap layer normalizes to typed Reactive Forms.

**Mitigations:**

- Snapshot the `Aura` preset version in `package.json` with a hard pin, not a caret.
- Storybook for every wrap-layer component (BACKLOG.md — post-v1).
- Visual regression via Playwright `toHaveScreenshot()` on the wrap-layer fixtures.

### References

- PrimeNG 18 docs
- Tailwind v4 release notes (CSS-first config)
- W3C DTCG tokens spec
- ADR-0002 (Angular 21) — required substrate

---

## ADR-0004 — Stripe Link exclusively for all payment capture

- **Status:** Accepted
- **Date:** 2026-05-26
- **Deciders:** Brian Zalewski, Architect
- **Tags:** `payments`, `billing`, `pci`

### Context and problem statement

projectsites.dev v2 captures money across three distinct rails:

1. **SaaS subscription** — tenants pay $50/mo + $0.001/req metered overage for
   platform access
2. **Tenant-site marketplace bookings** — end-users on tenant sites pay tenants for
   services; we take a platform fee via Stripe Connect
3. **One-off tenant addons** — domain registration ($12/yr), premium templates ($29),
   priority support ($99/mo)

The user-level rule `rules/payments-routing.md` decision tree allows Square for
sub-$100 averages + POS + hybrid in-person/online, and Stripe Billing for SaaS
subscriptions when ≥2 enterprise criteria match. The doctrine for v2 collapses both to
**Stripe Link exclusively** for three reasons:

1. **Single integration surface.** One SDK, one webhook handler, one idempotency model,
   one PCI scope. Square + Stripe is two of everything.
2. **Link is the conversion edge.** Stripe Link's saved-card-across-merchants flow
   converts ~14% better than vanilla card entry in Stripe's published benchmarks. We
   want that lift on every transaction.
3. **Connect Express is mandatory for the marketplace.** Tenants are the merchants of
   record; we are the platform. Stripe Connect Express + Link composes natively.
   Square has no equivalent.

Brian's user-level rule allows the exception when a project chooses Stripe — this
ADR documents the choice for v2.

### Considered options

| Configuration                                       | Verdict       |
| --------------------------------------------------- | ------------- |
| Square Web Payments SDK (per global default rule)   | Rejected — no Connect equivalent for tenant payouts |
| Stripe Payment Element (current Stripe default)     | Rejected — Link delivers the conversion lift; PaymentElement is more generic |
| **Stripe Link exclusively** + Connect Express       | **Chosen**    |
| Mixed: Stripe for SaaS, Square for marketplace      | Rejected — doubles integration surface |
| Adyen                                               | Rejected — enterprise pricing tier irrelevant for v1 |

### Decision

Adopt **Stripe Link** as the sole payment capture surface for all rails:

- **SaaS subscriptions** — Stripe Billing + Link on the checkout. `stripe.subscriptions.create`
  with `payment_settings.payment_method_types: ['link']`.
- **Tenant marketplace bookings** — Stripe Connect Express. Tenants onboard via
  Express. End-users pay through Link with `application_fee_amount` set per BILLING.md
  take-rate logic. Tenants are the merchant of record.
- **One-off addons** — Stripe Payment Links with Link enabled.
- **Webhook handler** — single `/webhooks/stripe` endpoint with signature verification,
  D1-backed `payment_events(event_id UNIQUE, ...)` idempotency table, 5-minute replay
  window per Stripe docs.
- **Connect Express onboarding** — embedded onboarding component via `stripe.accountLinks.create`
  with `type: 'account_onboarding'`. No off-platform redirect.
- **No Square. No Payment Element. No alternative methods.** If Stripe deprecates Link
  or a country breaks materially, the contingency lives in BACKLOG.md (Square Web
  Payments fallback).

### Consequences

**Positive:**

- Single SDK = single point of upgrade, single CSP entry, single API key secret. PCI
  scope is `SAQ-A` since cards never touch our servers (Link tokenizes client-side).
- Conversion lift on every checkout. Compounds across every tenant marketplace.
- Stripe Tax bolts on cleanly when we eventually add it (post-v1).
- Stripe Identity bolts on cleanly for tenant KYC (post-v1).
- Webhook handler is one file, one idempotency table, one observability dashboard.

**Negative:**

- Stripe processing fees are higher than Square for sub-$10 transactions (Stripe:
  2.9% + $0.30; Square: 2.6% + $0.10). For a $5 booking, Stripe takes $0.45 vs Square's
  $0.23. Accepted because we don't expect <$10 transactions to dominate.
- Stripe Connect is unavailable in ~20 countries (China, Russia, parts of Africa).
  Exclusion list documented in BILLING.md § 6.
- Link's "saved across merchants" UX requires users to opt in; first-time conversion
  lift is smaller than returning-user lift.

**Mitigations:**

- Document the exclusion list in BILLING.md and surface a friendly "We're not yet
  available in your country" message via geo-IP at checkout.
- Monitor sub-$10 transaction volume in PostHog; revisit if it exceeds 20% of GMV.
- Backlog Square Web Payments as a contingency (BACKLOG.md § 10).

### References

- Stripe Link conversion benchmarks (Stripe blog, 2024)
- Stripe Connect Express docs
- ADR-0005 (Cloudflare-native runtime) — webhook handler lives in Workers
- BILLING.md — take-rate math
- `~/.claude/plugins/heymegabyte-claude-skills/rules/payments-routing.md` — global rule + this exception

---

## ADR-0005 — Cloudflare-native runtime: Workers + D1 + R2 + DO

- **Status:** Accepted
- **Date:** 2026-05-26
- **Deciders:** Brian Zalewski, Architect
- **Tags:** `infrastructure`, `runtime`, `cloudflare`

### Context and problem statement

projectsites.dev v2 needs a runtime substrate that:

1. **Edge-deploys globally** with no region selection cost — tenants and end-users live
   everywhere
2. **Scales to zero** — most tenant sites are low-traffic; we cannot pay for idle
   compute
3. **Supports per-tenant data isolation** — every tenant gets their own database (see
   ADR-0008)
4. **Co-locates storage with compute** — every request that needs S3-equivalent storage,
   KV cache, or relational DB has sub-10ms latency
5. **Composes natively with Stripe webhooks, AI inference, durable state** — all in one
   account, one billing line, one observability surface

The user-level rule `~/.claude/plugins/heymegabyte-claude-skills/CLAUDE.md` § Stack pins
the default to "CF Workers + Hono" for edge, "D1 (read-replicas, Sessions API)" for DB,
"R2" for object storage, "Workflows v2" for jobs. v2 commits hard to this default.

### Considered options

| Stack                                              | Verdict       |
| -------------------------------------------------- | ------------- |
| **Cloudflare Workers + D1 + R2 + DO + Workflows v2** | **Chosen**    |
| AWS Lambda + RDS + S3 + Step Functions             | Rejected — region pinning, cold starts, multi-account observability |
| Vercel Functions + Neon + Vercel Blob              | Rejected — Vercel lock-in; Neon is fine but adds a vendor |
| Fly.io + Postgres + Tigris                         | Rejected — smaller edge footprint; Fly Machines have warm-pool cost |
| Render + Postgres + Render Disks                   | Rejected — single-region by default |
| Bare-metal + k3s + Postgres + MinIO                | Rejected — ops burden incompatible with solo build |

### Decision

Commit to a **Cloudflare-native** runtime for v2:

- **Compute:** Cloudflare Workers running Hono v4 for all API surfaces (control-plane,
  tenant-runtime, edge cache invalidation handlers). SSR for Angular via Angular SSR
  worker.
- **Relational data:** Cloudflare D1 — one platform-level database for control-plane
  state (tenants, subscriptions, users, audit), one D1 per tenant site for tenant data
  (see ADR-0008). Read replicas via Sessions API where read load justifies it.
- **Object storage:** Cloudflare R2 — static site bundles at `sites/{slug}/{version}/`,
  marketing assets at `marketing/`, generated PDFs at `documents/{tenant}/`. Lifecycle:
  Standard → Infrequent Access after 30 days for archives.
- **Durable state:** Cloudflare Durable Objects (SQLite-backed) for per-site log
  streams, per-job chat rooms, per-user notification queues, per-tenant rate limit
  windows.
- **Background jobs:** Cloudflare Workflows v2 for the AI site generation pipeline,
  the recurring email digest, the nightly D1 → R2 backup.
- **AI inference:** Cloudflare Workers AI for first-pass LLM (Llama 3.3 70B FP8 Fast),
  AI Gateway for routing premium calls (Claude Opus 4.7, GPT-4o) with caching + rate
  limiting + fallback.
- **Edge cache:** Cloudflare KV for 60-second host-resolution lookups, prompt hot-patch
  overrides, feature flag snapshots.
- **Auth:** Clerk (M2M JWT verification at the edge via `CLERK_JWT_KEY` PEM). Sessions
  in D1 backed by KV cache.
- **Domains:** Cloudflare for SaaS for tenant custom hostnames. `*.projectsites.dev`
  wildcard for default subdomains.

**Banned by this ADR:**

- Any AWS / GCP / Azure runtime
- Any database not D1 or Neon (and Neon is only a fallback per the user-level rule —
  not used in v1)
- Any S3-compatible storage other than R2
- Any job runner other than Workflows v2 or Inngest (Inngest reserved for cross-account
  fan-out scenarios; not used in v1)

### Consequences

**Positive:**

- One account, one bill, one observability dashboard (Workers Tracing OTLP + AI Gateway
  logs + Sentry-via-Cloudflare).
- Global edge deploy is the default. No region pinning. Cold starts ~5ms.
- D1 + R2 + KV + DO + Workers AI all bind directly to the Worker — no inter-service
  HTTP calls, no auth tokens to manage between services.
- Stripe webhooks land at a Worker route, verify signature in-place, write to D1 in the
  same isolate. Sub-50ms end-to-end.
- Free-tier headroom is generous: 100k requests/day, 1 GB D1 storage per database,
  10 GB R2 storage. v1 fits in the free tier per-tenant.

**Negative:**

- D1 is SQLite. No Postgres extensions (PostGIS, pgvector via PG, RLS). Vectorize is the
  separate vector DB; we don't get RLS as the tenant-isolation primitive.
- Cloudflare-only means a single vendor for compute + storage + DNS + CDN. Risk
  documented and accepted.
- Workflows v2 is younger than AWS Step Functions. Some patterns (visual designer,
  saga compensation) are less mature.

**Mitigations:**

- Per-tenant D1 (ADR-0008) replaces RLS as the isolation primitive. Hardware-level
  separation instead of row-level filtering.
- D1 Time Travel (30-day PIT) + nightly D1 → R2 backup script + quarterly restore drill
  documented in BACKLOG.md.
- Workflows v2 saga patterns implemented as explicit compensation steps inside the
  workflow definition. Documented in `apps/control-plane/src/workflows/README.md`.

### References

- ADR-0008 (D1 per tenant) — isolation strategy
- Cloudflare Workers + D1 + R2 docs
- `~/.claude/plugins/heymegabyte-claude-skills/rules/code-style.md` § Stack

---

## ADR-0006 — RxJS-first at the backend edge, signals at the template boundary

- **Status:** Accepted
- **Date:** 2026-05-26
- **Deciders:** Brian Zalewski, Architect
- **Tags:** `angular`, `reactivity`, `architecture`

### Context and problem statement

Angular 21 signals do not replace RxJS. They specialize complementary roles:

- **Signals** are pull-based, synchronous, glitch-free, render-aware. They excel at
  *current state of a value at a moment in time*.
- **RxJS Observables** are push-based, time-aware, composable across operators (debounce,
  switchMap, retry, mergeMap). They excel at *events flowing over time*.

Without a clear boundary rule, projects oscillate between two failure modes:

1. **All-RxJS** — every component state is a `BehaviorSubject`; templates subscribe
   via `async` pipes everywhere; change detection is implicit; debugging the marble
   diagram of any non-trivial flow is a nightmare.
2. **All-signals** — every HTTP call is wrapped in a `resource()` or a manual
   `signal()` + `effect()` loop; retry, debounce, switchMap become hand-rolled in
   `effect()` callbacks; cancellation logic leaks everywhere.

We need a strict rule that aligns each tool with its strength.

### Considered options

| Boundary rule                                            | Verdict       |
| -------------------------------------------------------- | ------------- |
| All-signals (zero RxJS)                                  | Rejected — re-implements RxJS poorly |
| All-RxJS (signals only for fine-grained UI)              | Rejected — gives up zoneless wins |
| **RxJS at the edge, signals at the template boundary**   | **Chosen**    |
| Free-for-all                                             | Rejected — non-determinism |

### Decision

Adopt the boundary rule documented in
`/Users/Apple/emdash/repositories/projectsites.dev/.claude/rules/rxjs-first-angular.md`
(authored separately by the main thread):

**At the backend edge (HTTP, WebSocket, SSE, EventSource, intervals, document events):**

- All async I/O is an `Observable<T>`.
- HTTP via `HttpClient.get<T>()` etc. — never `fetch()` directly in a service.
- SSE / EventSource wrapped in `new Observable(subscriber => ...)` with proper
  teardown.
- WebSocket via `webSocket<T>()` from `rxjs/webSocket`.
- Polling via `interval(N).pipe(switchMap(() => http.get(...)))`.
- All operators (`switchMap`, `debounceTime`, `retry`, `catchError`, `share`,
  `shareReplay`) compose at the service layer.

**At the template boundary:**

- Convert the observable to a signal via `toSignal(obs$, { initialValue, requireSync, equal })`.
- Templates read the signal: `@if (data(); as d) { ... }`.
- Computed values via `computed(() => ...)` over multiple signals.
- Effects via `effect(() => { ... })` for side effects (logging, persistence).

**The interop rule (one-directional preferred):**

- `Observable → Signal` is the default direction (`toSignal`).
- `Signal → Observable` (`toObservable`) only when feeding a downstream RxJS pipeline
  (e.g., a form value driving a `switchMap` HTTP call).
- Never nest `toSignal(toObservable(toSignal(...)))` — that's a code smell, refactor.

**Banned:**

- `BehaviorSubject` in component state. Use `signal()`.
- `Subject` in services *unless* the service is fundamentally event-bus-shaped (one
  emitter, many subscribers, no replay).
- Manual subscription management in components. `toSignal` handles teardown
  automatically.
- `async` pipe. `toSignal` replaces it for new code.

### Consequences

**Positive:**

- Each tool used for its strength. No re-implementing RxJS in `effect()` callbacks.
- Zero subscription leaks in components — `toSignal` ties teardown to the injector
  context.
- Templates are signal-pure: change detection is fine-grained and zoneless-friendly.
- Service layer remains RxJS-composable for retry, debounce, race, switchMap patterns.

**Negative:**

- Two reactivity systems to teach a new contributor. Mitigated by the boundary rule
  being one-paragraph-long.
- Some interop boilerplate (`toSignal(this.userService.user$, { initialValue: null })`).
  Acceptable.

**Mitigations:**

- Lint rule (ESLint custom rule) forbidding `BehaviorSubject` in `*.component.ts`.
- Storybook examples for the canonical interop patterns.

### References

- `/Users/Apple/emdash/repositories/projectsites.dev/.claude/rules/rxjs-first-angular.md`
- Angular signals + RxJS interop docs
- ADR-0002 (Angular 21)

---

## ADR-0007 — Server-Sent Events as the default real-time transport

- **Status:** Accepted
- **Date:** 2026-05-26
- **Deciders:** Brian Zalewski, Architect
- **Tags:** `realtime`, `transport`, `architecture`

### Context and problem statement

v2 has several real-time surfaces:

1. **Site generation progress** — the admin watches a workflow run; each step emits a
   progress event
2. **Build logs** — Worker output streamed to the admin's log viewer
3. **Job tracking** (marketplace) — end-users watch a contractor's location during a
   booking
4. **Chat** — tenants chat with end-users about a booking
5. **Notifications** — server pushes "your domain is verified" / "payment received"

Three transports are viable:

- **Polling** — client sets an `interval(2000).pipe(switchMap(() => http.get(...)))`.
  Always works, but burns battery and bandwidth.
- **Server-Sent Events (SSE)** — one HTTP request, server streams events as
  `text/event-stream`. Browser EventSource handles reconnect. Works over HTTP/2
  multiplex.
- **WebSocket** — full-duplex. Required when the client needs to push frequently.

For five surfaces above, four are server-push-dominant. Only chat needs bidirectional.
And even chat can be SSE-down + plain POST-up without UX cost.

### Considered options

| Default transport     | Verdict       |
| --------------------- | ------------- |
| Polling everywhere    | Rejected — battery + bandwidth waste, perceived lag |
| WebSocket everywhere  | Rejected — overkill, no client→server burst on most surfaces |
| **SSE for push, POST for client→server bursts** | **Chosen**    |
| Mix per-surface       | Rejected — non-determinism, harder to debug |

### Decision

Adopt **Server-Sent Events** as the default real-time transport:

- **All server→client streams** go through SSE. Cloudflare Workers natively support
  SSE via `ReadableStream` with `Content-Type: text/event-stream`.
- **All client→server commands** go through plain `POST`. No `WebSocket.send`.
- **WebSocket is reserved** for true bidirectional bursty surfaces — currently none in
  v1.
- **Polling is the floor** — when an SSE connection drops and `EventSource` can't
  reconnect, the client falls back to a 30-second poll. SSE is the ceiling, polling is
  the safety net.

Implementation pattern:

```typescript
// Worker SSE endpoint (Hono)
app.get('/api/jobs/:id/stream', async (c) => {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      // ...subscribe to Durable Object event source...
      controller.enqueue(enc.encode(`event: progress\ndata: ${JSON.stringify({pct: 12})}\n\n`));
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

// Angular service wrapping EventSource as Observable
sseStream<T>(url: string): Observable<T> {
  return new Observable<T>((subscriber) => {
    const source = new EventSource(url);
    source.onmessage = (e) => subscriber.next(JSON.parse(e.data));
    source.onerror = (e) => subscriber.error(e);
    return () => source.close();
  });
}
```

### Consequences

**Positive:**

- Single transport for all push surfaces. One reconnect strategy, one auth pattern
  (cookie/JWT in header), one observability span.
- EventSource handles reconnect automatically with backoff.
- Plays cleanly with HTTP/2 multiplexing — multiple SSE streams on the same TCP
  connection.
- Cloudflare Workers don't bill differently for long-lived SSE vs short HTTP.

**Negative:**

- SSE is one-directional. Bidirectional surfaces need a parallel POST channel. Slight
  ergonomic cost.
- Some corporate proxies strip `Content-Type: text/event-stream`. Mitigated by polling
  fallback.
- Older Edge / IE11 lack EventSource. Not a supported browser matrix.

**Mitigations:**

- Polling fallback baked into the wrapper service.
- Client-side `setInterval(30_000)` heartbeat when an SSE has been silent for >60s
  (renews the connection).

### References

- MDN EventSource docs
- Cloudflare Workers + Streams docs
- ADR-0006 (RxJS-first) — SSE is wrapped in Observable

---

## ADR-0008 — One D1 database per tenant site, auto-provisioned

- **Status:** Accepted
- **Date:** 2026-05-26
- **Deciders:** Brian Zalewski, Architect
- **Tags:** `data`, `multitenancy`, `isolation`

### Context and problem statement

Multi-tenant SaaS has three classic isolation patterns:

1. **Shared schema with `tenant_id` column** — cheapest, lowest isolation, requires
   query-time discipline (every WHERE clause needs `tenant_id`).
2. **Shared database, schema-per-tenant** — stronger isolation, but Postgres-specific
   and not supported in D1 (SQLite).
3. **Database-per-tenant** — strongest isolation. Each tenant's data lives in a
   physically separate DB. Bug in one query cannot leak another tenant's data.

D1 is SQLite. There is no row-level security. Option 1 fails open in the worst case
(forget a `WHERE tenant_id` once, and the bug exposes every tenant). For a platform
where tenants are competing local businesses (a plumber and a competing plumber on the
same platform), even a small leak is reputational fatal.

D1 also has practical limits per database: 10 GB storage cap, 100k rows/sec write
ceiling. A single shared DB hits these limits well before the platform reaches scale.

### Considered options

| Pattern                                      | Isolation | Ops cost | Verdict       |
| -------------------------------------------- | --------- | -------- | ------------- |
| Shared D1 + `tenant_id` column               | Weak      | Low      | Rejected — fails open |
| Shared D1 + per-tenant schema                | N/A (D1 doesn't support) | — | Rejected — unsupported |
| **One D1 per tenant site, auto-provisioned** | Strong    | Medium   | **Chosen**    |
| One D1 per tenant + one shared platform D1   | Strong    | Medium   | Chosen (same as above; clarified) |

### Decision

**Architecture:**

- **One platform D1** — `projectsites-platform` — owns: tenants, users, sessions,
  subscriptions, payment events, audit logs, feature flags, system jobs.
- **One D1 per tenant site** — `projectsites-tenant-{slug}` — owns: tenant-specific
  content (pages, blog posts, products), tenant-specific submissions (form leads,
  bookings, contact-form messages), tenant-specific analytics (page views,
  conversions).
- **Provisioning** — on tenant signup, the control-plane Worker calls the Cloudflare
  D1 REST API (`POST /accounts/{id}/d1/database`) to create the tenant DB, then runs
  the tenant migration schema (`tenant-schema.sql`) via `db.exec()`. Total provision
  time: ~2–4 seconds.
- **Binding** — the tenant runtime Worker binds to its tenant DB via a per-Worker
  binding configured at deploy time. The tenant DB ID is stored in the platform D1's
  `tenants.d1_database_id` column.
- **Backups** — D1 Time Travel (30-day PIT recovery) is enabled per-database. A
  nightly Workflow runs `wrangler d1 export` for each tenant DB to R2 at
  `backups/{date}/{tenant}.sql.gz`. 90-day retention.

### Consequences

**Positive:**

- **Hardware-level isolation.** A bug in one tenant's query cannot reference another
  tenant's table — the table literally doesn't exist in that Worker's binding.
- **Per-tenant scaling.** Hot tenants get their own write throughput budget. Cold
  tenants don't drag.
- **Per-tenant Time Travel.** A tenant can request a PITR to 14 days ago without
  disturbing other tenants.
- **GDPR/CCPA right-to-delete.** Drop the database. Done. No "delete from 14 tables
  where tenant_id=…" runbook.
- **Per-tenant export.** `wrangler d1 export` produces a portable SQL dump on demand.

**Negative:**

- **Cross-tenant queries are impossible** at the DB layer. Platform-wide reports
  (e.g., "total bookings across all tenants this week") require fan-out: query each
  tenant DB, aggregate in the Worker. Mitigated by a nightly aggregation Workflow that
  writes summaries to the platform D1.
- **Schema migrations fan out.** A new column on `pages` requires running the migration
  against every tenant DB. Mitigated by a `migrate-all-tenants.ts` Workflow that runs
  the migration in parallel batches of 50 with Time Travel snapshots before each
  batch.
- **D1 has a per-account database count limit** (currently 100k on the paid plan; v1
  fits comfortably).

**Mitigations:**

- Nightly aggregation Workflow writes per-tenant summaries to the platform D1 for
  platform-wide reporting.
- Schema migrations gated by a `migrations-applied` table per tenant DB to prevent
  double-application.
- Provisioning idempotent: retry-safe; if the D1 already exists, skip create and run
  pending migrations.
- Per-tenant DB IDs cached in KV with a 5-minute TTL so the control-plane doesn't hit
  the platform D1 on every request to resolve the binding.

### References

- ADR-0005 (Cloudflare-native)
- D1 REST API docs — `POST /accounts/{id}/d1/database`
- Cloudflare D1 Time Travel docs
- ARCHITECTURE.md § Tenant data plane

---

## Process notes

### How to add an ADR

1. Pick the next number: `ls -1 DECISIONS.md` and find the highest `ADR-NNNN`.
2. Copy the template (below) into the bottom of this file.
3. Set `Status: Proposed`.
4. PR with the new ADR. Reviewers comment inline.
5. On merge with co-sign from Brian, flip to `Status: Accepted` in a follow-up PR.
6. If a later ADR supersedes an earlier one, add `Status: Superseded by ADR-NNNN` to
   the old one — never edit its Decision.

### Template

```md
## ADR-NNNN — Title

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN | Deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** Names
- **Tags:** `tag1`, `tag2`

### Context and problem statement
What is the problem, why now, what constraints exist?

### Considered options
Table of options with one-line verdicts.

### Decision
What we chose and why.

### Consequences
Positive / Negative / Mitigations.

### References
Links to docs, RFCs, sibling ADRs.
```

### When to write a new ADR vs amend an existing one

- **New ADR:** the architectural commitment changes (we adopt a new framework, switch
  databases, change auth strategy).
- **Amend in place:** typo, link rot, clarification of a consequence that was always
  true.
- **Never:** rewrite an accepted Decision. The history is the value.

### Cross-links

- [ARCHITECTURE.md](./ARCHITECTURE.md) — current topology reflecting all accepted ADRs
- [BILLING.md](./BILLING.md) — implements ADR-0004
- [SECURITY.md](./SECURITY.md) — what's shipped vs what's deferred
- [BACKLOG.md](./BACKLOG.md) — v2+ candidates, some of which will become ADR-0009+
