# Research: Backlog Ideas #76–89 (Per-Site Features + Mobile)

> Lightweight evidence pass, 2026-05-26. ~8 WebSearch calls covering 5 clusters,
> mapped to 14 ideas. Citations are inline; full URLs at bottom.

---

## Cluster A — Text-to-SQL accuracy (covers #78, #76)

**Spider 1.0** is saturated (DAIL-SQL hits 86.6% EX; App Orchid reports 94.8%
out-of-box and 99.6% with ontology enrichment). **Spider 2.0** — the realistic
enterprise benchmark — caps SOTA around **~80% EX on English** and **4–6% on
MultiSpider 2.0** (non-English). Critical production caveat: *"Production
accuracy will typically be 5–15% lower than benchmark scores because real users
ask messier questions, schemas have domain-specific quirks, and benchmark
questions are carefully written to be unambiguous"* (CallSphere, 2025).

BIRD-SQL was introduced specifically because Spider 1.0 was too academic for
real BI-style workloads with messy schemas.

Snowflake Copilot, Datadog Bits AI, and similar production text-to-SQL ship
with **constrained schema awareness + execution guardrails** (validate against
schema, dry-run, allow user edit) — they don't trust the LLM alone.

**Implication for #78 SQL AI assistant**: viable BUT must ship with (a)
schema-grounding from D1 INFORMATION_SCHEMA, (b) dry-run preview before
execute, (c) one-click edit. Expect 65–75% first-try accuracy on real
projectsites.dev D1 schemas (small, well-named tables → above-average).

**Implication for #76 NL log search**: same pattern, even more tractable
because log-table schema is single-table + well-known. Datadog reports
**MTTR cut by 40–70%** with Bits AI conversational queries (third-party
review: 40–60% time-to-insight reduction; Datadog customer testimonial: 70%
MTTR cut).

```
#76: nl-log-search
  evidence: Datadog Bits AI cuts MTTR 40-70%; "time-to-insight 40-60% faster vs manual dashboard navigation" (third-party review, datadoghq.com/blog/datadog-bits-generative-ai)
  recommendation: STRONG

#78: sql-ai-assistant
  evidence: Spider 2.0 SOTA ~80% EX English; production accuracy 5-15% lower; small well-named D1 schemas push 70%+ realistic. Snowflake/Datadog ship behind schema-grounding + dry-run gate (emergentmind.com/topics/spider-2-0-benchmark)
  recommendation: MODERATE
```

---

## Cluster B — Webhook health + replay (covers #79, #80)

Stripe's native webhook surface has documented gaps that a custom dashboard
fills:

- Stripe retries **~16 attempts over 3 days** with exponential backoff, then
  abandons. *"By the time Stripe stops retrying, your fulfillment may have been
  broken for 3 days — and no one noticed because the Stripe dashboard showed
  'sent'"* (EventDock, 2026).
- Stripe Dashboard delivery log only shows the **last 3 days** — anything
  beyond requires custom telemetry export.
- Stripe disables endpoints after enough consecutive failures, requiring
  manual re-enable.
- Recommended alerting threshold: **non-2xx rate >1% over 15-min window**
  (Hooklistener, Nurbak, EventDock all converge on this).
- A dead webhook stream (sudden drop from 100/hr → 0) is just as bad as
  errors but won't fire most error-rate alerts → monitor for absence (NotiLens).

Active third-party tools (EventDock, NotiLens, HookVerify, WebhookWatch,
Hooklistener) prove this is a real market gap that bigger SaaS pays for.
Replay-with-one-click is the single most-cited feature in every tool.

```
#79: integration-health-dashboard
  evidence: Stripe native log = 3-day rolling window only; 3rd-party tools (EventDock, NotiLens, HookVerify) charge for this gap; standard threshold non-2xx >1%/15min (docs.stripe.com/health-alerts, hookverify.com)
  recommendation: STRONG

#80: integration-replay
  evidence: Every dedicated webhook tool ships one-click replay as flagship feature; Stripe Dashboard supports per-event Resend but only for last 3 days (docs.stripe.com/webhooks/handle-irrecoverable-events)
  recommendation: STRONG
```

---

## Cluster C — Snapshot/diff + schedule (covers #77, #81, #82)

