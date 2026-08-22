# Architecture Decision Records — projectsites.dev v2

> **Format:** [MADR 3.0](https://adr.github.io/madr/) — Markdown Any Decision Record, v3.0.
> **Cadence:** One ADR per material architectural commitment. Append-only. Status transitions
> recorded inline. Never edit the "Decision" of an accepted ADR — supersede with a new ADR.
> **Numbering:** Zero-padded, monotonic. `ADR-0001` … `ADR-NNNN`. Never reused.
> **⚠️ Two ADR series live in THIS file — do not conflate.** The v2 *architecture* series
> (ADR-0001…0011) is above; a SEPARATE *convergence* series (0003, 0005, 0006, 0019, 0030,
> 0033, 0035, 0046, 0047, 0053) is folded in under "Convergence ADR series" below — **its
> numbers are the ones app code + `service-registry.md` reference** (e.g. "ADR-0006" = Logto,
> not RxJS). The low numbers collide by accident; resolve any "ADR-00xx" by which series/topic
> it names, not the number alone.
> **Owner:** Architect role. Co-signed by Brian Zalewski for any change to `Status: Accepted`.

## Index

| #    | Title                                                    | Status   | Date       | Supersedes |
| ---- | -------------------------------------------------------- | -------- | ---------- | ---------- |
| 0001 | Adopt Nx 20 monorepo as workspace shell                  | Accepted | 2026-05-26 | —          |
| 0002 | Angular 21 + standalone + signals + zoneless             | Accepted | 2026-05-26 | —          |
| 0003 | ~~PrimeNG 18~~ → Spartan UI + Tailwind v4 (UI substrate) | Superseded | 2026-05-26 | Spartan UI |
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

> ⚠️ **SUPERSEDED (2026-06-17): PrimeNG was fully removed.** The admin uses **Spartan UI**
> (`@spartan-ng/brain` + helm wrappers) + Angular CDK + Tailwind v4 as the only UI kit —
> no PrimeNG, no `providePrimeNG`/CockpitPreset (see `app.config.ts`). Per
> `package-preference-registry`, PrimeNG/Material are rejected (mixing kits). The PrimeNG
> decision below is retained only as a historical record.

- **Status:** Superseded → Spartan UI
- **Date:** 2026-05-26 (superseded 2026-06-17)
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

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — current topology reflecting all accepted ADRs
- [BILLING.md](./BILLING.md) — implements ADR-0004
- [SECURITY.md](./SECURITY.md) — what's shipped vs what's deferred

## ADR-0009 — Cost guardrails + deferred scope (merged from WONT_BUILD_YET.md, 2026-06-17)

**Cost guardrails** (enforced in `src/services/build_limits.ts` + `token_burn_meter`):
- Max LLM spend **$20/day** (AI Gateway + org backstop) · max **20 sites/day** · max **25 emails/day**
- Max compute **5 min/job** · max **5 queued retries** · storage **100 MB free / 500 MB paid** per tenant

**Still-deferred** (UI/enforcement pending): TOTP/WebAuthn MFA UI · Chatwoot email-channel config (awaiting inbox/from-name decisions).

**Superseded** (since shipped — were "won't build yet", now done): registrar domain purchasing (domain-picker + Buy flow), rich admin dashboards, A/B via feature flags, PostHog (wired). Source doc `WONT_BUILD_YET.md` removed; this ADR is the record.

## ADR-0010 — Descoped features (trim, 2026-06-17)

- **Status:** Accepted
- **Date:** 2026-06-17

Cut from scope to focus the loop on the money path (payments → booking → conversion). Removed because off the SMB-revenue path, redundant, or scope-creep for a pre-scale product.

**Code removed** (modules + flags + index.ts mounts + manifests): `figma_import`, `page_audio_summary`, `generative_ui_stream` (the 3 were scaffolded this session; tsc + drift green after removal).

**Descoped — do not build** (flag/stub-only, none in the active registry except site_mcp_server; recorded here so the loop won't scaffold them): `brand_voice_clone`, `media_library` (owner DAM — duplicates builder `media.ts`+R2), `i18n_localization` as a platform module (do i18n at generation time instead), `enterprise_sso`/`enterprise_plan` (no enterprise pipeline; Clerk is auth — revisit on a real deal), `site_mcp_server` (speculative), conversational generative-admin-UI.

**Marketplace sprawl → keep one:** keep `template_marketplace`; descope `plugin_marketplace`, `integration_directory`, `stripe_marketplace`/`stripe_app_status` as further surfaces. Where these already exist as built+deployed+tested code, they stay **deprecated-in-place** (NOT deleted mid-convergence-loop — deleting loop-owned deployed modules is destructive); remove in a quiet window if desired.

**Heavy commerce:** keep the lightweight D1+Square storefront (`storefront_ecommerce`, TIER 0); descope the Medusa/`ecommerce_engine` path (Neon+Upstash+Docker) — reserve as an opt-in for a rare heavy-commerce tenant.

**Kept (deprioritized, NOT cut):** AI voice receptionist (high MRR, big session), `membership_paywall` (recurring revenue).

## ADR-0011 — Voice answering service: twilio-labs/call-gpt on Fly.io (us-east Virginia), autoscaled, multi-number

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Brian Zalewski
- **Tags:** `voice`, `infra`, `fly.io`, `twilio`, `one-way-door`

### Context

The Voice receptionist (kept-but-deprioritized in ADR-0010) needs a real-time telephony
engine: a long-lived, bidirectional, sub-second audio WebSocket (Twilio Media Streams)
bridging STT → LLM → TTS. This is the canonical case the Cloudflare-first doctrine reserves
for **Fly.io** ("stateful/container services that don't fit Cloudflare well") — a persistent
duplex media socket with <500ms turn latency is a poor fit for Workers/Containers and an
ideal fit for an always-warm Node server near Twilio's US1 ingress.

### Decision

- **Foundation = a fork of [`twilio-labs/call-gpt`](https://github.com/twilio-labs/call-gpt)** — Node/Express + Twilio Media Streams (`/incoming` → TwiML `<Stream>` → WS), Deepgram STT, ElevenLabs/Deepgram TTS, OpenAI/BYO-LLM, `function-manifest.js` tool calls. Fork lives in the monorepo (e.g. `apps/voice-gateway/`) and is the ProjectSites voice runtime.
- **Deploy: Fly.io**, region **`iad`** (Ashburn, N. Virginia = the "us-east Virginia / DCA" target), co-located with Twilio US1 for lowest PSTN latency.
- **Autoscale by concurrent calls** — Fly autoscaling (`fly-autoscaler` on a concurrent-call/active-WS metric, or machines `min_machines_running` + concurrency soft/hard limits) scales machines up under call load and back down (toward 0/1) when idle.
- **One deployment answers EVERY number in the Twilio account** — a single `/incoming` webhook is set on all account numbers; the handler reads the dialed `To` number and **resolves per-number settings from the Worker** (an internal, authenticated `GET /api/voice/number-config?to=+1…` returning that site's agent prompt, voice, MCP allow-list, hours, escalation, consent/disclosure config). The fork is stateless config-wise — all per-number behavior comes from the Worker, keyed by `To`.
- **Persona parity** — the resolved persona is the SAME `ai_concierge` persona as web chat + the Forms router, with a voice-only delta (brevity, spell-out, no markdown).

### Consequences

- **Positive:** full control of the latency loop (semantic turn detection, barge-in, filler tokens); reuses the existing Deepgram/ElevenLabs/OpenAI stack; one deploy serves all tenants; Fly autoscale keeps idle cost low.
- **Negative / locked-in:** a new load-bearing vendor (Fly.io) + a non-CF deploy surface to operate, secure (CF Access / signed Twilio webhooks), and observe (OTel/Langfuse/Sentry); Twilio Media Streams is 8kHz G.711 (ASR/TTS quality ceiling).
- **Neutral:** keep **Twilio ConversationRelay** as a documented swap-in for the STT/TTS/orchestration layer if the hand-rolled loop underperforms — same Fly.io host, same per-number resolver.

### Alternatives considered

- **CF Containers / Workers WebSocket** — rejected for the audio loop: long-lived duplex sub-second media socket is the doctrine's explicit Fly.io escape-hatch; Workers' execution model fights it.
- **Fully-managed ConversationRelay end-to-end** — viable but less control over the persona/tool loop and diverges from the existing Deepgram/ElevenLabs services; held as a fallback, not the foundation.
- **Third-party AI-receptionist SaaS** — rejected: this is the product, not a dependency.

### Build sequence

Tracked as the **V0 Voice-engine foundation epic** in `apps/project-sites/_LOOP_LEDGER.md` (fork → per-number resolver contract → webhook→settings→session → autoscale config → secrets → observability → prod call test), ahead of the V1–V50 hardening cluster. Requires `FLY_API_TOKEN` + Twilio/Deepgram/ElevenLabs/OpenAI secrets (`fly secrets import`).


---

# Convergence ADR series (folded from apps/project-sites/docs/adr/, 2026-06-27)

> One-file-per-ADR series merged here. Referenced by NUMBER in code (e.g. "ADR-0019"); those
> refs stay valid. NOTE: these numbers are a SEPARATE series from the v2 architecture ADRs above
> (0001-0011) — they collide by accident; resolve any "ADR-00xx" by which series/topic it names.


---

# 0003 — Workflow/job routing: Cloudflare Workflows → Inngest → Hatchet Cloud

**Status:** accepted
**Date:** 2026-06-20
**Deciders:** Brian Zalewski

## Context

ProjectSites runs many classes of async work — claim flows, billing lifecycle,
domain verification, notifications, lifecycle email, site generation, lead scans,
screenshots, crawls, browser jobs. Three execution planes exist (§19): Cloudflare
Workflows (CF-native durable orchestration), the self-hosted Inngest plane (§13,
event-driven product lifecycle), and Hatchet Cloud (heavy/stateful/long/browser/AI,
ADR-0004). Without a single routing policy, app code picks vendors ad-hoc — which
violates the ports/adapters rule (§11/§74.12) and scatters cost/retry/idempotency
decisions across the codebase.

## Decision

A pure `WorkflowRouter` (`src/platform/workflow-router.ts`) owns the choice:

- `chooseWorkflowBackend(flags)` — the §20 selection logic. CF-native + light →
  `cloudflare-workflows`; event-driven + light → `inngest`; anything
  heavy/browser/filesystem/stateful → `hatchet`. Default (unflagged) → `hatchet`.
- `JOB_DEFINITIONS` — every declared job kind with its routing flags + reliability
  contract (`maxRetries`, `timeoutSeconds`, `requiresIdempotency`, `producesArtifacts`,
  `costCategory`, …). Each definition's `defaultBackend` is **asserted by unit test**
  to equal `chooseWorkflowBackend(def)` — declaration and policy can never diverge.
- `routeJob(kind)` — recomputes the backend from the live policy (not blindly trusting
  the stored `defaultBackend`).

Preference order is strict (§76): Workflows first, Inngest second, Hatchet last —
"do not overuse Hatchet for small CF-native flows; do not overuse Inngest for flows
Workflows handles cleanly."

## Consequences

- Positive: one place to change routing; app code calls `routeJob(kind)`, never a
  vendor SDK; cost/retry/idempotency declared per job; testable in isolation (no I/O).
- Negative: backend adapters (`CloudflareWorkflowProvider`/`InngestProvider`/
  `HatchetProvider`) implementing `ProjectSitesJobProvider` are still to build — this
  slice is the routing brain, not yet the dispatch limbs.
- Neutral: `JOB_DEFINITIONS` is the SSOT for the admin job catalog (§66).

## Alternatives considered

- **Call vendors directly per job** — rejected: violates §11 ports/adapters; scatters
  policy; impossible to enforce the §76 preference order.
- **One backend for everything** — rejected: CF Workflows can't run heavy/browser/
  stateful jobs; Hatchet is wasteful for light CF-native flows.

## Migration notes

- Existing CF Workflows (`SiteGenerationWorkflow` et al.) keep running; they become
  the `cloudflare-workflows` adapter's targets when the provider lands.
- Site generation currently runs as a CF Workflow + Container; `JOB_DEFINITIONS`
  routes `site-generation` to `hatchet` (its true heavy home) — the adapter migration
  is gated + incremental, not a big-bang rewrite.

## Operational risks

- A mis-flagged job could route to the wrong plane (e.g. a browser job not flagged
  `needsBrowser` would wrongly pick Workflows). The `defaultBackend == policy` test
  catches divergence for declared jobs; new jobs must set flags accurately.

## Rollback strategy

- Pure library, no runtime wiring yet — reverting is a file delete. Once adapters
  land, each is feature-flagged (`workflows.cloudflare.enabled` / `workflows.inngest.enabled`
  / `workflows.hatchet.enabled`) so a plane can be disabled without code change.


---

# 0005 — OpenFGA as the authorization graph (not authentication)

**Status:** accepted
**Date:** 2026-06-20
**Deciders:** Brian Zalewski

## Context

ProjectSites needs relationship-based authorization across user→org→site→app→
resource, agency-managed client sites, scoped API keys, support delegation, and
subscription→entitlement→feature (§29). Authentication (who you are) is Better Auth's job
(ADR-0006); authorization (what you may do) is a separate graph problem best modeled
as relationship tuples, not scattered `if (user.role === …)` checks.

## Decision

- Authorization flows through an `AuthorizationProvider` port
  (`src/platform/authorization.ts`): `check / batchCheck / writeRelationship /
  deleteRelationship / listObjects`. App code calls `authz.check({ user, relation,
  object })` on dashboard/API/admin/mutation paths.
- **Default deny.** Anything not explicitly granted is refused. Unknown permissions
  resolve to false.
- The role→permission model is explicit (`PERMISSION_RULES`): owner publishes +
  manages billing/api-keys; editor edits but not billing; viewer reads; agency manages
  assigned client sites; platform_admin performs platform actions.
- `FakeAuthorizationProvider` (in-memory graph) is the §16 local mode + test substrate;
  `DenyAllAuthorizationProvider` is the fail-closed default when OpenFGA is unconfigured
  (§58). The real `OpenFgaAuthorizationProvider` is the follow-on adapter.
- NOT on the public static hot path (§29) — only authenticated dashboard/API/admin.

## Consequences

- Positive: one place to reason about access; BOLA/object-level checks (§61) become
  `authz.check` calls; testable model (the §29 cases are unit tests); fail-closed safe.
- Negative: a real OpenFGA deployment + relationship-bootstrap (on user/org/site create)
  is still to build; cached decisions + invalidation (§29) are a later concern.
- Neutral: `PERMISSION_RULES` is the SSOT for what each role may do.

## Alternatives considered

- **Hard-coded role checks in handlers** — rejected: scatters policy, impossible to audit,
  no agency/delegation/scoped-key modeling.
- **Casbin / custom RBAC table** — rejected: OpenFGA's relationship-tuple model fits the
  user→org→site→resource graph natively; the port keeps us swappable anyway.

## Migration notes

- Wire `authz.check` into mutation routes incrementally (start with site
  edit/publish/billing). Bootstrap relationships in the OpenFGA store on tenant/site
  create + Stripe entitlement changes (a follow-on).

## Operational risks

- OpenFGA outage → fail closed for mutations (DenyAll); safe cached reads only by explicit
  policy (§58). A mis-modeled permission grants/denies wrongly — the §29 model tests guard
  the role→permission table.

## Rollback strategy

- Pure port + in-memory providers today (no runtime wiring) — reverting is a file delete.
  Once wired, the provider is swappable (Fake/DenyAll/OpenFGA) behind the port.


---

# 0006 — Better Auth is the only auth system (embedded)

**Status:** accepted (supersedes the prior external-IdP federation design)
**Date:** 2026-06-27
**Deciders:** Brian Zalewski

## Context

The platform needs one auth system. Earlier iterations explored an OIDC `IdentityProvider`
federation port over external IdPs. That added needless surface and a vendor that did not
fit our Cloudflare-first / Neon-D1 model. Better Auth (Workers-native, D1-compatible) covers
consumer auth, social, magic-link, 2FA, passkeys, and SSO/SAML in one OSS library we own.

## Decision

**Better Auth is the ONLY auth system, EMBEDDED in the main worker.** It runs inside
`apps/project-sites` on the main D1 (Kysely D1 dialect) and OWNS sessions directly.

- Module: `src/auth/better-auth.ts` (`makeAuth(env)`), mounted at `/api/auth/*`.
- Methods: email+password, magic link (via the existing SES/Listmonk email path), Google
  social, TOTP 2FA. Passkeys (WebAuthn) and SSO/SAML land in later slices.
- Tables: singular `user`/`session`/`account`/`verification` + plugin tables — no collision
  with the legacy plural `users`/`sessions` during migration.
- Cutover is gated by the `better_auth` flag: ON → Better Auth owns `/api/auth/*`; OFF →
  the legacy magic-link/Google/D1-session auth (`services/auth.ts`) stays live until the
  frontend sign-in UI + user-migration backfill land.

## Consequences

- **Positive:** one OSS auth system, fully owned, CF-native (D1, no external IdP); social +
  magic-link + 2FA + passkeys + SSO under one roof; no federation port.
- **Negative:** a real migration (backfill users; swap the session model); one-way once cutover completes.
- **Removed:** the OIDC federation port (`platform/identity.ts`, `middleware/identity.ts`,
  `routes/auth_idp.ts` + its provider adapters) and (later) the standalone
  `auth.projectsites.dev` worker.

## Alternatives considered

- External consumer IdP — D1-incompatible; rejected.
- A second enterprise-SSO vendor — Better Auth's SSO plugin covers it natively; rejected.
- Keeping the bespoke magic-link/Google/D1-session auth — no 2FA/passkeys/SSO and more custom
  code than one OSS library; superseded.


---

# 0019 — Amazon SES + Listmonk for email (Resend excluded)

**Status:** accepted
**Date:** 2026-06-20
**Deciders:** Brian Zalewski

## Context

The convergence spec §4 (Exclude List) forbids Resend, and §42 mandates **Amazon
SES** for transactional email plus **Listmonk** (SES SMTP relay) for newsletters/
campaigns. The repo currently references Resend in **~34 source files** (concentrated
in `src/services/`, `src/routes/`, and `libs/features/email_marketing/`) — the single
largest piece of excluded-vendor drift in the convergence. This ADR records the
decision and makes the Resend references a **documented, tracked migration** rather
than untracked drift, so the architecture-fitness gate can burn them down without
blocking every deploy in the interim.

## Decision

- **Amazon SES** is the primary transactional email provider (magic links, claim
  verification, receipts, billing/security/domain-verification emails, the Novu email
  channel, and Listmonk's SMTP delivery). SigV4 raw-send from the Worker; no npm SDK.
- **Listmonk** (`mail.projectsites.dev`, CF Container) owns newsletters, campaigns,
  outreach lists, subscriber/segment management, and unsubscribe handling — sending
  through SES SMTP.
- Email flows sit behind an `EmailProvider` / `MarketingEmailProvider` port
  (`AmazonSesEmailProvider`, `ListmonkMarketingEmailProvider`) with a fake provider for
  local/no-vendor mode (§16). Routing: transactional/critical → SES; bulk → Listmonk.
- **Resend is `deprecated`** in the service registry (`email-resend`) and **excluded**
  in `EXCLUDED_VENDORS`. New code MUST NOT import or call Resend.

## Consequences

- Positive: one delivery substrate (SES) under both transactional and bulk, lower cost,
  no Resend dependency, deliverability owned (SPF/DKIM/DMARC on `projectsites.dev`).
- Negative: ~34 files to migrate off Resend; SES SigV4 + SMTP-password derivation is
  more setup than the Resend SDK.
- Neutral: `scripts/check-architecture-fitness.mjs` reports Resend refs as
  `tracked-migration (ADR-0019)` (non-blocking) while the clean exclude-list
  (polar/trigger.dev/postmark/clay/socket.dev/chainguard = 0) is locked as a hard
  regression guard. When Resend refs reach 0, drop the `documented` tag so any
  reintroduction hard-fails CI (maturity-ladder promotion).

## Alternatives considered

- **Keep Resend** — rejected: excluded by §4; the platform standardizes on SES+Listmonk.
- **Postmark** — rejected: also on the §4 exclude list.
- **SES only (no Listmonk)** — rejected: SES is not a campaign/subscriber manager;
  Listmonk provides lists/segments/unsubscribe/campaign analytics over SES SMTP.

## Migration notes

1. Introduce the `EmailProvider`/`MarketingEmailProvider` ports + SES/Listmonk/fake
   providers (a future slice).
2. Replace Resend call sites file-by-file, transactional first (auth/claim/billing),
   each with a test, behind a `email.ses.enabled` flag.
3. Move `email_marketing` campaigns to Listmonk behind `email.listmonk.enabled`.
4. When `check-architecture-fitness --json` reports `by_vendor.resend == 0`, remove the
   `documented` tag on the Resend rule so reintroduction is a hard violation, and set
   `email-resend` registry status to `removed`.

## Operational risks

- SES sandbox/production access + verified domain required before cutover.
- Bounce/complaint/suppression handling must be wired (SES events → `email_events`/
  `email_suppressions`) before bulk sends.

## Rollback strategy

- The ports keep providers swappable; if SES is blocked at cutover, the fake provider
  (local) and a feature-flag-gated rollout mean partial migration is safe. Resend stays
  `deprecated` (not deleted) until SES is proven in prod, so a flag flip can revert a
  given flow.

## Migration progress (updated 2026-06-23)

**Step 2 (transactional call-site cutover) — COMPLETE.** All 10 platform transactional
senders route through the SES seam (`getEmailProvider`) as the PRIMARY rail when AWS
creds + `SES_FROM_EMAIL` are set; Resend/SendGrid remain fallback until SES is proven in
prod (progressive degradation by env, no flag needed):

- `services/notifications.ts`, `services/auth.ts` (magic-link), `services/contact.ts`,
  `routes/forms.ts` (send-reply), `services/inbox.ts` (email channel), `services/credits.ts`
  (billing alerts), `routes/search.ts` (`/api/contact-form/:slug`), `services/form_router.ts`
  (send_email), `routes/ai_admin.ts` (team invites), `services/weekly_digest.ts`.

Port enhancements landed for the cutover: `replyTo` (contact-form lead reply-to) and
`headers` (SES `Content.Simple.Headers` — weekly_digest one-click `List-Unsubscribe`).

**EXEMPT (not platform email — do NOT migrate):** `services/mcp_client.ts` (customer-
connected Resend MCP, uses the customer's `accessToken`) and `services/newsletter_dispatch.ts`
`dispatchResend` (customer-connected Resend Audiences, uses `requireApiKey(row)`). §4 bans
Resend as OUR rail, not as a customer-selectable integration.

**Remaining (prod-gated, steps 3-4):**
- Provision AWS SES prod secrets + verify `projectsites.dev` sending domain; send a real
  magic-link and confirm delivery from `noreply@projectsites.dev`.
- Wire SES bounce/complaint events into `email_events`/`email_suppressions`.
- Once verified live: delete the Resend fallback branches from the 10 files, then drop the
  Resend rule's `documented` tag (hard-block) + set `email-resend` registry status `removed`.


---

# 0030 — Unkey contract over the D1 api_tokens keystore (don't host Unkey)

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§30 of the convergence include-list calls for Unkey (API-key management).
ProjectSites already owns a complete API-key system in `services/api_tokens`:

- `psk_<32-byte-hex>` keys; only the SHA-256 hash is stored in D1 `api_tokens`
- scopes (`sites:read`, `media:write`, …), expiry, revoke, `last_used_at`
  throttling, org ownership, bearer extraction, scope checks
- already the live auth path for the public API at the edge

Two ways to "add Unkey" were considered. Hosting Unkey on CF Workers is not
viable — Unkey's product is a DB-backed container stack (API + dashboard +
datastore/analytics), not a Worker artifact; and edge key-*verification* (the
hot path) is exactly what `api_tokens` already does Worker-natively.

## Decision

Expose the existing keystore through an **Unkey-style provider contract** — a
thin in-house port, no vendor SDK, no hosting:

- `platform/api-keys.ts` — the port: `ApiKeyProvider` (`createKey` / `verifyKey`
  / `revokeKey`) with a structured `KeyVerificationResult` (`valid` + `code` +
  `keyId` + `ownerId` + `scopes`), plus `FakeApiKeyProvider` for tests/local.
- `middleware/api-keys.ts` — `D1ApiKeyProvider` delegating to
  `createApiToken`/`verifyApiToken`/`revokeApiToken`, plus `getApiKeyProvider(env)`.

`api_tokens` stays the source of truth and the live verification path. Call sites
that want the vendor-neutral key API use the provider; everything else keeps
calling `verifyApiToken` directly.

## Consequences

- **Positive:** Unkey-shaped, vendor-neutral key API (portable call sites,
  structured verification result) with zero new deps, Workers-native, no second
  keystore, no container to host. A managed Unkey adapter can slot into the
  factory behind `UNKEY_ROOT_KEY` later without touching call sites.
- **Positive:** fail-soft — a thrown D1 error in `verifyKey` returns
  `{ valid: false, code: 'NOT_FOUND' }`; the keystore already collapses
  revoked/expired/absent into "no valid row" so existence never leaks.
- **Negative:** not Unkey's *product* features (per-key ratelimit primitives,
  analytics dashboards, key roles/identities). If those are ever needed, wire
  managed Unkey as a `managed-saas` adapter behind this same port.
- **Neutral:** no env secret (wraps our own keystore → always available, no gate).
  Ships dark: nothing calls the port yet; wiring is additive + behavior-neutral.

## Alternatives considered

- **Host Unkey on CF Workers** — rejected: Unkey's self-host is a DB-backed
  container stack, not a Worker; the hot-path verification is already Worker-native
  in `api_tokens`. (See the hosting discussion: managed-SaaS or single-host, never
  CF Workers, for stateful OSS apps.)
- **Adopt managed Unkey now via API** — deferred: `api_tokens` already covers
  create/verify/scope/revoke for the current public API; the managed product's
  extra features aren't needed yet. The port keeps that option open.
- **Do nothing** — rejected: leaves §30 unaddressed and call sites coupled to the
  bare `verifyApiToken` boolean instead of a vendor-neutral contract.


---

# 0033 — OpenFeature contract over the D1 flag engine (not the vendor SDK)

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§33 of the convergence include-list calls for OpenFeature. ProjectSites already
owns a complete, production feature-flag engine in `modules/feature_flags`:

- D1 `flag_overrides` (tenant / org / global scope) + a typed `FLAG_REGISTRY`
- KV 60s cache, stable rollout-percent hashing (SHA-1 bucket), killswitch stage
- Admin UI (`/admin/feature-flags`), audit log, resolution engine (`isFlagOn`,
  `resolveFlag`), and a two-layer System-Admin / owner-facing plane

Adopting the OpenFeature **vendor SDK** (`@openfeature/server-sdk`) would add a
runtime dependency and a second evaluation path over the same data — duplicated
architecture the include-list protocol explicitly forbids.

## Decision

Expose the existing engine through the OpenFeature **provider contract** — the
standard `ResolutionDetails<T>` evaluation shape (`value` + `reason` + `variant?`
+ `errorCode?` + `flagMetadata?`) — implemented as a thin in-house port, with no
external SDK:

- `platform/feature-evaluation.ts` — the port: `FeatureEvaluationProvider`
  interface, Zod `EvaluationContextSchema` (OpenFeature `targetingKey` + scope
  fields), and `FakeFeatureEvaluationProvider` for tests/local.
- `middleware/feature-evaluation.ts` — `D1FlagEvaluationProvider` wrapping
  `isFlagOn`, plus `getFeatureEvaluationProvider(env)`.

The D1 store remains the single source of truth. App code that wants the
vendor-neutral evaluation API (reason/metadata, not just a bare boolean) calls
the provider; everything else keeps using `isFlagOn` directly.

## Consequences

- **Positive:** standard OpenFeature evaluation surface (portable call sites,
  structured evaluation details) with zero new deps, Workers-native, no second
  flag store. A future REMOTE OpenFeature provider can slot into the factory
  behind an env var without touching call sites.
- **Positive:** fail-soft by construction — a KV/D1 fault returns the caller
  default with `reason: 'ERROR'`; unknown flags fail-closed to `false` (engine
  behavior, unchanged).
- **Negative:** not the literal OpenFeature SDK, so a drop-in OpenFeature
  *client* (hooks, event bus, multi-provider) isn't available — if that ecosystem
  tooling is ever needed, the port can be re-backed by the real SDK.
- **Neutral:** no env secret (wraps our own engine → always available, no gate).
  Ships dark in the sense that no handler calls it yet; wiring is additive.

## Alternatives considered

- **Adopt `@openfeature/server-sdk` + a custom provider** — rejected: adds a dep
  and a parallel evaluation path over the same D1 data for no behavior gain on a
  single-backend system. The contract is the value; the SDK is not.
- **Do nothing (keep only `isFlagOn`)** — rejected: leaves §33 unaddressed and
  forgoes the standard evaluation-details shape that makes call sites portable.


---

# 0035 — OpenTelemetry span port over Workers Tracing (not the OTel SDK)

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§35 of the convergence include-list calls for OpenTelemetry. ProjectSites already
has a layered observability backbone:

- **CF Workers Tracing** (`[observability]` in wrangler) — zero-config OTLP tracing
  of every I/O span, the always-on backbone
- **`lib/log.ts`** — structured logs carrying `traceId`/`requestId` correlation
- **Sentry** — exception spans; **PostHog** — product events; **AI Gateway** — LLM
  call logs

What's missing is an app-level, vendor-neutral `Tracer.startSpan(...)` surface and
the ability to export custom business spans (lead→claim→checkout funnel steps,
generation pipeline phases) to an OTLP backend (Honeycomb / Grafana / Axiom).

Adopting the full `@opentelemetry/*` SDK is the wrong tool here: it's heavy, not
Workers-tuned (Node globals, async-hooks context propagation), and would duplicate
the context Workers Tracing already provides.

## Decision

Ship a thin in-house **OpenTelemetry-shaped span port**, no SDK:

- `platform/tracing.ts` — `Tracer` / `Span` / `TracerProvider` interfaces +
  `RecordingSpan` + `NoopTracerProvider` (zero-overhead default) +
  `FakeTracerProvider` (tests).
- `middleware/tracing.ts` — `OtlpTracerProvider`: a fetch-based **OTLP/HTTP JSON**
  exporter (`buildOtlpPayload` → `resourceSpans/scopeSpans/spans`) + Zod-validated
  config + `getTracerProvider(env)`.

Spans complement (never replace) Workers Tracing. App code emits a span and flushes
in `ctx.waitUntil(provider.flush())`.

## Consequences

- **Positive:** standard span API + OTLP export to any backend, zero new deps,
  Workers-native (pure fetch). Backend is swappable via one env var.
- **Positive:** ships **dark** — no `OTEL_EXPORTER_OTLP_ENDPOINT` → `NoopTracerProvider`
  (inert spans, zero overhead, no behavior change). Export is fail-soft: a failed
  POST is swallowed, never breaks a request.
- **Negative:** not the OTel SDK, so auto-instrumentation + W3C `traceparent`
  context propagation aren't built in (manual `traceId`/`parentSpanId` threading).
  Acceptable — Workers Tracing already auto-instruments I/O; this port is for
  deliberate business spans.
- **Neutral:** the port is `scaffolded` until `getTracerProvider` + `waitUntil(flush)`
  are wired into hot handlers (site-serving, workflow steps).

## Alternatives considered

- **Adopt `@opentelemetry/*` SDK** — rejected: heavy, Node-oriented, duplicates
  Workers Tracing's context; the OTLP wire format is the value, not the SDK.
- **Rely only on Workers Tracing** — insufficient: it traces I/O, not custom
  business spans, and can't target an arbitrary external OTLP backend per-deploy.
- **Do nothing** — leaves §35 unaddressed and business-funnel spans unexportable.


---

# 0046 — Homegrown OAuth connection layer (Nango deferred)

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§46 of the convergence include-list calls for Nango (managed OAuth /
third-party-connection infrastructure). ProjectSites already owns two working,
Worker-native OAuth connection layers that do exactly what Nango does — the
authorize → callback → token-exchange → encrypted-storage → refresh lifecycle
across many third-party providers:

- **`routes/mcp_oauth.ts`** — per-site MCP provider connections:
  `GET /api/mcp/:provider/connect` (builds the authorize URL **or** a paste-key
  spec) + `/callback` (exchanges the code, **encrypts + upserts** tokens into
  `mcp_connections`). Falls back to a paste-key flow when a provider's
  `{PROVIDER}_OAUTH_CLIENT_ID` secret is absent — no broken popup.
- **`routes/social_oauth.ts`** — social-platform OAuth (`/api/social/:platform/connect`
  + `/callback`), same exchange/encrypt/upsert shape, with paste-key fallback for
  non-OAuth platforms (Bluesky/Mastodon/Telegram/Discord).
- Supporting: `mcp_pkce.ts` (PKCE), `mcp_client.ts`, AES-GCM token encryption.

Adopting Nango would mean either self-hosting its container+Postgres stack (wrong
for a CF-first edge app, per the hosting doctrine) or routing every OAuth dance
through a managed third party — replacing working, encrypted, edge-native code
with a vendor dependency for no capability gain.

## Decision

**Defer Nango.** Keep the homegrown OAuth connection layer as the source of truth.
Do NOT build a port now: unlike the flag/api-key/tracing cases, there is no single
clean call-site contract to wrap — `mcp_oauth` and `social_oauth` are full Hono
route groups with provider-specific adapters, encryption, and paste-key fallbacks
already in place. A premature `OAuthConnectionProvider` abstraction over two route
groups would add indirection without removing duplication.

If a future need arises (a provider Nango supports that we don't, or OAuth-refresh
volume that justifies offloading), introduce a managed-Nango adapter behind a new
`OAuthConnectionProvider` port at that time, gated on `NANGO_SECRET_KEY`.

## Consequences

- **Positive:** zero new deps, no container to host, tokens stay AES-GCM-encrypted
  in our own D1, edge-native, paste-key fallback preserved. §46 is addressed with
  an honest "custom equivalent exists" rather than a duplicate.
- **Negative:** we maintain provider adapters ourselves (new providers = new
  adapter code, not a Nango catalog entry). Accepted — the current provider set is
  small and stable.
- **Neutral:** the registry entry `oauth-nango` records status `deprecated`-of-vendor
  / homegrown-live so the architecture-fitness scan doesn't flag §46 as missing.

## Alternatives considered

- **Build an `OAuthConnectionProvider` port over the route groups now** — rejected:
  no single call-site contract to wrap; would be indirection over two full route
  groups, not a thin adapter. Revisit only if a managed-Nango adapter is needed.
- **Self-host or adopt managed Nango** — deferred: replaces working encrypted
  edge-native flows with a vendor/container for no capability gain today.


---

# 0047 — Stainless SDK-codegen over the OpenAPI 3.1 spec

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§47 of the convergence include-list calls for Stainless (typed client-SDK
generation from an OpenAPI spec). This is the one targeted item with **no homegrown
equivalent** — ProjectSites does not ship a client SDK today. It does, however,
already produce the input Stainless needs: `routes/docs.ts` serves a generated
**OpenAPI 3.1** document at `GET /api/admin/docs/openapi.json` (built from a
hand-curated route table covering the API surface).

Stainless is a build/CI concern (it generates code from a spec), not a runtime
provider — but modeling it as a port keeps it consistent with the other
integrations (env-gated, fail-soft, ships dark) and gives it unit-test coverage.

## Decision

Build a foundation-first **SDK-codegen port**:

- `platform/sdk-codegen.ts` — `SdkCodegenProvider` (`generate(spec)` →
  `SdkGenerationResult{status,project?,message?}`) + Zod `SdkCodegenConfigSchema`
  + `NoopSdkCodegenProvider` (dark default) + `FakeSdkCodegenProvider`.
- `middleware/sdk-codegen.ts` — `StainlessSdkCodegenProvider` (fetch-based POST of
  the spec, no SDK) + `getSdkCodegenProvider(env)`.
- `types/env.ts` — `STAINLESS_API_KEY` + `STAINLESS_PROJECT`.

The spec source is the existing `/api/admin/docs/openapi.json` — no second spec to
maintain.

## Consequences

- **Positive:** addresses §47 with a real, tested foundation; feeds the existing
  OpenAPI spec; zero new deps; fetch-based (Workers-native). `baseUrl`/endpoint are
  config, so finalizing the exact Stainless REST contract is a config change, not a
  code change.
- **Positive:** ships **dark** — no `STAINLESS_API_KEY` → `NoopSdkCodegenProvider`
  (`generate()` resolves `skipped`, no network). Fail-soft: HTTP-error / thrown →
  `status: 'error'`.
- **Negative:** the exact Stainless API path (`/api/spec`) + auth header shape are
  provisional until a key is provisioned and the contract is confirmed; the adapter
  is `scaffolded`, not `production`, until then.
- **Neutral:** SDK generation isn't wired into CI yet — it's a `gen:sdk` step to add
  once the key exists.

## Alternatives considered

- **Hand-write + maintain a client SDK** — rejected: drifts from the API surface;
  Stainless regenerates from the spec on every change.
- **Use the OpenAPI Generator toolchain instead of Stainless** — deferred: Stainless
  is the include-list choice and produces higher-quality idiomatic SDKs; the port
  keeps the backend swappable if that changes.
- **Do nothing** — leaves §47 the sole unaddressed targeted item.


---

# 0053 — Homegrown crawl + discovery (Deepcrawl deferred)

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§53 of the convergence include-list calls for Deepcrawl (managed crawl /
technical-SEO-audit SaaS). ProjectSites already owns Worker-native crawl +
discovery:

- **`services/import_crawler.ts`** — `crawlSiteForImport()` builds a typed
  `CrawlReport` / `InventoryUrl[]` for site-import (real browser UA + headers per
  `fetch-defaults`, robots/sitemap/Wayback inventory, `estimateRebuildMinutes`).
- **Image discovery** + **Cloudflare Browser Rendering** (the `browser-gateway`
  service, already `production` in the registry) cover JS-rendered crawl,
  screenshots, and content extraction at the edge.

Deepcrawl is a heavyweight managed crawler aimed at large-scale recurring
technical-SEO audits. Our crawl need is bounded and product-specific (crawl ONE
source site to import/rebuild it), already implemented Worker-native, and already
integrated into the site-generation pipeline.

## Decision

**Defer Deepcrawl.** Keep `import_crawler.ts` + image-discovery + CF Browser
Rendering as the crawl/discovery layer. Do NOT build a port now: like the Nango
case (ADR-0046), there is no single clean call-site contract to wrap — the crawler
is a domain-specific import function, not a generic "crawl provider" seam, and
Browser Rendering is already a registered CF-first service.

If recurring large-scale technical-SEO auditing becomes a product feature, add a
managed-Deepcrawl adapter behind a new `CrawlAuditProvider` port gated on
`DEEPCRAWL_API_KEY` at that time.

## Consequences

- **Positive:** zero new deps, CF-first (Browser Rendering is the edge crawl
  primitive), real-UA fetch crawl already battle-tested in the import pipeline.
  §53 is addressed with an honest "custom equivalent exists" rather than a
  duplicate or an unused vendor adapter.
- **Negative:** no managed recurring-SEO-audit dashboard. Accepted — not a current
  product need; our crawl is import-scoped, not audit-scoped.
- **Neutral:** registry entry `crawl-deepcrawl` records the deliberate deviation so
  the architecture-fitness scan doesn't flag §53 as missing.

## Alternatives considered

- **Build a `CrawlProvider` port over `import_crawler`** — rejected: it's a
  domain-specific import function, not a generic crawl seam; a port would be
  indirection with one caller.
- **Adopt managed Deepcrawl now** — deferred: heavyweight recurring-audit SaaS for
  a need we don't have; CF Browser Rendering + the import crawler already cover the
  edge-native crawl surface.


---

# ADR-0054 — Search engines (Orama/Typesense) + UI libraries (Floating UI / Sonner / Embla)

**Status:** Accepted · **Date:** 2026-06-25 (Brian directive) · **Deciders:** Brian Zalewski
**Series:** convergence (see `DECISIONS.md` § two ADR series note)

## Context

Child sites (`{slug}.projectsites.dev`), the AI concierge, and the platform admin all need
search; the Angular admin + React generated-site template need shared tooltip/toast/carousel
primitives. We want a free/zero-infra default with a paid escalation, and CF-first hosting.

## Decision

### Search — tiered (Orama base/free, Typesense advanced/paid; Typesense on Fly.io)

| Surface / tier | Engine |
|---|---|
| Default child-site search (`{slug}.projectsites.dev`) | **Orama** — zero infra, on-device |
| Advanced paid search add-on (per child site) | **Typesense** (Fly.io) |
| ProjectSites.dev internal / global search (admin + platform) | **Typesense** (Fly.io) |
| AI concierge — base tier | **Orama + CF-native AI/RAG** (Workers AI + Vectorize/AutoRAG) |
| AI concierge — advanced tier | **Typesense** (hybrid) OR a dedicated vector layer |

- **Orama** (`@orama/orama` + `@orama/plugin-data-persistence`): build pipeline emits
  `public/search-index.json` per generated site from `_scraped_content.json.routes[]`; the
  React template's `<SiteSearch>` (Cmd+K) lazy-loads + restores the persisted index, searches
  on-device. Base AI concierge feeds CF-native RAG (`src/services/rag.ts`).
- **Typesense** (Fly.io stateful-VM escape hatch, persistent volume): worker service
  `src/services/search_typesense.ts` indexes with the admin key server-side; mints scoped
  search-only keys for the frontend. Collections: `sites`, `docs`, `admin_entities`, + per
  paid-child-site collections. Admin/global UI call a `/api/search?q=` proxy, never the admin key.
  Add-on is flag/entitlement-gated. Secrets: `TYPESENSE_HOST`, `TYPESENSE_ADMIN_API_KEY`,
  `TYPESENSE_SEARCH_ONLY_API_KEY`.

### UI libraries

| Lib | Angular admin (`frontend/`) | React generated sites (template repo) |
|---|---|---|
| Floating UI (default tooltip, virtual element) | `@floating-ui/dom` → `appTooltip` directive (`computePosition` + virtual ref) | `@floating-ui/react` |
| Sonner (toasts) | `ngx-sonner` / Spartan `hlm-sonner` (admin is Spartan) | `sonner` |
| Embla (carousel) | `embla-carousel-angular` | `embla-carousel-react` |

## Consequences

- Most child sites pay zero search infra (Orama on-device); paid tier and platform-global
  search escalate to one shared Typesense host.
- Adds Fly.io as the Typesense host (one more stateful-VM escape hatch under CF-first).

## Build order (fresh session, Monitor + parallel agents)

1. Worker `search_typesense.ts` + `/api/search` proxy + collection-seed migration (TDD).
2. Angular `appTooltip` (Floating UI virtual) — default tooltip.
3. Angular Sonner (`hlm-sonner`) provider + replace existing toast calls.
4. Angular Embla wrapper component.
5. Template repo: Orama `<SiteSearch>` + build-step index emit + Sonner/Embla/Floating-UI.
6. Provision Typesense (Fly.io) + secrets; deploy + prod-E2E each surface.

⚠️ `npm install` uses `--legacy-peer-deps`; never symlink+install in a worktree (corrupts main).

## Install homes

- Angular admin `frontend/package.json`: `@floating-ui/dom`, `embla-carousel-angular`, `ngx-sonner`.
- Worker `apps/project-sites/package.json`: `typesense`.
- React template repo: `@orama/orama`, `@orama/plugin-data-persistence`, `sonner`, `embla-carousel-react`, `@floating-ui/react`.
