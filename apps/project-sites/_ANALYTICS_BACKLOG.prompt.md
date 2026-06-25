# ★ ANALYTICS POWER BACKLOG — Claude Code prompt (convergence seeder)

> **Purpose:** seed the 56-task Analytics backlog into the single canonical worklist
> (`_LOOP_LEDGER.md`) so the convergence loop (`_CONVERGENCE.prompt.md`) picks it up.
> This file is the **regeneratable source** for the `## ★ ANALYTICS POWER BACKLOG`
> section in `_LOOP_LEDGER.md` — if that section is ever lost, re-run this prompt.
>
> Distilled from 50 audited+researched ideas (Plausible/Fathom/Umami/PostHog/Clarity/
> GA4/Shopify/Wix), broken into convergence-ready atomic tasks (one bounded verified
> slice per fire). Created 2026-06-24.

---

## RUN THIS PROMPT

```
Read apps/project-sites/_ANALYTICS_BACKLOG.prompt.md. If apps/project-sites/_LOOP_LEDGER.md
does NOT already contain a "## ★ ANALYTICS POWER BACKLOG" heading, append the TASK BLOCK
below verbatim to the END of _LOOP_LEDGER.md (it is the single canonical backlog the
convergence loop reads). If the heading already exists, reconcile: add any AN-task missing
from the ledger, never duplicate an existing slug, never un-check a completed [x] item.
Then commit (git add -f) + push. Do NOT build features in this run — this run only seeds
the worklist; the convergence loop (_CONVERGENCE.prompt.md §0) works the items one slice
per fire (highest-ROI unchecked [auto] item → TDD → green → commit+push → check off → deploy).
```

---

## HOW THE LOOP CONSUMES THIS

- The loop driver is `_CONVERGENCE.prompt.md`; the ONLY backlog it reads is `_LOOP_LEDGER.md`.
- Each fire picks the highest-ROI unchecked `[auto]` task, closes it end-to-end
  (RED→GREEN→clean→verify→doc→deploy→self-improve), checks it off inline `✅ done <commit>`.
- `[operator]` tasks (GBP/Twilio/EU-residency creds, vendor secrets) → **surface, don't build**.
- `[dedicated]` tasks (pricing one-way doors, money flows, data-warehouse cutover) →
  **spec + pause for Brian**, never blind-fire (per [[autonomous-engineering]] approval tier
  + [[one-way-two-way-doors]]).
- Each task = a feature module per [[feature-module-architecture]], flag-gated per
  [[feature-flags]] (`enabled=0, rollout=0, stage='experimental'`), server-guard 404-when-off.

## DEPENDENCY ORDER (build foundation first)

