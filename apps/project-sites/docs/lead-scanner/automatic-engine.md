# Lead Scanner — Automatic US "Businesses Without Websites" Engine

> Turn the broken (always-0) Lead Scanner into an automatic, US-wide database of
> businesses without a real website, scored by likelihood-to-pay, with contact
> confidence for email + mailing address, an editable scan-prompt controller, and
> a claim funnel. **Lead store = Twenty CRM at `crm.projectsites.dev`** (not a
> bespoke D1 table) — the CRM owns the management table + pipeline UI.

Status: scoring core + CRM sink shipped (2026-06-28). Orchestrator, enrichment,
scan-profile UI, claim funnel, Lob postcards = build-ready ledger items below.

---

## 1. Why it returns 0 today

- The scan is **manual + single-query**: `POST /api/admin/leads/scan { query }` does ONE Google Places text search, behind the default-OFF `lead_scanner` flag → 404 / nothing unless an operator runs it.
- **No automatic geography loop** (no zip/city × category sweep).
- **No contact enrichment**: Places text search returns no email and no website field on the hit (`hitToResult` nulls them), and SoS records carry no contacts at all — so "businesses without websites with an email or address" was never actually assembled.
- **No pay-propensity ranking** and **no editable scan prompts**.

## 2. Target architecture (automatic → Twenty CRM)

```
 scan profiles (editable)            providers (pluggable)            enrichment
 ┌────────────────────┐   geo×cat   ┌──────────────────────┐   no-site  ┌───────────────┐
 │ verbiage, geo set, │──jobs──────▶│ Google Places (prime)│──filter──▶ │ email finder  │
 │ category set,      │  (Queue/    │ OSM Overpass (free)  │  hasWebsite│ MX verify     │
 │ filters (e.g.      │  Workflow + │ Yelp / YellowPages   │  =false    │ USPS verify   │
 │ "incorporated<6mo")│  cron)      │ SoS new-filings (OH…)│            │ address conf  │
 └────────────────────┘             └──────────────────────┘            └──────┬────────┘
                                                                                │
            ┌───────────────────────────────────────────────────────────────────┘
            ▼
   score: contactConfidence() + payPropensity() + rankLeads()   ← SHIPPED (lead_propensity.ts)
            ▼
   sink: leadToCrmCompany() → upsertLeadToCrm()  → Twenty CRM    ← SHIPPED (crm_leads.ts, AGPL HTTP boundary)
   (crm.projectsites.dev = management table + Kanban pipeline + dedupe)
            ▼
   outreach: email (Resend/SES) → claimyour.site/<slug>  |  Lob postcard (address-confident)
            ▼
   claim funnel: claimyour.site/<slug> → triggers build → "we'll email you" → explore /admin
                 → [Cancel build → /create (2-min)]   |   preview ready → keep or leave
```

- **/admin Lead Scanner = the CONTROLLER** (run/monitor scans, edit scan profiles). The **lead database + management lives in Twenty CRM** — we don't rebuild a heavy table.
- **AGPL**: Twenty is AGPL → HTTP boundary only (`crm_leads.ts`), local types, env coords `TWENTY_API_URL`/`TWENTY_API_KEY`. No SDK, no shared schema.

## 3. Data sources (researched 2026-06-28)

- **~27% of US small businesses have no website** (defensible range one-quarter→one-third; declining ~36%→27% 2020→2026). The pool is millions.
- **Google Places** — prime signal: empty `website` field. ~120 results/query, ~$32-40/1k, **no email/social**. Route via AI Gateway + cache.
- **OpenStreetMap (Overpass)** — free POI data with a `website` tag; absence = candidate. Zero API cost — run first, Places to confirm.
- **Yelp / YellowPages / Nextdoor / Angi** — cross-reference + categories; "website empty or points to Facebook" = lead.
- **Secretary of State new filings** — recently-incorporated = highest intent. Ohio free monthly bulk; CA $100 bulk; many paid/none. **No contacts → must enrich.**
- **Cross-source corroboration** raises confidence + filters stale records (a Jan list is ~20% bad by June).
- **Enrichment**: phone from listing; **email** via pattern + MX verify (DoH) + verified-source bump; **address** via listing→Places→SoS→USPS-verify (USPS verification gates Lob postcard spend).

## 4. Scoring model (SHIPPED — `services/lead_propensity.ts`)

