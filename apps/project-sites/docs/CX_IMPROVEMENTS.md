# CX Improvements Catalog

Consolidated reference for homepage/funnel customer-experience improvements.
Each entry: numeric ID · title · one-line description · implementation status.
Sources were 22 individual brainstorm files (01–43 + milestone-delight), each
containing ~50 sub-ideas. Only the top-level concept and shipped P0 items are
distilled here.

---

## Acquisition

| ID | Title | What it is + value | Status |
|----|-------|-------------------|--------|
| 01 | Programmatic SEO Matrix | Auto-generate `/site-builder-for/{industry}/{city}` SSR pages from D1; 300+ pages on day one for long-tail organic. | Shipped: routes + meta + KV/R2 cache + sitemap |
| 02 | Generate from Screenshot | Drop/paste a competitor's homepage → AI vision critique + palette + auto-draft site. Collapses "what do I want?" cold start. | Shipped: drop-zone + URL capture + vision critique + `/critique/{id}` permalink |
| 03 | Inline Domain + Business Search | Single hero input surfaces business results AND `.com/.io/.co` availability simultaneously. | Shipped: `/api/discovery/quick` + KV cache + debounce + PostHog |
| 05 | Sites Built Today Counter | Real D1-backed honest counter above the fold. Never fabricated; updated on every publish event. | Shipped: idempotent upsert + hero badge + `/api/stats/today` + count-up animation |
| 06 | Customer Site Gallery | Filterable gallery by industry + city with before/after drag slider. "Build mine like this" CTA pre-fills search. | Shipped: `gallery_entries` table + filter endpoint + Angular component + PostHog |
| 07 | Hero Walkthrough Video | 30-second muted autoplay per-industry video with WebVTT captions, lazy-mount, and reduced-motion respect. | Shipped: `walkthrough_videos` table + `/api/walkthrough` + Angular component |
| 10 | Auto-Detect Locale | Currency (CAD/EUR/GBP) via `cf.country`; language via `Accept-Language`; falls back to USD/EN. | Shipped: `detectLocale()` + `locale_overrides` table + KV cache + `/api/locale` |
| 11 | Voice Search | Mic icon → WebM blob → Workers AI Whisper → transcript auto-fills search. No external API key. | Shipped: `POST /api/search/voice` + mic button in hero + search + public HTML |
| 15 | Inline Domain Availability | Availability pills (`vitossalon.com — $9.77/yr`) shown under each business result before sign-up. | Shipped: `/api/search/domains-bulk` + Angular `<domain-pills>` + vanilla JS pills |

---

## Onboarding

| ID | Title | What it is + value | Status |
|----|-------|-------------------|--------|
| 04 | Industry Quiz Personalization | Three taps (industry / goal / budget) reshape hero copy, screenshot, and template; no email gate. | Shipped: quiz form + `/api/quiz/personalize` + D1 persistence + PostHog funnel |
| 12 | "I'm Not on Google" Path | Manual-entry form (name/address/phone/industry) auto-pops on zero Google results; Zod-validated. | Shipped: `POST /api/search/manual-business` + Angular + public HTML forms |
| 26 | Build Progress Bar | 7-step named stepper on `/waiting` with ETA, elapsed, per-step sub-messages, and reduced-motion. | Shipped: stepper UI + ETA counters + WCAG aria-live |
| 28 | Onboarding Checklist Persistence | Server-side checklist survives logout; sidebar progress ring; cross-device sync. | Shipped: D1 tables + 4 API routes + sidebar widget + audit log |

---

## Auth

| ID | Title | What it is + value | Status |
|----|-------|-------------------|--------|
| 21 | WebAuthn Passkeys | Touch ID / Face ID / Windows Hello as the top sign-in option; conditional UI autofill on email input. | Shipped: `passkeys` + `passkey_challenges` tables + 3 routes + frontend button + WebAuthn JS |
| 22 | Apple + Microsoft + GitHub OAuth | Broadens beyond Google + magic link; Apple `id_token` + Microsoft v2.0 flows. | Shipped: env vars + Apple + Microsoft OAuth routes + frontend buttons + PostHog |
| 24 | Phone Magic Link (SMS) | 6-digit OTP via Twilio SMS; Email \| Phone tab toggle; `<input autocomplete="one-time-code">`. | Shipped: `phone_magic_links` table + 2 routes + Twilio + frontend OTP UI + rate-limit |
| 25 | Remember Device 30 Days | HMAC-signed `ps_trusted_device` cookie; skips MFA for returning users. | Shipped: `trusted_devices` table + service + signed cookie + audit + PostHog |

---

## Domains

| ID | Title | What it is + value | Status |
|----|-------|-------------------|--------|
| 41 | One-Click Custom Domain | Search → Stripe Checkout → CF Registrar → live in <60s; $3/yr markup on wholesale. | Shipped: Stripe checkout + webhook → `registerDomain` + D1 `domain_purchases` + frontend |
| 42 | Domain Transfer-In Wizard | 4-step modal (domain → EPP code → pay → SSE progress); hashes EPP code at rest. | Shipped: Stripe + webhook → `transferInDomain` + SSE status stream + D1 columns |
| 43 | Email Forwarding Included | Catch-all `*@yourbiz.com → user.email` auto-fires on every domain purchase/transfer via CF Email Routing. | Shipped: `email_forwarding.ts` service + 3 routes + D1 table + domain-card badge |

---

## Delight

| ID | Title | What it is + value | Status |
|----|-------|-------------------|--------|
| 30 | Confetti + Share Moment | `canvas-confetti` fires once on first-publish transition; share modal with Twitter/LinkedIn/Threads prefabs. | Shipped: `first_site_celebrations` table + 2 routes + confetti + share modal + PostHog |
| 91 | Milestone Delight | Automated congrats emails + shareable 1200×630 brand-colored images for traffic, revenue, streak, and team milestones. | Shipped (16 rules): form/visitor/revenue/streak/lifecycle triggers wired to nightly cron via `milestones.ts` |
