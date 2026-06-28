# Curated Backlog — projectsites.dev (2026-06-28)

> Principal-engineer curation of every task surface (`_LOOP_LEDGER.md` ~290 unchecked
> across 8 themes + `RECS/ROADMAP/REQUIREMENTS/FEATURE_CATALOG/STACK/_CONVERGENCE`).
> Synthesized from a 4-agent read-only digest. PURSUE = build; PASS = cut/defer.
> This is a curation snapshot — the **live source of truth remains `_LOOP_LEDGER.md`**
> (the finishing-loop cron's DONE-gate counts its `- [ ] … [auto]` lines).

---

## 🚨 Not a feature — fix now (the scan surfaced real bugs)

- **Live cross-tenant publish vuln** — `content.ts` `approve` / `publishRewriteDraft`
  doesn't thread `expectedOrgId`; one org can publish into another. Add a regression
  test + fix. Also audit every D1 query for `org_id` scoping (T3-19). Existential.
- **Margin leak (#1 cost problem)** — gate container builds behind the per-build cap
  (done #20) + force AI-Gateway on every model call + swap GPT-4o vision → Workers-AI
  where adequate + **cache research/brand/assets per business** (VB-15; also cuts builds
  ~15→5 min). Biggest unmanaged spend today.
- **Stale-doc drift** — `FEATURE_CATALOG.md` is now a fire-log (not a backlog),
  `REQUIREMENTS.md §16` lists already-built items, and a **3-way notification
  contradiction** exists (psnotify vs Novu vs Dittofeed across three docs). Standing
  rule = ZERO Novu → psnotify; delete the Dittofeed/Novu mentions as drift.

---

## ✅ PURSUE — ordered by leverage

### 1. Conversion & activation (highest revenue/$)
- **Anonymous first-generation before signup** (T5-40) — biggest activation lever; show a build before the wall.
- **One-click Claim → inline Stripe checkout** (VB-6) — collapse adopt→pay.
- **Abandoned-build recovery email** (VB-7) — nudge build-started-never-claimed with the preview link.
- **Contextual upgrade prompts at friction** (VB-8) — domain / remove top-bar / more pages at the intent moment.
- **PostHog golden-path funnel** (VB-2) — search→build→claim→pay drop-off cohorts; unblocks every conversion bet.
- **Lead-scanner + outreach surface** (§26 / VB-13) — top-of-funnel acquisition.

### 2. Generated-site quality moat (protects the paid product)
- **Eval harness scoring every build** (VB-5) — GPT-4o vision + Lighthouse + SEO, regression-tracked.
- **Per-section AI-vision auto-reroll** (VB-14) — section <8/10 regenerates automatically.
- **AI competitor-gap scan at build** (#57) — score 5 peer sites, propose missing sections.
- **A11y autofixer + AI alt-text** (#54 / #97) — axe findings fixed pre-publish (ADA legal-risk reduction).
- **1:N sitemap fidelity guard** (VB-17) — fail builds that collapse page counts.

### 3. Reliability & correctness (trust + don't double-bill)
- **Idempotency-key middleware on all mutations** (T2-10) + **outbox→DLQ→retry processor** (T2-9).
- **Container build retry/DLQ** (VB-21) — capture/replay failed builds, not a silent error email.
- **Unify snapshot rollback** (S4) — one correct restore path.

### 4. Apps marketplace — paid managed-hosting levers (Tier A0 trust first)
- **Backups + 1-click restore** (A1), **live cost meter** (A2), **health/auto-heal timeline** (A3),
  **pre-provision dry-run + cost gate** (A4) — *why anyone pays vs a raw VPS*.
- **Per-instance custom domain + TLS** (A6), **sizing tiers + live upsize** (A7) — the direct paid upgrades.
- **Category pages + public app profiles** (A13 / A18) — indexable SEO + "Deploy to ProjectSites" loop; **share-stack link** (A21).

### 5. Snapshots — viral previews + stop the lying UI
- **Real Lighthouse/CWV + real axe-core** (S1 / S2) — the matrix shows permanently-null cells today (P0 honesty bug).
- **Immutable shareable preview URLs** (S22) → **"Built with" footer + "Build your own" CTA on previews** (S23 / S24).
- **Client Review Mode** (S27) — Approve promotes the snapshot live (agency-tier killer feature).
- **Undo-publish toast** (S17) + **scheduled publish / auto-revert** (S39).

### 6. Owner analytics that drive action (vs Wix/GA4)
- **Form-funnel + click-to-call tracking** (AN17 / AN18) — phone/form IS the service-biz conversion.
- **Owner-named goals + rate** (AN12, half-done) + **unified query service** (AN3) — AN3 unblocks every widget.
- **Section attribution** (AN26 / AN27) + **natural-language analytics** (AN29) — builder-only moat.
- **Weekly digest email** (AN23), **GBP connect + calls/clicks** (AN43 / AN44), **public share dashboard** (AN48),
  **year-in-review / benchmark** (AN49 / AN50) — cheap retention + upsell loops.

### 7. P1 epics (build deliberately)
- **Native booking engine** (P1-3) + **concierge widget injection** (P1-6).
- **Voice receptionist** (P1-1) — near-term work is ONLY the **compliance floor** (safety V13, emergency guard V22,
  consent ledger V35) + **booking / after-hours capture** (V15 / V16) + **per-minute wallet + killswitch** (V44).
  Everything else is gated behind go-live.

### 8. Cheap hardening + cleanup (fast wins)
- Forms: **sanitize stored fields** (F21), **rate-limit** (F19), **Zod boundary** (F40), **reply deliverability** (F43).
- Social (Pulse): **OAuth token refresh** (S2), **rate budget** (S6), **retry UX** (S8), **brand-voice + per-platform reformat** (S10 / S11).
- Infra: **R2 Standard→IA after 30d** (#92), **Queues off the request path** (#93).
- Hygiene: shared `requireOwnedSite()` (dedup 6 copies), `invalidateFlagCache` fix, 44 knip-dead exports,
  wire `*.e2e.ts` into CI, sweep stub TODOs (Stripe-refund / impersonation-JWT / Sora-Veo).
- Tooling that earns it: **Vitest** (kill swc-jest mock flakiness), schema-dts, html-validate, workers-og, Pagefind, promptfoo, Arcjet.

---

## ❌ PASS — cut or defer

- **Voice micro-opts pre-go-live** — turn-taking (V2–V7), carrier/STIR-SHAKEN/port-in. Premature until a real call breaks the latency budget.
- **Analytics vanity** — realtime counter/feed (AN20/21/25), scroll-depth/heatmaps (AN16/56), the AI-suggestion grab-bag (AN28–36), warehouse/EU-residency (AN4/41). No owner *action*; AI ones need traffic that doesn't exist yet.
- **Apps convenience** — semantic search (A8), bundles (A9), recommender (A10), media cards (A14), bulk actions (A15), metrics dash (A16), instance clone (A17). Ship the single-app paid path first.
- **Snapshots power-after-trust** — visual diff (S8), preview comments (S28), password-gate (S25). Downstream of the trust + review tiers.
- **Me-too / cosmetic** — social first-comment (S16), TikTok/YouTube (S33), calendar polish; speculative AI media (per-page podcast VB-18, hero video VB-19).
- **Internal-only refactors** — split index.ts, flatten folders, the full perf wave (zoneless/SSR/ag-grid→TanStack, T4). Dedicated session, not loop fodder.
- **~14 speculative tools** — unpic, Capsize, Partytown, unlighthouse, Recraft, fal.ai, zod-mock, Unkey, Stripe Meters, Scalar, Alchemy, Liveblocks, Tolgee, Nx. Adopt on concrete need.
- **Editor/IDE idea-dupes** (FEATURE-IDEAS #1/#3/#5) — subsumed by the bolt editor + `site_semantic_search`.

---

## 🔑 Genuinely needs Brian (3 decisions; everything else is autonomous)

1. **Pricing one-way doors** — free/Pro split (AN52), snapshot retention tiers (S45), AI-credits (AN53), 3rd-party paid app tier (A22). The loop can propose + wire; it shouldn't pick prices.
2. **Voice go-live** — confirm the auto-provisioned Twilio number (~$1/mo) to unblock the entire V-cluster.
3. **Notification engine** — confirm psnotify (the ZERO-Novu rule) so the Dittofeed/Novu drift can be deleted and it can be built; currently blocks all notification work.