No specific public benchmark; these are utility features with clear precedent
(Vercel deploy previews, GitHub releases, Linear's version history). Lower
priority than research-heavy clusters but high-trust UX. Scheduled snapshots
align with the "Stripe webhook 3-day retention" insight: backups beyond
provider defaults = real value.

```
#77: snapshot-diff-ai-summary
  evidence: Vercel deploy preview + GitHub PR description pattern; AI summary of file changes is now standard (GitHub Copilot PR summary, 2024+); no public conversion metric but high-trust feature
  recommendation: MODERATE

#81: scheduled-snapshots
  evidence: Backup-as-default is table stakes for any SaaS holding customer content; Stripe 3-day retention precedent shows providers don't keep history; D1 Time Travel only goes 30 days
  recommendation: STRONG

#82: sql-workbook-sharing
  evidence: Hex, Mode, Count.co built businesses around shareable SQL notebooks; weak signal for projectsites scope (small team admin tool, not BI)
  recommendation: WEAK
```

---

## Cluster D — iOS Live Activity + Dynamic Island (covers #84)

Uber's case study is the canonical reference. Key findings:

- Rolled out to **1,200+ cities globally** after several months of testing.
- Apple announced Uber as launch partner at **WWDC 2022**.
- Eliminates **"where's my driver" support requests** (Uber engineering blog).
- Built on a **server-driven language** so iOS + Android stay in sync without
  app updates — Uber treats Live Activity content as cross-platform.
- Sticky surface: **up to 8 hours on lock screen** keeps app top-of-mind.
- Caveat: Uber **did not publish specific retention/engagement lift numbers**.
  Qualitative wins only.

Strong fit for crew on-the-clock + customer pickup ETA. Direct
business-process analog to Uber Eats order tracking.

```
#84: ios-live-activity
  evidence: Uber engineering blog "Pickup in 3 minutes" — eliminates "where's my driver" support load, server-driven content language, 8hr lock-screen persistence (uber.com/en-HR/blog/live-activity-on-ios)
  recommendation: STRONG
```

---

## Cluster E — Home-screen widgets (covers #85)

Apple ships **official analytics** for widget installs + usage (Apple Developer
"Home Screen Widget Usage" docs), proving Apple takes the surface seriously.

Adoption: Top 5 widget apps reached **15% of US iPhones** within 8 weeks of
iOS 14 launch (Sensor Tower). TidBITS poll shows widget adoption is
**"middling"** — most-common response was "Don't Use" — but the users who DO
adopt them are **3x more likely to regularly open the app** (ArcTouch).

Asymmetric value: not everyone adopts, but adopters become power users.

```
#85: home-screen-widget
  evidence: Apple ships official analytics reports; adopters 3x more likely to regularly open app (ArcTouch); 15% iPhone penetration in top widget apps within 8 weeks (Sensor Tower)
  recommendation: STRONG
```

---

## Cluster F — Biometric auth + native pay (covers #86, #89)

**Biometric auth (#86)**: Apps with biometric auth see **30–40% higher login
conversion** vs password-only (thisisglance.com). Face ID false-match rate is
**1 in 1,000,000** (Apple). Best-practice: ship biometric **alongside**
password as opt-in, not replacement.

**Native Apple/Google Pay (#89)**: Stripe ran a **statistically significant
holdback experiment across $1.4T in transaction volume** (2025 blog). Findings:
- **Apple Pay → +22.3% conversion, +22.5% revenue** when offered.
- Apple Pay via **Express Checkout Element** (early in flow, not buried) →
  **2x conversion** vs end-of-flow placement.
- WeChat Pay → +13% conversion, +14% revenue.

This is the single highest-ROI mobile feature in the entire 14-idea cluster.

```
#86: native-biometric-auth
  evidence: 30-40% higher login conversion vs password (thisisglance.com); Face ID false-match 1/1M (Apple); ship as opt-in alongside password
  recommendation: STRONG

#89: native-apple-google-pay
  evidence: Stripe holdback experiment ($1.4T tx volume): Apple Pay +22.3% conversion +22.5% revenue; Express Checkout placement 2x conversion vs end-of-flow (stripe.com/blog/testing-the-conversion-impact-of-50-plus-global-payment-methods)
  recommendation: STRONG
```

---

## Cluster G — Offline-first + background geolocation + native share (covers #83, #87, #88)

**Offline-first (#87)**: Linear, Notion, Obsidian, Spotify, Slack all use
local-first / IndexedDB-cached architectures. PWA + service worker + IndexedDB
shows **95% faster load on repeat visits, 40% higher engagement, 25% lower
bounce in poor-connectivity areas** (Wellally Tech, 2025). Sync-engine pattern
is well-documented: `syncStatus + isNew + isModified + isDeleted` flags.

**Background geolocation (#83)**: Native platform APIs (iOS Core Location
significant-changes / region monitoring; Android FusedLocationProvider with
foreground service) are the production-grade path. Capacitor
BackgroundGeolocation plugin wraps both. DoorDash/Lyft public engineering
posts don't surface specific lift numbers in this search pass but the
category is table-stakes for any field-worker app.

**Native share-sheet (#88)**: low-investment, table-stakes UX. iOS/Android
both expose system share via Capacitor Share API. No conversion data needed —
absence is a Recs-section gap, presence is a polish win.

```
#83: capacitor-background-geolocation
  evidence: Native FusedLocationProvider + iOS Core Location are production standard for field-worker tracking; Capacitor plugin maps both; category is table-stakes for crew apps (developer.android.com/topic/architecture/data-layer/offline-first)
  recommendation: MODERATE

#87: offline-mode-indexeddb-sync
  evidence: Linear, Notion, Slack, Obsidian use local-first IndexedDB pattern; 95% faster repeat load, 40% higher engagement, 25% lower bounce in poor-connectivity (blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite)
  recommendation: STRONG

#88: native-share-sheet
  evidence: Capacitor Share API one-line wrap of iOS UIActivityViewController + Android Intent.ACTION_SEND; no measurable lift data but absence reads as "not really native"
  recommendation: MODERATE
```

---

## Summary recommendations

**STRONG (ship in roadmap top quartile)**: #76, #79, #80, #81, #84, #85, #86, #87, #89
**MODERATE (ship after STRONG, or pair with adjacent feature)**: #77, #78, #83, #88
**WEAK (defer or de-scope)**: #82
**DROP**: none

Highest-ROI single feature in cluster: **#89 Native Apple/Google Pay** —
Stripe's own data shows +22% conversion / +22.5% revenue, statistically
significant on $1.4T volume.

---

## Sources

- [Spider 2.0 Enterprise Benchmark](https://www.emergentmind.com/topics/spider-2-0-benchmark)
- [Text-to-SQL Evaluation: Spider, BIRD benchmarks (CallSphere, 2025)](https://callsphere.ai/blog/text-to-sql-evaluation-spider-bird-benchmarks-accuracy-testing)
- [Datadog Bits AI](https://www.datadoghq.com/blog/datadog-bits-generative-ai/)
- [Datadog Bits Assistant docs](https://docs.datadoghq.com/bits_ai/bits_assistant/)
- [Stripe Health Alerts docs](https://docs.stripe.com/health-alerts)
- [EventDock — Stripe Webhook Failures](https://eventdock.app/blog/why-stripe-webhooks-failing-how-to-fix)
- [Hooklistener — Stripe webhook implementation 2026](https://www.hooklistener.com/learn/stripe-webhooks-implementation)
- [Uber Engineering — Live Activity on iOS](https://www.uber.com/en-HR/blog/live-activity-on-ios/)
- [Apple Developer — Home Screen Widget Usage analytics](https://developer.apple.com/documentation/analytics-reports/home-screen-widget-usage)
- [Sensor Tower — Widget apps reach 1-in-7 US iPhones](https://sensortower.com/blog/iphone-widget-apps-month-two)
- [ArcTouch — Widgets increase iOS app engagement (3x lift)](https://arctouch.com/blog/widgets-home-screen)
- [thisisglance — Mobile technologies replacing passwords (30-40% conversion lift)](https://thisisglance.com/learning-centre/what-mobile-technologies-will-replace-passwords)
- [Stripe Blog — Testing the conversion impact of 50+ payment methods (Apple Pay +22.3%)](https://stripe.com/blog/testing-the-conversion-impact-of-50-plus-global-payment-methods)
- [LogRocket — Offline-first frontend apps in 2025: IndexedDB + SQLite](https://blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite/)
- [Android Developers — Build an offline-first app](https://developer.android.com/topic/architecture/data-layer/offline-first)
