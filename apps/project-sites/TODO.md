# TODO — selected 40-list features (Brian, 2026-06-17)

Reduced + mapped from the "top 40 features" research. Each is assigned to an existing
module/section to **extend**, or a **new** `libs/features/<slug>/` module, plus a feature
flag (`enabled=0, rollout=0, stage='experimental'` per `rules/feature-flags`). Dedup'd
against `_IDEAS.md` + `FEATURE_CATALOG.md` — several are already partially built.

Legend: **NEW** = new module · **EXTEND** = grow an existing module · **STUB→** = a
verified-missing catalog stub to complete · **PARTIAL** = scaffolding already on disk.

Build order note: **27 payments_rail is foundational** — it unblocks 25 / 26 / 28 / 34.
Ship it first, then the commerce + credits + referral cluster rides on one webhook/idempotency seam.

---

## A. Generation & editing
- [ ] **Visual point-and-click edit (#1)** — flag `visual_point_edit` · NEW, extends bolt editor + `swarm` · click any live-preview node → AI mutates only that node, no full regen (industry's #1 churn reducer). Mirrors `_IDEAS` "Visual canvas editing".
- [ ] **Sitemap + wireframe planning layer (#2)** — flag `wireframe_planning` · EXTEND `workflows/site-generation` `structure-plan` step + `/create` · surface the existing plan as an approval gate (IA + page wireframes) BEFORE section gen.
- [ ] **Competitor-URL clone-to-seed (#3)** — flag `url_clone_seed` · PARTIAL, extends `site-create` + `scrape-website`/`build_context` · paste a URL → Browser Rendering `/json` extracts layout+copy+structured-data → prefill builder. Dedup: `_IDEAS` "URL-to-site cloning".
- [ ] **Figma → production import (#5)** — flag `figma_import` · NEW (lower priority) · ingest a Figma file → tokens/components/responsive into a generated site.

## B. Visitor-facing AI (biggest whitespace)
- [ ] **AI concierge widget (#7)** — flag `ai_concierge_widget` · STUB→ `libs/features/ai_concierge/` (the empty `site-concierge` frontend dir) · stateful per-site chat agent grounded in that site's content, real tool-calls (book/quote/route). Cloudflare Agents SDK on a DO. **High priority.**
- [ ] **Auto-installed semantic site search (#8)** — flag `site_semantic_search` · EXTEND `services/rag.ts` (Vectorize+AutoRAG already wired) · every published site gets managed RAG over its own R2 content + a search widget; R2 event → re-index.
- [ ] **Per-page AI audio summary (#10)** — flag `page_audio_summary` · NEW, extends `services/media` TTS · 2–3 min narrated overview per route. **Keep OFF by default** (flag default already `enabled=0`; promote per-tenant opt-in only).
- [ ] **Behavioral hero/CTA swap (#11)** — flag `edge_personalization` · EXTEND `visitor_events_core` + edge · sub-10ms Workers-AI/rules swap, NO PII, variants pre-built, A/B-eval looped back. Dedup: `_IDEAS` "Edge per-visitor personalization". **See "What gets swapped (#11)" below.**

## C. Platform AI UX
- [ ] **Cmd+K AI actions (#12)** — flag `cmdk_ai_actions` · EXTEND `components/command-palette` (palette + Cmd+K focus gate ALREADY shipped) · add NL → navigation + bulk mutations + agent tasks. Mostly-built; this is the AI-actions layer only.
- [ ] **Streaming generative UI (#15)** — flag `generative_ui_stream` · EXTEND `components/agent-message` + `ai-chat-widget` · copilot streams live components (charts/forms/compare cards), not just text.
- [ ] **Prompt-versioning surface (#17)** — flag `prompt_studio` · NEW admin section `prompt-studio`, exposes existing `prompts/registry` (versioning + A/B + KV hot-patch already internal) · non-engineers manage templates with A/B + rollback.

## D. Trust & safety
- [ ] **AI content guardrails at the gateway (#19)** — flag `ai_gateway_guardrails` · EXTEND `services/external_llm` + AI Gateway · Llama Guard 3-8B middleware on `/ai/*`, block injection/hate/off-brand pre-publish, no-redeploy killswitch. Per `rules/ai-agent-security`. Dedup: `_IDEAS` "Real-time content guardrails".
- [ ] **Public status page + uptime SLA (#23)** — flag `status_page_live` · EXTEND `pages/status` (route already exists) · wire real uptime/incident data + subscriber alerts (Betterstack/Instatus or self-hosted). Reduced: grow the existing shell, don't rebuild.

## E. Commerce & money  (ship 27 FIRST)
- [ ] **Unified payments rail (#27)** — flag `payments_rail` · STUB→ `libs/features/payments_rail/` · shared idempotency + webhook + entitlement seam across Square (accept) + Stripe (SaaS/payouts) per `rules/payments-routing`. **Foundational — do first.**
- [ ] **Storefront / e-commerce tier (#25)** — flag `storefront_ecommerce` · STUB→ `libs/features/storefront/` (the `storefront-manager` frontend stub) · products in D1, media in R2, checkout via Square Web Payments SDK. **Not MedusaJS by default — see "Why not MedusaJS (#25)" below.**
- [ ] **Native booking engine (#26)** — flag `native_booking_engine` · STUB→ `libs/features/booking_engine/` (catalog's top gap; `multimodal_intake` already references the flag) · availability + reminders + AI scheduling. Rides `payments_rail` for deposits. **High priority.**
- [ ] **Credit wallet rollover + promo (#28)** — flag `credit_wallet_rollover` · EXTEND `libs/features/billing` (wallet + AI-credits tabs already live) · add rollover + promo credits + expiry urgency.

## F. Growth & distribution
- [ ] **AEO / AI-search optimization pass (#33)** — flag `aeo_pass` · EXTEND `libs/features/seo_autopilot` · per-publish audit + structured-data tuned for ChatGPT/Perplexity/AI Overviews. Dedup: `_IDEAS` "AI-native GEO layer".
- [ ] **Referral / affiliate loop (#34)** — flag `referral_loop` · EXTEND `billing` Affiliates tab + Stripe Connect payouts + `contacts` · in-product refer-a-friend, tracked links, credit rewards (rides `credit_wallet_rollover`).

## G. Cloudflare quick win
- [ ] **Live thumbnail grid (#36)** — flag `site_thumbnail_grid` · EXTEND admin `sites`/`dashboard` (reuse `snapshots` screenshot path) · real-browser thumbnails of every site via Browser Rendering `/screenshot`. Small, high-polish.

---

## What gets swapped (#11) — concrete example

`edge_personalization` swaps ONLY the above-the-fold conversion surface — **hero headline,
hero sub, hero image, primary CTA label+action, and the sticky bar** — never body content,
never anything needing PII. Signals: geo, device, referrer/keyword, time-of-day, new-vs-returning.

Example — a landscaper at `greenscape.projectsites.dev`:
- Referrer keyword "emergency tree removal" → hero `"Beautiful lawns, year-round"` → **`"Storm damage? Same-day tree removal"`**, CTA `"Get a quote"` → **`"Call now"` (`tel:`)**.
- Mobile + after 9pm → primary CTA becomes a **tap-to-call sticky bar** instead of a contact form.
- Returning visitor who already saw `/pricing` → hero → **`"Ready to book? Pick a time"`** + a Calendly CTA.
- Geo inside the service area → subhead injects **`"Serving {city} since 2009"`**; out-of-area → **`"Now booking across {region}"`**.

All variants are pre-generated at build, chosen by a <10ms Workers-AI/rules call at the edge,
and the win/loss feeds an A/B eval that re-ranks variants. No cookie banner needed (no PII).

## Why not MedusaJS (#25)

**No — not by default.** Medusa is a long-running Node.js commerce server that needs a persistent
process + Postgres + Redis. That doesn't fit the Cloudflare Workers edge runtime (no always-on Node
process) and violates Cloudflare-first + simplicity/cost. Default: a **lightweight native storefront
on CF primitives** — products/variants in **D1**, assets in **R2**, checkout via **Square Web Payments
SDK** (the accept-money default per `rules/payments-routing`), all behind `payments_rail`. Zero extra
server, edge-fast, one webhook seam.

Reserve heavier engines for the rare heavy-commerce tenant (1000s of SKUs, complex fulfillment/tax):
then embed **Shopify** (storefront API) or run **Medusa on a Cloudflare Container + Neon** as an
opt-in upgrade — never the default path.

---

> Pointer: this list is the reduced home for the selected 40-list items. Full catalog +
> module statuses in `_IDEAS.md` + `FEATURE_CATALOG.md`. Each box above becomes a real
> `libs/features/<slug>/` module (manifest + flag + schemas + tests + e2e) when picked up.
