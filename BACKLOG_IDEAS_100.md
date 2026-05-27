# 100 All-Star Improvement Ideas

> Curated 2026-05-26. Generated after Phases 0-7 shipped. Each idea has been filtered against:
> 1. **Specific** — not generic "be better at X"
> 2. **Measurable** — drives a KPI we can name
> 3. **Achievable** on the Angular 21 + Workers + D1 stack
> 4. **Differentiated** — not table-stakes any SaaS already has
> 5. **Aligned** with the v2 doctrine and the served-population ethos
>
> Next step: heavy web research reduces this to 50 with citations in `BACKLOG_50_RESEARCHED.md`.

---

## Marketing & Editorial Surfaces (1–10)

1. **Quotable answer blocks at the top of every blog post** — 40–60 words, schema-marked for ChatGPT/Perplexity citation. AI-search inclusion rate climbs measurably when this exists.
2. **AI-generated 90-second podcast per long-form page** via OpenAI TTS or ElevenLabs. NotebookLM-style. "Listen to this article" widget.
3. **Edit-history badge linking to the GitHub PR** that last touched each public page. Radical transparency; quietly demonstrates competence.
4. **Interactive ROI calculator on /pricing** — "vs Webflow + Stripe + Calendly + Mailchimp." Outputs annual savings.
5. **Speakable schema markup** for Google Assistant audio reading on every blog post.
6. **AI search ("Ask anything")** powered by Workers AI + Vectorize embeddings of every doc + blog post.
7. **Locale-aware hreflang network** — /es/*, /pt/* mirrors auto-generated for service areas with ≥10% non-English community share.
8. **Live status feed on /** showing recent deploys, total sites built, current snapshot count. Real telemetry, not vanity.
9. **Inline "AI summary" toggle** on long pages — switch between full prose and a 200-word executive summary.
10. **RSS + JSON Feed + ActivityPub** on /blog so posts federate to Mastodon natively without a bridge.

## Dashboard Shell & UX (11–25)

11. **Predictive route prerender via Speculation Rules** trained on the user's last 5 nav clicks.
12. **BroadcastChannel sync** — role-switch in one tab reflects across all open tabs instantly.
13. **Universal Cmd+Z undo** with 5-second toast across every CRUD operation.
14. **Cmd+K with action mode** — "create booking tomorrow 3pm" parses to a quote draft, not navigation.
15. **Tab-aware favicon** — red dot + tab-title prefix when job status changes in background.
16. **Density toggle** (comfortable / compact / dense) global, persisted per user.
17. **Drag-reorder** dashboard widgets, nav items, table columns — persisted per user.
18. **Customizable dashboard home** with saved layouts per role.
19. **Cross-feature timeline** — every event across bookings/jobs/sites/billing on one feed.
20. **Role-aware onboarding tour** dismissable + resumable, never blocking.
21. **Empty-state CTAs that create-the-first-result inline** — never "no data."
22. **"What's new" coachmarks** that auto-clear after 14 days per feature.
23. **Right-rail AI assistant** scoped to the current route's data — never the whole DB.
24. **Auto-generated keyboard shortcut sheet** from `data-shortcut` attributes on every action.
25. **Incremental hydration skeleton screens** so nothing flickers on first paint.

## Auth & Security (26–35)

26. **Risk-based step-up** — new IP + new device + unusual hour triggers TOTP/passkey prompt.
27. **Map-marker session list** showing IP-geolocation of every active session.
28. **Magic-link expiry reminder email** at 12 hours, before token dies.
29. **Account recovery via 2-of-3 trusted contacts** (social recovery).
30. **WebAuthn conditional UI** on Email field — passkey autofill before user types.
31. **Cross-device push-confirmation** for high-risk operations (refund > $500, account deletion).
32. **Granular OAuth scope picker** — approve specific endpoints only, revocable individually.
33. **Hardware-key visual confirmation** (key animation when tapped) — fights phishing.
34. **Audit-log diff viewer** — every config change shows before/after JSON.
35. **Idle timeout sliders per role** — customer 60min, crew 8hr, super-admin 30min.

## Marketplace & On-Demand (36–50)

36. **Surge transparency** — "1.2x because demand is high in 07034" with map heat overlay.
37. **Live customer↔crew chat translation** via Workers AI (EN↔ES primary).
38. **Background-check verification pills** on crew profiles (ID / Background / Insured / Bonded).
39. **Photo verification with GPS+EXIF timestamp** on before/after shots.
40. **AI dispatch optimizer** rebalancing the queue every 30 seconds.
41. **Per-job carbon-footprint estimator** (miles × vehicle type).
42. **Tip-in-advance** to jump the dispatch queue.
43. **Multi-stop bundle discount** — booking power-wash + landscape same day auto-bundles.
44. **Loyalty pricing** — every 5th booking from same crew gets 5% off automatically.
45. **Crew schedule predictor** — "based on history you'll be busy at 2pm Tuesday."
46. **Background-acting castings** — photo gallery + measurement form per crew.
47. **Surge-zone painter** for dispatch admins — drag-to-paint surge areas on the map.
48. **Twilio voice masking** the entire customer-crew call channel by default.
49. **SOS button on every job detail** with location + status auto-sent to platform safety.
50. **Mid-job upsell** — crew taps "add trim power-wash" → customer confirms in-app, payment auto-adjusts.

## Website Generator (51–65)

51. **AI-generated 90-second podcast per tenant homepage** — "listen to our mission."
52. **Brand-color WCAG-AA auto-adjuster** — lighten/darken extracted palette until contrast passes.
53. **Multi-domain shipping per tenant** — one site, multiple custom domains with hreflang.
54. **AI a11y auto-fixer** — pass site through axe-core, AI proposes + applies fixes.
55. **Per-section A/B testing toggle** — KV-routed 50/50 split with conversion stats.
56. **Snapshot preview on every edit** — every change produces a preview URL before publish.
57. **AI competitor-gap detector** — scan 5 peer sites, propose missing sections + copy.
58. **Section library marketplace** with community-contributed sections, 1-click install.
59. **Per-tenant changelog auto-published**, AI-summarized edit history at /changelog.
60. **Per-site analytics** drop-in (Plausible / Fathom-style) without external accounts.
61. **Per-site newsletter** with double-opt-in via Resend.
62. **Per-site booking widget** embed — one-line script for any external host.
63. **Per-site donation widget** embed — same shape, 1.5% platform fee.
64. **Schema.org JSON-LD auto-tuned to org type** (LocalBusiness vs NGO vs SoftwareApp).
65. **Per-site sitemap with `lastmod` from D1 row timestamps** — always accurate.

## Billing & Payments (66–75)

66. **ACH push for crew payouts** — Stripe Connect instant-payout to bank, lower fee than card payout.
67. **Same-day Apple Pay payout** for crew via Stripe Express.
68. **Subscription pause** (1–3 months) with prorated billing.
69. **.edu auto-detected education discount** at checkout.
70. **TechSoup-verified nonprofit auto-discount** ($25/mo instead of $50/mo).
71. **Family plan** — 1 subscription, 3 sub-accounts at no extra cost.
72. **Receipt PDF generation in WASM** — server-free, runs client-side.
73. **80%-of-quota usage email alert** before overage hits.
74. **Customer-managed invoicing** for high-volume tenants — generate invoices to their own customers.
75. **Refund-in-credits option** — keeps money in the ecosystem instead of refunding to card.

## Per-Site Features — Logs / Snapshots / SQL / Integrations (76–82)

76. **Natural-language log search** — "500 errors in last hour" parses to SQL on the logs table.
77. **Snapshot diff with AI summary** — "this snapshot fixed the contact form and updated team photos."
78. **SQL AI assistant** — type intent, get SQL + execute.
79. **Integration health dashboard** with error rate + last-success per integration.
80. **Integration replay** — re-run last failed webhook with one click.
81. **Scheduled snapshots** — auto-snapshot weekly as a backup.
82. **SQL workbook saving + signed-link sharing** for collaboration.

## Mobile (83–89)

83. **Capacitor BackgroundGeolocation** for crew on-the-clock tracking.
84. **iOS Live Activity** for job ETA on lock screen (Dynamic Island integration).
85. **iOS / Android home-screen widget** — today's earnings (crew) or next booking (customer).
86. **Native biometric auth** (Face ID / Touch ID) on app open.
87. **Offline mode with IndexedDB queue + sync-on-reconnect** for crew in dead zones.
88. **Native share-sheet** for quotes via iOS/Android system share.
89. **Native Apple/Google Pay** (not just web sheets).

## Performance & Infrastructure (90–95)

90. **D1 multi-region read replicas via Sessions API bookmarks** — sub-100ms reads from any continent.
91. **Hyperdrive in front of external Postgres** for tenant analytics queries.
92. **R2 lifecycle: Standard → Infrequent Access** after 30 days for old snapshots.
93. **Workers Queues for background jobs** (snapshot generation, email, image processing).
94. **Speculation Rules per-route prerender** for likely-next navigation.
95. **Beasties critical-CSS extraction** per route — eliminates render-blocking CSS.

## Accessibility & Inclusive Design (96–100)

96. **AI-generated live captions on every embedded video** via Workers AI Whisper.
97. **Alt-text writer-assistant** — AI proposes alt text for every uploaded image.
98. **Color-blindness simulator** preview — deuteranopia / protanopia / tritanopia toggle.
99. **Cognitive load mode** — simpler language, fewer choices per screen, configurable per user.
100. **Font-size scaler** (90/100/110/125%) persistent per user across the SPA.

---

## Cross-references

- `BACKLOG.md` — phase-tracking board for the v2 doctrine build
- `BACKLOG_50_RESEARCHED.md` — fact-based reduction with citations (next step)
- `AUDIT.md` — Phase 0 inventory feeding which surfaces these improvements target
- `ARCHITECTURE.md` — system topology the ideas plug into
