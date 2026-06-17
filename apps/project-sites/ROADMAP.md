# ROADMAP — the single revenue-sorted build list

> **The convergence loop runs on THIS file.** One consolidated, deduped list of every
> idea worth building, sorted by **bottom-line impact** (revenue → churn-protection →
> conversion → activation → trust/ops). Merged 2026-06-17 from TODO.md (40-list),
> UNFINISHED_FEATURES.md (completion audit), and FEATURE_CATALOG idea backlog — those
> files were dissolved into this one.
>
> Loop rule: take the **topmost unchecked item** each fire (top = highest $-impact).
> Every new capability ships as `libs/features/<slug>/` (manifest + flag
> `enabled=0,rollout=0,stage=experimental` + Zod + colocated tests + e2e), `npm run
> validate:features` green, deploy gated. Module **statuses** (built/stub/partial) live
> in `FEATURE_CATALOG.md`; this file is the **priority order**.

Legend: **NEW** new module · **EXTEND** grow existing · **STUB→** finish a scaffolded stub · **FIX** wire/repair · `flag`.

---

## TIER 0 — Direct revenue + margin/churn protection (DO FIRST)
The money path. `payments_rail` is the keystone — it unblocks every item below it.
- [ ] **Platform MCP server** — `platform_mcp` · ALPHA (read tools live) · Claude Code/Cursor connect via scoped `psk_` API key → list/inspect/build-status today; **`deploy_site` next** (deploy from the editor). Distribution play — opens the developer market. See `libs/features/platform_mcp/README.md`.

- [ ] **Unified payments rail** — `payments_rail` · STUB→ · one Square(accept)+Stripe(SaaS/payouts) idempotency+webhook+entitlement seam. **Foundational: unblocks booking deposits, storefront, donations capture, marketplace, dunning.** Build FIRST.
- [ ] **Dunning / failed-payment recovery** — `dunning_recovery` · NEW · retry + recovery emails on failed charges. Direct churn-revenue protection; missing today. Rides `billing`.
- [ ] **Native booking engine** — `native_booking_engine` · STUB→ · availability + holds + reminders + deposit (via `payments_rail`). Booking IS the conversion action for local/service tenants → their #1 revenue driver. Cal.com-class.
- [ ] **Org AI budget cap + killswitch** — `org_ai_budget_cap` · EXTEND `token_burn_meter` · hard per-org spend cap that STOPS a runaway bill (meter only measures today). Protects platform margin.
- [ ] **Storefront / e-commerce tier** — `storefront_ecommerce` · STUB→ · products/variants in D1, R2 assets, Square checkout behind `payments_rail` (not MedusaJS by default — Shopify/Medusa-on-Container only for heavy-commerce tenants). Direct tenant revenue + upsell tier.
- [ ] **Membership / paywall** — `membership_paywall` · NEW · gated content + recurring tenant revenue.
- [ ] **Credit wallet rollover + promo** — `credit_wallet_rollover` · EXTEND `billing` · rollover + promo credits + expiry urgency → higher credit monetization + LTV.
- [ ] **Referral / affiliate loop** — `referral_loop` · EXTEND `billing` Affiliates + Stripe Connect + `contacts` · tracked links + credit rewards. Compounding low-CAC growth (rides `credit_wallet_rollover`).

## TIER 1 — Conversion lift on GENERATED sites (proves tenant ROI → retention)
These make the tenant's site convert → the tenant renews. Highest visitor-facing whitespace.

- [ ] **AI concierge widget** — `ai_concierge_widget` · STUB→ (`libs/features/ai_concierge/`) · stateful per-site chat grounded in the site's content w/ real tool-calls (book/quote/route). 24/7 lead capture — highest-engagement visitor feature. Agents SDK on a DO.
- [ ] **Edge per-visitor personalization** — `edge_personalization` · EXTEND `visitor_events_core` · no-PII <10ms hero/sub/image/CTA/sticky-bar swap by geo/device/referrer/time/return, A/B-eval looped. 15-20% CVR lift.
- [ ] **AEO / AI-search optimization** — `aeo_pass` · EXTEND `seo_autopilot` · per-publish structured-data + answer-block tuning for ChatGPT/Perplexity/AI-Overviews citation = the 2026 discovery channel → tenant leads.
- [ ] **Visitor analytics beacon (producer)** — `visitor_events_core` · FIX · CSP-nonce-safe beacon injected into served sites so the (built) ingest has a producer; powers the tenant's ROI dashboard (retention lever). Land with a deploy, not a blind fire.
- [ ] **Auto-installed semantic site search** — `site_semantic_search` · EXTEND `rag.ts` · managed RAG over each published site's R2 content + widget; R2-event re-index.
- [ ] **Conversion blocks for site-kit** — extend `src/app/site-kit/` · the 24 unbuilt blocks (booking-embed, reservation-widget, donation-block, sticky-call-bar variants, review-schema card, urgency-strip, exit-intent). See `SITE_KIT.md`.