- `contactConfidence(signals)` → `{ emailConfidence 0-100, addressConfidence 0-100, channel }`. Email by provenance (verified 95 / listing 75 / guessed-MX 45 / guessed 25); address (USPS 95 / SoS 80 / Places 70 / listing 55). Channel: email ≥50, postcard ≥60 (Lob spend gate), both, or none.
- `payPropensity(signals)` → `{ score 0-100, tier A–D, reachable }`. No-website +35 · claimed-listing-but-siteless +15 · reachable +12 · high-value category +10 · recency (<6mo +10 / <12 +5) · reviews (+6/+10) · rating≥4 +5 · social-only +5 · corroborated +5. Has-website ⇒ 0.
- `rankLeads(batch)` → most-likely-to-pay first (score → reachable → contact confidence).

## 5. Editable scan-prompt controller

A `scan_profiles` config (D1 or CRM custom object) the operator edits in /admin — **the "change the verbiage" widget**:

- `name`, `enabled`, `schedule` (cron-ish), `geo` (zip list / state / "all US"), `categories[]`, `providers[]`, `filters` (free-text → e.g. "incorporated in the last 6 months", "rating ≥ 4", "≥10 reviews"), `query_template` (the editable verbiage), `daily_cap` (cost guard).
- The orchestrator reads enabled profiles, fans geo×category jobs through Queue/Workflow, respects `daily_cap`, and writes results to the CRM. Editing a profile's verbiage changes what the scanner hunts — no redeploy.

## 6. Claim funnel (`claimyour.site/<business-slug>`)

- Outreach email/postcard links to `https://claimyour.site/<slug>` (or `projectsites.dev/claim/<token>`). Landing **triggers the build** and says: "We're building your site — we'll email you when it's ready to preview. Meanwhile, explore your dashboard."
- A prominent **"Cancel build & start fresh → /create (2 min)"** button.
- When the preview is ready → email → owner decides keep (claim→pay) or leave. Ties into `upgrade_moments` for the paid power-ups.

---

## The 50 brilliant ideas

### A. Discovery & data (1–12)
1. **OSM-first, Places-confirm** — sweep free Overpass for siteless POIs, spend Places budget only to confirm. Slashes cost.
2. **SoS new-filings firehose** — daily pull of <6-month incorporations (OH free; aggregator for NY/FL/CO/CT) = highest-intent leads.
3. **Negative-domain check** — `"{name}" "{city}" -site:*.com` style verification that a business truly has no real site (filters Facebook-only).
4. **Facebook/IG-only detector** — "social but no site" is a hotter lead than no-presence-at-all; tag `socialOnly`.
5. **Stale-listing decay** — re-verify leads every 90 days; auto-archive closed/changed (20%/6mo rot).
6. **License-board cross-ref** — contractor/dentist/salon boards add owner names + confirm "still operating".
7. **Chamber-of-commerce scrape** — local chambers list siteless members with contacts.
8. **Zip-by-zip coverage map** — track which of ~41k US ZIPs are scanned + when; never re-burn budget.
9. **Category value tiers** — prioritize high-LTV trades (HVAC, roofing, dental, legal) over low-margin.
10. **"Just moved/new phone" change-detection** — businesses updating listings are in change-mode = receptive.
11. **Competitor-cluster scan** — find a siteless business whose 3 nearest competitors all have sites (FOMO angle).
12. **Multi-source merge + dedupe** — one canonical company across Places+OSM+Yelp+SoS; `sourceCount` drives confidence.

### B. Scoring & prioritization (13–22)
13. **Pay-propensity score (SHIPPED)** — 0-100 + A–D tier, most-likely-to-pay first.
14. **Contact confidence (SHIPPED)** — email + address %, channel decision (email/postcard/both/none).
15. **Revenue-estimate weighting** — reviews × category avg ticket ≈ ability to pay $X/mo.
16. **Seasonality booster** — landscapers in spring, accountants pre-tax-season, retail pre-holiday.
17. **Urgency signals** — recently incorporated + high reviews + no site = "leaving money on the table now".
18. **Reachability-first sort** — never surface a lead we can't contact above one we can.
19. **Spend-aware ranking** — prefer email-reachable (free) over postcard-only (costs) at equal score.
20. **Lookalike scoring** — train propensity weights on which tiers actually converted (feedback loop).
21. **Local-competition density** — more competitors-with-sites nearby ⇒ stronger pitch ⇒ higher score.
22. **Disqualifier rules** — drop chains/franchises (corporate site exists), government, defunct.

### C. Enrichment (23–30)
23. **Email pattern + MX verify** — guess `info@`/`owner@` from domainless name → DoH MX check → confidence bump.
24. **USPS address verification** — verify deliverability before any Lob spend; bad address ⇒ email-only.
25. **Owner-name extraction** — from SoS registered agent / license board for personalized outreach.
26. **Phone → carrier/line-type** — mobile vs landline informs SMS vs call (future channel).
27. **Logo/brand pre-fetch** — Logo.dev/Brandfetch so the claim page shows THEIR brand instantly.
28. **Pre-built preview teaser** — generate a thumbnail of the future site to embed in the email (huge CTR).
29. **Review-sentiment snippet** — pull a glowing review to quote back ("your customers love you — show it off").
30. **Hours/category autofill** — carry Places data into the build draft so the claim build is 80% done.

