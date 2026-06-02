# 50 Extra Feature Modules — projectsites.dev

> De-duped against the live surface (46 `libs/features/*`, 151 flag keys, 45 admin sections) — every item below is NEW, not a rename of something shipped. Tagged 💰 bottom-line / 😊 customer-satisfaction. Each ships as a `libs/features/<slug>/` module behind a flag per project doctrine. Date: 2026-06-02.

> **Brian-prioritized to build first (2026-06-02): #4, #8, #10, #11, #12, #17.** #14 DROPPED (snapshots duplicate). See `_ULTIMATE_CONVERGENCE.md` P1.

## A. Platform-level (projectsites.dev — for the account holder operating their sites)

1. **aeo_autopilot** — track AI-search citations (ChatGPT/Perplexity/Gemini), auto-edit pages to close gaps, re-test, show lift. 💰😊 (replaces the removed passive geo_visibility_tracker with a closed loop)
2. **self_healing_site** — agent monitors live sites for broken links, dead embeds, stale hours, CWV/Lighthouse regressions, expired promos → auto-fixes + logs. 💰😊
3. **uptime_status_page** — per-site uptime monitor + branded public status page + incident history. 😊
4. **review_approval_links** — shareable preview links where stakeholders comment + approve before publish (the safe replacement for the removed approval_workflow). 😊💰
5. **brand_kit_manager** — versioned logo/palette/fonts/voice kit applied across the whole site in one click. 😊
6. **onboarding_checklist** — activation checklist + score; nudges to first-published-site (retention/activation). 💰😊
7. **product_tour** — interactive in-dashboard guided walkthrough for new operators. 😊
8. **team_seats_rbac** — per-org seats, roles, invites, transfer-ownership UI. 💰 (seat-based expansion)
9. **customer_activity_log** — customer-facing "who changed what, when" feed (distinct from the internal audit log). 😊
10. **outbound_webhooks** — customers subscribe their own endpoints to site events (Svix-style signed delivery + retries). 😊
11. **automation_builder** — no-code trigger→action recipes (Zapier-lite) wiring forms/payments/CRM/email. 💰😊
12. **email_deliverability_wizard** — guided SPF/DKIM/DMARC + inbox-placement test + warmup. 😊
13. **content_calendar** — editorial calendar + scheduled AI autoposts (extends content_freshness into planning). 💰😊
14. ~~**backup_restore**~~ — **DROPPED (Brian, 2026-06-02): duplicate of Snapshots** (snapshots + changeset_service + site_branches already = git-style versioning + restore). Do not build. Any backup/restore need = extend Snapshots.
15. **spend_budget_caps** — full $ spend dashboard + budget caps + threshold alerts across AI/build/usage (token_burn_meter is tokens-only). 💰
16. **consent_compliance** — per-site GDPR/CCPA cookie banner + consent log + data-subject-request inbox. 😊
17. **bulk_site_ops** — apply a change/section/flag across ALL your sites at once (agency leverage). 💰😊
18. **dashboard_copilot** — in-app assistant that can navigate + perform admin actions ("turn on bookings for Vito's"). 😊
19. **sla_incident_credits** — SLA tiers, incident comms, automatic service-credit issuance. 💰 (enterprise)
20. **creator_payouts** — revenue-share + payouts for template/section marketplace creators (the marketplace exists as a catalog; this is the money rail). 💰
21. **staging_slots** — true per-site staging environment + promote-to-prod (beyond snapshots). 😊
22. **scheduled_publish** — schedule publishes + content embargo windows. 😊
23. **competitor_beat_report** — score your site vs named competitors on a rubric + auto-generate the gap-closing edits (the actionable replacement for the removed competitor_monitor). 💰
24. **campaign_links_qr** — per-site vanity short-links + QR codes + UTM campaign tracking. 💰😊
25. **nps_feedback_loop** — in-dashboard NPS/feedback widget feeding the public roadmap. 😊

## B. Client-site-level (ships ON the generated end-customer site / their visitors)

26. **announcement_bar** — dismissible promo/announcement bar with scheduling. 😊💰
27. **lead_capture_popups** — exit-intent + scroll/timed popups with A/B variants. 💰
28. **social_proof_notifications** — live "just booked / 12 people viewing" nudges. 💰
29. **urgency_timers** — countdown/scarcity timers for offers. 💰
30. **coupon_engine** — promo codes, % / fixed / BOGO, usage caps + expiry. 💰
31. **gift_cards** — issue/redeem digital gift cards. 💰
32. **abandoned_cart_recovery** — email/SMS recovery sequences for unfinished checkouts. 💰
33. **multi_currency_geo_pricing** — visitor-geo currency + localized pricing. 💰
34. **tax_vat_calc** — automatic sales-tax/VAT at checkout by jurisdiction. 😊
35. **digital_downloads** — secure delivery of files/license keys post-purchase. 💰
36. **event_ticketing** — ticket sales + RSVP + check-in QR. 💰
37. **store_locator** — multi-location map + hours + directions. 😊
38. **online_ordering** — restaurant menu + cart + pickup/delivery (vertical revenue). 💰
39. **job_board** — careers listings + applicant capture. 💰
40. **testimonial_collection** — request → collect → moderated on-site testimonial/review wall. 😊💰
41. **help_center** — branded knowledge base + AI answer box for the client's visitors. 😊
42. **site_search** — instant, typo-tolerant on-site search. 😊
43. **heatmaps_replay** — privacy-safe visitor heatmaps + session replay surfaced to the owner. 😊
44. **content_personalization** — returning-visitor / geo / referrer content + offer swaps (broader than the removed visitor_recognition). 💰
45. **fundraising_campaigns** — goal thermometers, tiers, peer-to-peer pages (extends donations_engine into campaigns). 💰
46. **volunteer_signup** — shift signup + waivers + reminders (nonprofit). 😊
47. **waitlist_prelaunch** — pre-launch waitlist + referral queue position. 💰
48. **webinar_registration** — live event/webinar registration + reminders + replay gate. 💰
49. **visitor_accounts** — end-visitor login/accounts on the client's site (saved info, order history) — distinct from the operator's membership_paywall. 💰😊
50. **quote_calculator** — configure-price-quote estimator that captures the lead. 💰

## Ship-first 8 (highest revenue-per-effort, mostly client-site = direct customer ROI)
- **abandoned_cart_recovery (32)** + **coupon_engine (30)** + **lead_capture_popups (27)** — direct, measurable conversion lift on every commerce/lead site.
- **review_approval_links (4)** + **staging_slots (21)** — kill the #1 agency/operator friction (safe publishing).
- **team_seats_rbac (8)** + **sla_incident_credits (19)** — the two cleanest ARR expanders (seats + enterprise).
- **aeo_autopilot (1)** — the defensible platform wedge no competitor bundles.

## Notes
- Several extend (not duplicate) shipped modules: 13↔content_freshness, 14↔snapshots, 45↔donations_engine, 49↔membership_paywall — framed as the missing layer, not a rebuild.
- Each = a `libs/features/<slug>/` module: manifest + flag (`enabled=0, rollout=0, experimental`) + Zod schemas + handlers + tests + e2e, per the project's feature-module + flag doctrine.