1. **AN0** (AN1–AN5) — ingestion enrichment + unified query + rollup. Unblocks everything.
2. **AN1** (AN6–AN9) — light up the dark `visitor_events` table = the owner dashboard (the #1 gap).
3. **AN2–AN8** — metrics, real-time, AI-native moat, privacy, local, monetization, honesty fixes.
- Hard prereqs: AN16→AN28 · AN26→AN27→AN28 · AN43→AN44 · AN1→(AN10,AN13) · AN2→AN14 · AN45–AN53 reference earlier widgets.

---

## TASK BLOCK (verbatim — this is the ledger section)

## ★ ANALYTICS POWER BACKLOG (Brian-selected 2026-06-24 — the loop integrates these into the /admin Analytics section + the dark per-site owner analytics)

> 56 convergence-ready tasks distilled from 50 audited+researched Analytics ideas (Plausible/Fathom/Umami/PostHog/Clarity/GA4/Shopify/Wix). Regeneratable source: `_ANALYTICS_BACKLOG.prompt.md`. Grounded in the 2026-06-24 audit — surfaces: `frontend/src/app/pages/admin/sections/analytics-dashboard.component.ts` (tab shell) + `analytics.component.ts` (CF-GraphQL Overview) + `analytics-live.component.ts` + `social-analytics.component.ts`; `src/routes/analytics.ts` (POST /api/events fast-ack) + `admin_analytics.ts` + `admin_funnel.ts` + `pulse_analytics.ts`; `src/services/analytics.ts` (PostHog) + `analytics_query.ts` (Tinybird); migrations `0532_visitor_events` (BUILT-DARK), `0022_usage_metering`, `0034_pulse_social`. **Headline gap: the paying site-owner sees NO analytics — `visitor_events` is fully built but has zero route/UI.** Six fragmented backends (CF-GraphQL · D1 analytics_events · D1 visitor_events · Tinybird · Analytics Engine · PostHog) with no unified query layer. Each task = a feature module per [[feature-module-architecture]] + flag-gated per [[feature-flags]].

### Tier AN0 — pipeline + unified query foundation (unblocks everything; do FIRST)
- [ ] AN1. Enrich ingestion: parse user-agent → device/browser/OS + parse UTM (source/medium/campaign) + derive channel (organic/social/direct/referral/paid) at `POST /api/events` (`src/routes/analytics.ts`); add columns to `visitor_events` (migration). [new][auto] slug `analytics_event_enrich`
- [ ] AN2. Geo enrichment at ingest — persist CF `request.cf.country/city/region` per-event into `visitor_events` (country-only at the edge today). [new][auto] slug `analytics_geo_capture`
- [ ] AN3. Unified owner-analytics query service — one `owner_analytics_query.ts` fronting `visitor_events` (+ CF-GraphQL where richer) so the UI hits one API, not six backends. [new][auto] slug `analytics_query_unified`
- [ ] AN4. Consolidate high-volume storage onto Cloudflare Analytics Engine (CLAUDE.md names it default; ZERO UI today) + documented retention/rollup policy; keep D1 for config/goals. Data-architecture one-way door → confirm before cutover. [partial][dedicated] slug `analytics_engine_warehouse`
- [ ] AN5. Daily rollup cron — aggregate `visitor_events` → `analytics_daily` per-site (visits/uniques/sources/pages/devices/geo/conversions) so owner queries are O(days) not O(events). [new][auto] slug `analytics_daily_rollup`

### Tier AN1 — owner dashboard core (light up the DARK table — the #1 gap)
- [ ] AN6. Owner site-analytics route + flag — `GET /api/sites/:siteId/analytics` over the unified service; flag `owner_analytics`; 404 dark. [built-dark][auto] slug `owner_analytics`
- [ ] AN7. Owner "Your Visitors" dashboard UI — new admin section component, per-site, mobile-first, single-screen overview (Plausible 1-screen bar). [built-dark][auto] slug `owner_analytics_ui`
- [ ] AN8. Outcome-language KPI cards — "37 people called you" / "12 contact forms", never "click events / goal completions". [new][auto] slug `analytics_outcome_kpis`
- [ ] AN9. Top-pages-by-visits widget with an engagement signal (not raw hits). [new][auto] slug `analytics_top_pages`

### Tier AN2 — the metrics SMB owners actually want
- [ ] AN10. Traffic-sources / channel breakdown widget (Google/Instagram/direct/referral) from AN1 channel. [new][auto] slug `analytics_sources`
- [ ] AN11. One-click UTM builder in the dashboard (track "the Instagram ad" without knowing UTMs). [new][auto] slug `analytics_utm_builder`
- [ ] AN12. Conversions / goals — owner names outcomes ("Menu viewed","Click-to-call"); show count + rate (`visitor_events.event_type='conversion'` exists, zero UI). [partial][auto] slug `analytics_goals`
- [ ] AN13. Device & browser split widget (from AN1 UA parse). [new][auto] slug `analytics_device_split`
- [ ] AN14. Geo drill-down — city/region map (country-only today; from AN2). [new][auto] slug `analytics_geo_drill`
- [ ] AN15. Period-over-period comparison — "+18% vs last week" deltas + trend arrows on every KPI (top GA4-alt request; absent). [new][auto] slug `analytics_compare_period`
- [ ] AN16. Scroll-depth + engagement-time — client beacon on generated sites (CF edge can't see it) ingested as events. [new][auto] slug `analytics_scroll_depth`
- [ ] AN17. Form analytics — completion rate + abandonment field per form; ties to existing forms ingest (bridges pageview→lead). [new][auto] slug `analytics_form_funnel`
- [ ] AN18. Click-to-call & directions tracking — instrument tel:/maps clicks in generated sites; surface as top conversions (phone IS the conversion for service biz). [new][auto] slug `analytics_call_clicks`
- [ ] AN19. Per-site funnel (landing → key page → conversion) — funnel service is super-admin-only; expose owner-scoped. [partial][auto] slug `analytics_owner_funnel`

### Tier AN3 — real-time, alerts, digests (the engagement loop)
- [ ] AN20. Real-time live visitor counter — DO-pushed "N people on your site now" (Event Dispatcher DO already exists). [new][auto] slug `analytics_realtime_count`
- [ ] AN21. Live visitor feed — anonymized stream (page/source/location) via the DO. [new][auto] slug `analytics_live_feed`
- [ ] AN22. Spike/drop alerts — threshold + rolling-baseline anomaly → psnotify/email. [new][auto] slug `analytics_alerts`
- [ ] AN23. Weekly email digest — Monday auto-summary (visits/top page/top source/one goal/one AI sentence) via SES+Listmonk + psnotify; NEVER Novu per [[feedback_no_novu_custom_notifications]]. [new][auto] slug `analytics_weekly_digest`
- [ ] AN24. Timeline annotations — pin "ran FB ad"/"posted on Nextdoor" to a date (context survives handoffs). [new][auto] slug `analytics_annotations`
- [ ] AN25. Goal-completion real-time ping via psnotify ("someone just submitted your form"). [new][auto] slug `analytics_goal_ping`

### Tier AN4 — AI-native (the MOAT — only a builder that generated the site can do this)
- [ ] AN26. Section-level instrumentation — auto-inject stable `data-ps-section`/`data-ps-cta` attrs into generated sites so events map to the exact AI-generated block (prereq for AN27). [new][auto] slug `analytics_section_tags`
- [ ] AN27. Section-level attribution query + UI — "the Services section drives 40% of contact clicks." The competitive moat (depends AN26). [new][auto] slug `analytics_section_attr`
- [ ] AN28. AI auto-suggest content edits from analytics — low scroll → "shorten this section?"; low CTA → "rewrite this button?"; one-click apply via bolt editor (depends AN16/AN27). [new][auto] slug `analytics_ai_suggest`
- [ ] AN29. Natural-language analytics query — "visitors from Instagram last week?" over the narrow owned dataset. [new][auto] slug `analytics_nl_query`
- [ ] AN30. AI weekly brief as prose (feeds AN23) — assistant paragraph w/ site name + business type, not a table. [new][auto] slug `analytics_ai_brief`
- [ ] AN31. Site-aware anomaly diagnosis — "traffic dropped 60%; found a broken homepage link — fix it?" (joins analytics + site health). [new][auto] slug `analytics_ai_diagnose`
- [ ] AN32. Auto-A/B on generated content — two AI hero variants, 50/50 split, auto-promote winner after N visits (ties Snapshots variants + visitor_events). [new][dedicated] slug `analytics_auto_ab`
- [ ] AN33. AI insight cards ranked by business impact; auto-dismiss on action. [new][auto] slug `analytics_insight_cards`
- [ ] AN34. Content-gap detection from search-referral keywords → "add an FAQ for X?". [new][auto] slug `analytics_content_gap`
- [ ] AN35. LLM-as-analyst on demand — "why fewer calls this month?" → 3-bullet reasoned answer over traffic + GBP + change history. [new][auto] slug `analytics_llm_analyst`
- [ ] AN36. Fleet-benchmark seasonality alerts — cross-tenant category patterns ("florists spike before Mother's Day → add a promo section?"). [new][auto] slug `analytics_seasonality`
- [ ] AN37. Auto-annotate timeline from AI edits — every bolt/AI edit pins a change marker so owners see change→impact (ties AN24). [new][auto] slug `analytics_edit_markers`

### Tier AN5 — privacy & trust (differentiator vs Wix/GA4)
- [ ] AN38. Cookieless-by-default + visible "No cookies · GDPR" privacy badge; generated sites never need a cookie banner (Plausible/Fathom positioning). [new][auto] slug `analytics_cookieless`
- [ ] AN39. IP anonymization + no-PII guarantee in the event store + documented retention policy surface. [new][auto] slug `analytics_pii_scrub`
- [ ] AN40. "Your data is never sold" pledge in the analytics UI (anti-Google stance). [new][auto] slug `analytics_data_pledge`
- [ ] AN41. EU data-residency option (CF D1 / Analytics Engine location hints). [new][operator] slug `analytics_eu_residency`
- [ ] AN42. One-click full data export (CSV) + delete for the owner (export is Overview-only today). [partial][auto] slug `analytics_data_export`

### Tier AN6 — local-business power (audience = local shops)
- [ ] AN43. Google Business Profile OAuth connect — link a GBP account (connect leg). [new][operator] slug `gbp_connect`
- [ ] AN44. GBP metrics surface — pull calls/direction-requests/profile-clicks into a unified "discovery" view joining GBP + site traffic (depends AN43). [new][auto] slug `gbp_metrics`
- [ ] AN45. Local SEO rank tracking — "you rank #3 for 'plumber Newark'" over time. [new][operator] slug `analytics_local_rank`
- [ ] AN46. Review monitoring — new Google/Yelp reviews + rating trend alongside traffic. [new][operator] slug `analytics_reviews`
- [ ] AN47. Optional tracked call number (Twilio in-stack) so phone conversions are measured, not guessed. [new][dedicated] slug `analytics_call_tracking`

### Tier AN7 — sharing, reporting, monetization
- [ ] AN48. Public shareable read-only dashboard URL (token + optional expiry) for accountant/landlord/grant reviewer; carries "Built with" badge (Plausible differentiator + growth surface). [new][auto] slug `analytics_public_share`
- [ ] AN49. Year-in-review auto report ("4,200 visitors, 312 contact submits, best month October") — zero-cost retention touch at renewal. [new][auto] slug `analytics_year_review`
- [ ] AN50. Benchmark vs fleet median — "your form converts 1.2% vs 3.4% category avg" → positions the AI rewrite tool as the fix. [new][auto] slug `analytics_benchmark`
- [ ] AN51. White-label client PDF/email reports — branded monthly report; agency reseller tier. Pricing one-way door per [[one-way-two-way-doors]] → confirm tier. [new][dedicated] slug `analytics_whitelabel_report`
- [ ] AN52. Analytics-as-plan-gate — basic free; goals/funnels/heatmaps/digests/AI-queries gated to Pro. Pricing one-way door → confirm gating. [new][dedicated] slug `analytics_plan_gate`
- [ ] AN53. AI-insight credits metering (free 10/mo, Pro unlimited) on NL query + AI suggestions. Money flow → approval-required. [new][dedicated] slug `analytics_ai_credits`

### Tier AN8 — foundation/honesty fixes (from the audit)
- [ ] AN54. Operator zero-state honesty — super-admin Tinybird routes silently return `degraded:true` when unconfigured; render a clear "source not configured" notice (quiet lying-UI cousin per [[lying-ui-catcherror-class]]). [partial][auto] slug `analytics_degraded_notice`
- [ ] AN55. Live Events tab — pagination + filter + search (capped 500 rows, no paging today). [partial][auto] slug `analytics_live_paging`
- [ ] AN56. Heatmaps — move/scroll/rage-click client capture + replay-lite overlay (Clarity/Hotjar pattern). [new][dedicated] slug `analytics_heatmaps`