### D. Outreach & conversion (31–40)
31. **Channel router** — email when confident, Lob postcard when only address is sure, both for A-tier.
32. **claimyour.site/<slug> deep link (SHIPPED concept)** — one click triggers the build + "we'll email you".
33. **Cancel-build → /create escape hatch** — never trap; 2-minute self-serve path.
34. **Postcard with a QR → claim link** — physical → digital bridge for no-email leads.
35. **A/B outreach copy** — sharp/professional vs warm, subject-line tests, per-tier.
36. **Drip sequence** — email 1 (preview ready) → 3-day nudge → postcard → final. Stop on claim.
37. **"Your competitor just launched"** — social-proof outreach using the competitor-cluster signal.
38. **Personalized video/Veo teaser** — 8-sec AI flythrough of their future site.
39. **Local-stat hook** — "X% of {city} {category} now have sites" — FOMO with real data.
40. **Reply-handling via CRM inbox** — responses land in Twenty; AI drafts the reply.

### E. CRM, automation & ops (41–50)
41. **Twenty CRM as lead store (SHIPPED sink)** — companies + custom fields + Kanban pipeline; no bespoke table.
42. **CRM pipeline stages** — Discovered → Enriched → Contacted → Build-triggered → Preview-sent → Claimed/Lost.
43. **Editable scan profiles** — operator changes the hunt verbiage (e.g. "<6-month incorporations") with no redeploy.
44. **Daily cost guard** — per-profile `daily_cap` + AI-Gateway caching so a runaway scan can't blow budget.
45. **Coverage + funnel dashboard** — ZIPs scanned, leads/tier, contact-rate, build-triggered, claimed, $ pipeline.
46. **Auto-suppression list** — never re-contact claimed/opted-out/bounced (CAN-SPAM + reputation).
47. **Dedupe on external_id** — Places place_id / SoS filing id as the CRM unique key.
48. **Webhook on claim** — CRM stage auto-advances when claimyour.site fires the build.
49. **Per-state legal config** — respect scraping ToS, CAN-SPAM unsubscribe, state DNC; postcard is always compliant.
50. **Self-tuning loop** — feed claimed/lost outcomes back into propensity weights monthly (eval-tracked).

## Top 14 (build order)

1. **Twenty CRM lead sink** — leads → `crm.projectsites.dev`, AGPL HTTP boundary. ✅ SHIPPED (`crm_leads.ts`).
2. **Pay-propensity + contact-confidence scoring** — sort + email/address %. ✅ SHIPPED (`lead_propensity.ts`).
3. **Automatic geo×category orchestrator** — zip/state × category sweep via Queue/Workflow + cron, `daily_cap` guard.
4. **OSM-first, Places-confirm** provider chain — free discovery, paid confirmation.
5. **Editable scan profiles** + /admin controller — change the hunt verbiage with no redeploy.
6. **Email enrichment** — pattern + DoH MX verify → emailConfidence.
7. **USPS address verification** — gate Lob postcard spend → addressConfidence.
8. **claimyour.site/<slug> claim funnel** — trigger build + "we'll email you" + Cancel→/create.
9. **Pre-built preview teaser** in outreach — thumbnail/teaser of their future site (CTR lever).
10. **CRM pipeline stages + claim webhook** — auto-advance Discovered→…→Claimed.
11. **SoS new-filings provider** — <6-month incorporations (highest intent).
12. **Channel router + drip** — email/postcard/both + stop-on-claim sequence.
13. **Coverage + funnel dashboard** — ZIPs scanned, tiers, contact-rate, $ pipeline.
14. **Auto-suppression + compliance** — CAN-SPAM/DNC/opt-out + dedupe.

---

## Sources
- [Clutch — State of Small Business Websites 2025](https://clutch.co/resources/state-of-small-business-websites-2025)
- [B2BLeadFinder — businesses without a website statistics](https://b2bleadfinder.io/blog/small-business-without-website-statistics)
- [Outscraper — scrape Google Maps businesses without websites](https://outscraper.com/google-maps-scrape-businesses-without-websites/)
- [B2BLeadFinder — how to find businesses without websites](https://b2bleadfinder.io/blog/how-to-find-businesses-without-websites)
- [Apify — US business entity filings (new LLC/Corp)](https://apify.com/paxiq/us-biz-filings-scraper)
- [Ohio SoS — free business reports / bulk new filings](https://www.ohiosos.gov/business/business-reports)
