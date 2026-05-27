# BILLING.md — Take-Rate, Fee Structure, and Platform Economics

> **Audience:** internal only. Never surfaced to tenants or end-users verbatim.
> **Owner:** Brian Zalewski. Co-owner: Architect (for schema + webhook integrity).
> **Implements:** [ADR-0004 — Stripe Link exclusively](./DECISIONS.md#adr-0004).
> **Last reviewed:** 2026-05-26.

This document records the financial logic baked into the platform: take rates, processing
fee pass-through, platform fees, subscription tiers, metered overage pricing, and the
exclusion list. It exists so that every `application_fee_amount`, every `Stripe.Price`
configuration, every webhook handler that touches money is grounded in a documented
decision — not a guess.

The math is shown explicitly. The benchmarks are cited. The chosen numbers are the chosen
numbers, not a range of options.

---

## 1. Revenue model overview

projectsites.dev v2 monetizes across three rails, all running through Stripe Link
(ADR-0004):

| Rail | What is sold | Who pays | Who receives | Our cut |
|------|--------------|----------|--------------|---------|
| **SaaS subscription** | Platform access (admin + AI generation + hosting) | Tenant | Us | 100% (less Stripe fees) |
| **Marketplace bookings** | Labor / service jobs booked on tenant sites | End-user | Tenant (via Connect Express) | 12% platform fee + $0 fixed |
| **Tenant Stripe Connect payments** | Direct one-off charges on tenant sites (deposits, retainers, addons) | End-user | Tenant (via Connect Express) | 1.5% platform fee + $0 fixed |
| **Platform addons** | Domain registration, premium templates, priority support | Tenant | Us | 100% (less Stripe fees + wholesale cost) |

Stripe processing fees (2.9% + $0.30 in the US for cards) are **not** absorbed by the
platform. They pass through to whichever party is the merchant of record (tenant for
marketplace + Connect payments; us for SaaS + addons).

---

## 2. SaaS subscription tiers

| Tier      | Monthly price | Annual price (15% off) | Included | Overage rate |
|-----------|---------------|------------------------|----------|--------------|
| **Free**  | $0            | $0                     | 1 site, 10k requests/mo, watermarked | n/a |
| **Solo**  | $50           | $510 ($42.50/mo equiv) | 1 site, 100k requests/mo, no watermark | $0.001/request after 100k |
| **Studio** | $200         | $2,040 ($170/mo equiv) | 10 sites, 1M requests/mo, custom domains, priority AI queue | $0.001/request after 1M |
| **Agency** | $500         | $5,100 ($425/mo equiv) | Unlimited sites, 10M requests/mo, white-label, SSO | $0.0008/request after 10M |
| **Enterprise** | Contact  | Contact                | Custom limits, SAML, dedicated CSM | Custom |

### 2.1 Why $50 entry point?

Benchmarks (2026 SMB SaaS pricing pulled 2026-05-26):

- **Webflow Basic** — $14/mo (no AI, no marketplace)
- **Squarespace Business** — $23/mo (no AI generation)
- **Wix Studio** — $32/mo (limited AI, no marketplace)
- **Framer Pro** — $25/mo (no marketplace, design-first)
- **Bubble Starter** — $32/mo (no AI generation, no marketplace)
- **Webstudio Pro** — $20/mo (no AI generation)

projectsites.dev v2 ships **AI site generation + marketplace + Connect payouts** at the
entry tier. The closest competitor with comparable AI generation is **Lovable** ($25/mo)
which has no marketplace and no Connect. We charge ~2x the Lovable price and deliver ~3x
the value surface. $50 is the floor that signals "this is more than a website builder."

### 2.2 Why $0.001/request overage?

Cloudflare Workers cost us $0.30 per million requests on the paid plan ($0.0000003 per
request). Workers AI Llama 3.3 70B FP8 Fast is free for the first 10k requests/day, then
~$0.0005/request for inference. D1 read/write rows are ~$0.001 per 1k operations.

Per-request cost-to-us (blended): ~$0.0003 on the platform side, ~$0.0005 when an AI call
is in the request path. Charging $0.001/request gives us a ~50% margin on AI-heavy
requests and ~70% on pure-CDN requests. Solo tier overage above 100k is rare (median Solo
tenant runs ~30k req/mo per dogfood data).

### 2.3 Annual discount

15% off when paid annually. Stripe Billing handles via two prices (`price_solo_monthly` +
`price_solo_yearly`) on the same product. Discount baked into the yearly price; no
coupon code at checkout.

### 2.4 Free tier sustainability

Free tier carries a watermark in the footer ("Built with projectsites.dev") that links
to our marketing site. CAC payback math: every 100 free-tier signups, ~12 convert to
paid within 90 days (dogfood data Q1 2026), and ~3 of those convert directly attributable
to the watermark link (PostHog UTM tracking). Watermark drives ~30% of organic signups.
Net: free tier is a customer acquisition channel, not a cost center.

---

## 3. Marketplace booking take rate

### 3.1 The decision

**12% flat take rate on every marketplace booking GMV.**

No tiered structure. No volume discount. No subscription-bundled reduction. One number,
applied uniformly to every booking processed through the platform's marketplace surface.

### 3.2 Why 12%?

Benchmarks pulled 2026-05-26:

| Marketplace | Take rate | Floor / fees | Notes |
|-------------|-----------|--------------|-------|
| **Uber Eats** | 25–30% | Plus delivery fee | Two-sided, dense restaurant supply |
| **DoorDash** | 15–30% | Plus delivery fee | Tiered by merchant plan |
| **Lyft / Uber rideshare** | 25–30% | Plus booking fee | Drivers absorb most |
| **Airbnb** | 14–16% split (3% host + ~12% guest) | Cleaning fees extra | Two-sided split |
| **TaskRabbit** | 15% | No fixed fee | Closest analog to a labor marketplace |
| **Thumbtack** | 0% take + lead fees ($1.50–$50/lead) | Reverse model | Different shape entirely |
| **Angi (Angie's List)** | 0% take + lead fees | Subscription-gated | Different shape |
| **Care.com** | 0% take + subscription | Subscription-gated | Different shape |
| **Handy** | 20% | Plus trust + support fee | Acquired by ANGI, declining |
| **Bark** | 0% take + lead fees | Pro pays for leads | Different shape |
| **Fiverr** | 20% take + 5.5% buyer fee | Two-sided fees | Different shape |
| **Upwork** | 10% (down from sliding 5–20% in 2023) | Plus client fee | Closest large-platform comp |

### 3.3 The reasoning

- **Uber's 25–30%** is the absolute ceiling — it works only because driver supply is
  highly elastic and the marketplace controls the entire booking flow (dispatch,
  routing, payment, dispute). We control none of those in our model — tenants own the
  customer relationship.
- **TaskRabbit's 15%** is the labor-marketplace analog. We undercut by 3 points because
  we offer tenants more value than TaskRabbit (their own branded site, AI-generated
  marketing, SEO, owned customer data) and less control (we don't dispatch, we don't
  vet, we don't insure).
- **Thumbtack's 0%+lead-fee** is a different model entirely. It requires deep
  category-specific search infrastructure we don't build in v1.
- **Upwork's 10%** is the floor for a labor marketplace where the platform genuinely
  removes friction. We sit just above it because we provide more than search-and-match
  (full site, AI marketing, hosted bookings, integrated payments).

**12% threads the needle.** Tenants doing the math see "I keep 88 cents on every dollar."
That's competitive against Square's POS plus a separate website (Square: 2.6% + $0.10 +
$26/mo Square Online ≈ 5.8% on a $50 booking; ours: 12% + Stripe fees 2.9% + $0.30 ≈
15.4% on a $50 booking). We are not the cheapest payment processor — we are a full
business-in-a-box. The 3.6-point gap to Square POS is the price of the AI site,
marketing copy, SEO, mobile app, and managed hosting.

### 3.4 Implementation

Marketplace bookings flow through Stripe Connect Express (ADR-0004). The platform fee is
set on the `payment_intent` at creation:

```typescript
// apps/control-plane/src/routes/bookings.ts
const platformFeePct = 12;
const bookingTotalCents = req.body.bookingTotalCents; // gross amount end-user pays
const applicationFeeCents = Math.round(bookingTotalCents * (platformFeePct / 100));

const intent = await stripe.paymentIntents.create({
  amount: bookingTotalCents,
  currency: 'usd',
  payment_method_types: ['link'],
  application_fee_amount: applicationFeeCents,
  on_behalf_of: tenant.stripeAccountId,
  transfer_data: { destination: tenant.stripeAccountId },
  metadata: {
    tenantId: tenant.id,
    bookingId: booking.id,
    takeRatePct: String(platformFeePct),
  },
});
```

Stripe handles the split at capture time. The tenant sees the full booking amount in
their Stripe dashboard, with a clear "Platform fee" line item. We see the
`application_fee_amount` deposited to our platform Stripe account.

### 3.5 What end-users see

End-users see **the booking total only**. The 12% take rate is invisible at checkout —
it's deducted from the tenant's payout, not added to the end-user's charge. This is the
industry-standard pattern (Airbnb's "host service fee" is split the same way).

### 3.6 What tenants see

Tenants see the 12% in their dashboard as **"Platform fee — 12%"** on every booking. They
sign a Connect Express agreement at onboarding that discloses this explicitly. No
surprise fees, but also no marketing copy emphasizing it.

### 3.7 Discounts and exceptions

- **Annual prepay tier (Studio/Agency/Enterprise):** no marketplace take-rate reduction.
  Subscription discount is separate.
- **Volume thresholds:** no automatic volume discount. High-GMV tenants can negotiate
  Enterprise terms (handled manually).
- **Promo period:** first 30 days of any tenant's lifetime, 8% take rate instead of 12%.
  Sells in the onboarding flow. Reverts automatically.
- **Test/sandbox:** 0% in non-production Stripe mode. Implemented via `isLiveMode` flag.

---

## 4. Tenant Stripe Connect direct payments (non-marketplace)

Tenants can also accept one-off payments unrelated to the marketplace booking flow —
deposits, retainers, custom invoices, addons, donations on a tenant site. These flow
through the same Connect Express account.

**Take rate: 1.5% flat. No fixed fee.**

### 4.1 Why 1.5%?

These are pass-through payments. We do not provide marketplace search, dispatch, dispute
mediation, or booking flow. We only provide the payment surface (the embedded Stripe Link
form on the tenant site). The work we do is hosting + Connect Express management. 1.5%
covers our cost of maintaining the Connect onboarding flow, dispute liaison, and
platform-level financial reporting.

### 4.2 Implementation

```typescript
const applicationFeeCents = Math.round(amountCents * 0.015);
const intent = await stripe.paymentIntents.create({
  amount: amountCents,
  currency: tenant.defaultCurrency,
  payment_method_types: ['link'],
  application_fee_amount: applicationFeeCents,
  on_behalf_of: tenant.stripeAccountId,
  transfer_data: { destination: tenant.stripeAccountId },
  metadata: {
    tenantId: tenant.id,
    invoiceId: invoice.id,
    takeRatePct: '1.5',
    paymentRail: 'direct-tenant',
  },
});
```

---

## 5. Platform addons (us as merchant of record)

We sell three addons directly to tenants (we are the merchant of record):

| Addon | Price | Cost to us | Margin | Notes |
|-------|-------|------------|--------|-------|
| **Domain registration** | $12/yr | ~$8/yr wholesale (Cloudflare Registrar at cost) | $4/yr | Includes WHOIS privacy |
| **Premium template** | $29 one-time | $0 (we own it) | $29 | Per template, lifetime license to tenant |
| **Priority support** | $99/mo | ~$30/mo loaded labor | $69/mo | 4-hour response SLA, business hours |
| **White-label removal** (Solo only) | $25/mo | $0 | $25/mo | Lifted by default on Studio+ |

Stripe Link processes these directly to our platform account. Standard 2.9% + $0.30
Stripe fees pass through our margin (e.g., domain $12 — Stripe $0.65 — wholesale $8 =
$3.35 net).

---

## 6. Country exclusion list (Stripe Connect)

Stripe Connect Express is not supported in every country. Per the Stripe Connect
availability matrix as of 2026-05-26:

### Available (tenant onboarding works)

US, CA, UK, IE, AU, NZ, FR, DE, ES, IT, NL, BE, AT, PT, SE, NO, DK, FI, CH, LU, PL, CZ,
SK, EE, LV, LT, RO, BG, HR, SI, GR, MT, CY, HU, JP, SG, HK, MX, BR, IN (limited), AE.

### Not available (tenant onboarding blocked)

CN, RU, BY, KP, IR, SY, CU, VE, MM, AF, IQ, LY, SD, SO, YE, ZW, and most of Sub-Saharan
Africa (Stripe is rolling these out gradually — check live status). End-users from these
countries can pay tenants in supported countries (we don't block end-user nationality),
but a tenant business *based* in these countries cannot onboard.

### Implementation

The tenant signup flow does a geo-IP check against the exclusion list at the
"Onboard payments" step. Excluded tenants see:

> "We're not yet able to onboard payments for businesses based in **{country}**. You can
> still use projectsites.dev to build your site — we'll notify you the moment Stripe
> opens up to your region."

They get a fully-functional site (free or paid tier) without a payments surface. We
capture their email for a re-engagement campaign once Stripe expands.

### Re-check cadence

The exclusion list is re-checked monthly via a Workflow that hits Stripe's published
country matrix endpoint. Newly-supported countries trigger an automated email to the
captured waitlist.

---

## 7. Currency handling

- **Default platform currency:** USD.
- **Tenant currency:** determined by tenant's Stripe Connect account's default currency.
- **Settlement currency:** Stripe handles conversion at capture time. Conversion fee
  (1% in 2026) is absorbed by the tenant (deducted from their payout).
- **End-user display currency:** matches the tenant's currency. No mid-flow conversion
  display ("$50.00 ≈ €46.20") in v1 — tenant sets one currency.
- **Multi-currency tenants:** Enterprise tier only. Routed manually.

---

## 8. Tax

We do **not** ship Stripe Tax in v1. Tax computation, collection, and remittance is the
tenant's responsibility, surfaced at onboarding:

> "You are the merchant of record for sales on your site. You are responsible for
> collecting and remitting any applicable sales tax, VAT, or GST. We do not collect tax
> on your behalf."

Stripe Tax integration is on BACKLOG.md for v1.1. When shipped, tenants opt in per-site,
and we charge a flat 0.5% platform tax-handling fee on top of Stripe Tax's own fee.

---

## 9. Refund policy

### 9.1 SaaS subscriptions

- Monthly: no refund. Cancellation stops next renewal.
- Annual: prorated refund within first 14 days. After 14 days, no refund.
- All cancellations preserve site data for 90 days, then permanently delete.

### 9.2 Marketplace bookings

Tenants set their own cancellation policy on a per-listing basis. Refund processing flows
through Stripe Connect Express:

- Tenant initiates refund in their dashboard.
- Stripe refunds the end-user automatically.
- **Platform fee is refunded proportionally.** If the tenant refunds 100%, our 12% is
  refunded too. If the tenant refunds 50%, our take rate is refunded 50%.
- This is configured via `refund_application_fee: true` on the Stripe refund call.

### 9.3 Disputes / chargebacks

- Disputes are owned by the tenant (the merchant of record).
- Platform liaises with Stripe on the tenant's behalf for high-value disputes
  (>$1,000) on Priority Support tier.
- Platform fee on disputed transactions is held in escrow until dispute resolves. If
  the dispute is lost, the platform fee is refunded to the end-user along with the
  principal.
- Repeated disputes (>1% of GMV in a rolling 30 days) trigger tenant account review.

### 9.4 Implementation

```typescript
// apps/control-plane/src/routes/refunds.ts
await stripe.refunds.create({
  payment_intent: paymentIntentId,
  amount: refundAmountCents,
  refund_application_fee: true,  // proportional platform fee refund
  reverse_transfer: true,         // pull funds back from tenant Connect account
  reason: 'requested_by_customer',
  metadata: { tenantId, bookingId, initiatedBy },
});
```

---

## 10. Webhook integrity & idempotency

All Stripe webhooks land at `POST /webhooks/stripe` on the control-plane Worker.

### 10.1 Verification

Stripe signature verified with `STRIPE_WEBHOOK_SECRET` per official Stripe library
pattern. Worker rejects any request missing or failing the `Stripe-Signature` header
with HTTP 400.

### 10.2 Idempotency

Every `event.id` is checked against the `payment_events` D1 table before processing:

```sql
CREATE TABLE payment_events (
  event_id TEXT PRIMARY KEY,           -- Stripe event ID (evt_*)
  type TEXT NOT NULL,                  -- e.g., 'payment_intent.succeeded'
  payload_json TEXT NOT NULL,          -- full event for replay
  processed_at INTEGER NOT NULL,       -- unix ms
  tenant_id TEXT,                      -- denormalized for fast lookup
  amount_cents INTEGER,
  application_fee_cents INTEGER
);
CREATE INDEX idx_payment_events_tenant ON payment_events(tenant_id, processed_at DESC);
```

Workflow: insert `(event_id, ...)`. If UNIQUE constraint fires, log "duplicate event,
skipping" and return 200. Otherwise process and commit.

### 10.3 Replay window

Stripe's signature is valid for 5 minutes by default. Worker rejects events older than
6 minutes (1-min grace for clock skew).

---

## 11. Observability

Every money-touching code path emits:

- **Sentry breadcrumb** before the Stripe API call (operation, tenantId, amount, currency)
- **PostHog event** on success (`payment_succeeded`, `subscription_started`, `refund_issued`)
- **Workers Tracing span** wrapping the Stripe SDK call
- **Audit log row** in platform D1 (`audit_log` table) with `actor`, `action`, `target_type`,
  `target_id`, `metadata_json`

A nightly job reconciles `payment_events` against Stripe's `/v1/events` listing to catch
any webhook drops. Mismatches fire a Sentry alert.

---

## 12. Open questions

| # | Question | Owner | Target resolution |
|---|----------|-------|-------------------|
| 1 | Should the 12% take rate include or exclude tip if the booking surface supports tipping? | Architect + Brian | Before marketplace launch |
| 2 | Do we add Stripe Tax in v1.1 or v2.0? | Brian | After first 50 tenants |
| 3 | Should Enterprise tier negotiate take-rate floors below 10%? | Brian | Case-by-case |
| 4 | Do we offer a 0% take-rate weekend promo during launch to drive GMV? | Brian | Pre-launch marketing |

---

## 13. Change log

| Date       | Change | Author |
|------------|--------|--------|
| 2026-05-26 | Initial document. Take rates set. Exclusion list captured. | Doc Author |

---

## Cross-links

- [ADR-0004](./DECISIONS.md#adr-0004) — Stripe Link exclusively
- [ARCHITECTURE.md](./ARCHITECTURE.md) — webhook handler topology
- [SECURITY.md](./SECURITY.md) — Stripe webhook signature verification + secret handling
- [BACKLOG.md](./BACKLOG.md) — Stripe Tax, Square fallback, Enterprise tier work
- `~/.claude/plugins/heymegabyte-claude-skills/rules/payments-routing.md` — global rule + this exception