## TIER 2 — Build-flow activation + platform moat (more sites published = more revenue)
Faster/better generation → more activated tenants.

- [ ] **Sitemap + wireframe planning gate** — `wireframe_planning` · EXTEND `site-generation` + `/create` · approval gate before section-gen; catches IA problems → better first output → activation.
- [ ] **Competitor-URL clone-to-seed** — `url_clone_seed` · PARTIAL · paste URL → Browser-Rendering extract → prefill builder. Top acquisition fast-start.
- [ ] **Visual point-and-click edit** — `visual_point_edit` · NEW (extends bolt editor + `swarm`) · click any node → AI mutates only it, no full regen. Industry's #1 churn reducer.
- [ ] **Onboarding copilot** — `onboarding_copilot` · NEW (mandated CLAUDE.md PART 6) · in-product next-action guidance → activation.
- [ ] **Prompt-versioning studio** — `prompt_studio` · NEW admin section over existing `prompts/registry` (A/B + KV hot-patch already internal).
- [ ] **Cmd+K AI actions** — `cmdk_ai_actions` · EXTEND `command-palette` (palette already shipped) · NL → nav/bulk-mutations/agent-tasks.

## TIER 3 — Trust, compliance, ops, polish (necessary; indirect revenue)
- [ ] **AI content guardrails** — `ai_gateway_guardrails` · EXTEND `external_llm` + AI Gateway · Llama Guard on `/ai/*`, no-redeploy killswitch. Per `ai-agent-security`.
- [ ] **Abuse + takedown** — `abuse_takedown` · DMCA/illegal-content handling = hosting-platform necessity (verify; flag exists).
- [ ] **Visitor DSAR (deletion)** — `visitor_dsar` · EXTEND `contacts_core` · GDPR deletion (the legal other half of `data_export` portability).
- [ ] **SMTP/outgoing-mail persistence** — worker route storing per-site SMTP (AES-GCM via `MCP_ENCRYPTION_KEY`) + server-side 500-emails/mo free cap in `notifications.ts`. Push-gated.
- [ ] **Make `/api/site-features` toggles live** — currently persists state with no serving backend.
- [ ] **Public status page + uptime SLA** — `status_page_live` · EXTEND `pages/status` shell.
- [ ] **Newsletter engine** — `newsletter_engine` · NEW (distinct from `email_marketing`).
- [ ] **Live thumbnail grid** — `site_thumbnail_grid` · EXTEND admin sites (reuse `snapshots` screenshot). Small polish.

## Known bugs / drift to fix in-band (P2, fast wins)
- `conversational_edits.ts` cross-tenant write guard (security) · `features.ts` flag-cache one-liner (override-write must call `invalidateFlagCache`) · 44 knip-dead `features.ts` exports → remove · wire the `*.e2e.ts` prod suite into CI · ag-grid → TanStack perf wave (`docs/perf-wave-ag-grid-to-tanstack.md`) · TODO/FIXME sweep (Stripe refund stub, impersonation JWT stub, agency-invite email stub, Sora/Veo placeholder, snapshot `commit_iso`/`revertSnapshot`).

---

> Reference impl: `libs/features/donations_engine/` (canonical module). Module statuses:
> `FEATURE_CATALOG.md`. Generated-site blocks: `SITE_KIT.md`. Cost guardrails: DECISIONS ADR-0009.

## From deep research (#36-100, mined 2026-06-17 from _research/)
The non-duplicate high-value ideas pulled before retiring the research files:
- [ ] **External booking-widget embed** (#62) · TIER 1 · one-line `<script>` that drops the tenant's `native_booking_engine` onto an EXTERNAL host (their existing WordPress/Squarespace) → captures leads beyond the generated site. Rides `payments_rail` + booking.
- [ ] **AI competitor-gap detector** (#57) · TIER 2 · scan 5 peer sites at build → propose missing sections. Makes generated output provably beat competitors (activation/retention).
- [ ] **AI a11y auto-fixer** (#54) · TIER 3 · axe-core findings → AI proposes + applies fixes pre-publish. ADA-compliance differentiator (legal risk reducer for tenants).
- [ ] **AI alt-text writer** (#97) · TIER 3 · propose alt text for uploaded images (a11y + image SEO).
- [ ] **Workers Queues background jobs** (#93) · TIER 3 (infra) · move snapshots/email/image-proc off the request path → reliability + lower p99.
- [ ] **R2 lifecycle: Standard → IA after 30d** (#92) · TIER 3 (margin) · auto cold-tier old site versions/assets → hosting-cost reduction at scale.

> **Descoped** (cut from scope — see DECISIONS ADR-0010): figma_import, page_audio_summary,
> generative_ui_stream (modules removed), brand_voice_clone, media_library, i18n_localization
> (platform module), enterprise_sso/enterprise_plan, site_mcp_server, generative admin UI, and the
> marketplace-sprawl trio (plugin_marketplace / integration_directory / stripe_marketplace —
> kept template_marketplace). Built+deployed ones stay deprecated-in-place, not deleted mid-loop.
