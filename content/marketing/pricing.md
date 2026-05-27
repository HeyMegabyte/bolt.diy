---
title: "Pricing — Project Sites"
dek: "Start at fifty a month. Scale with usage. No surprises and no migration tax."
date: 2026-05-26
tags: [pricing, plans, billing, saas]
hero: /r2/marketing/pricing-hero.avif
jsonLd: WebPage
multimedia:
  - type: interactive-widget
    component: <pricing-calculator/>
  - type: data-viz
    component: <pricing-comparison-matrix/>
  - type: pull-quote
    text: "The bill is honest. The 40 hours of annual developer time you burn on infra is the hidden cost nobody admits."
  - type: embedded-video
    src: /r2/video/pricing-walkthrough.webm
    poster: /r2/marketing/pricing-poster.jpg
---

# Pricing

Most SaaS pricing pages lie a little. The headline number is honest; the fine print is where the real bill hides. Three weeks in, you discover the seat-based add-on, the storage tier you blew past, the per-environment tax. By the time the invoice arrives, you've lost the plot.

This page is the opposite. The headline number is the bill. The variable cost is metered, transparent, and itemized. The marketplace fee is documented but never shown to your customers. You will never call us asking what a charge is for.

## How it works

Every account starts at **fifty dollars a month**. That covers your dashboard, your AI build credits, your hosted domain on `projectsites.dev`, custom domains, SSL, the AI editor, snapshots, and email support. One hundred thousand API requests a month are included.

Above the included tier, requests cost **one tenth of a cent each** ($0.001). API requests are the AI-heavy operations — research crawls, asset discovery, generative work, site rebuilds. Serving your finished site to visitors does not count. That part is unlimited.

That is the whole pricing story for the SaaS. Sites built. Sites hosted. Sites edited. Sites measured. All bundled into the base plus a metered overage you can predict.

## Starter — $50/month

- 100K API requests included
- Up to 5 active sites
- Custom domains and SSL
- AI editor for natural-language edits
- 30-day snapshot retention
- Email support

For freelancers and solo operators. One account, many clients, real ownership.

## Professional — $200/month

- 500K API requests included
- Unlimited sites
- Team of up to 10
- Advanced analytics with funnel tracking
- Marketplace booking module enabled
- 90-day snapshot retention
- Priority support with same-business-day response

For agencies, studios, and operators running multiple clients in parallel.

## Enterprise — by the conversation

- Volume request tier (1M–10M+ per month)
- Unlimited sites, unlimited team
- Dedicated account manager
- Custom integrations and SSO
- On-prem and white-label options
- 99.95% uptime SLA with credit-on-breach
- Audit logging and compliance documentation

For companies who treat their website portfolio as critical infrastructure. Email brian@megabyte.space.

## How the meter works

An "API request" is one of these operations:

- **Research** — Google Places, Yelp, Foursquare, YouTube, an existing-website crawl
- **Asset discovery** — Unsplash, Pexels, Pixabay, Cloudflare Images, DALL·E 3 generation
- **AI work** — Claude, Workers AI, Sora, ElevenLabs TTS, embeddings
- **Site operations** — rebuilds, snapshots, schema introspection, the AI editor's tool calls

A from-scratch portfolio costs about 2,000 requests end-to-end. A 50-page small-business site costs about 10,000. A nonprofit with a 200-route sitemap and full multimedia costs around 30,000. The 100K included tier covers comfortably a dozen complete builds a month, more if you mix small sites with edits to existing ones.

Site visits do not count. You can serve a million page views a month on a single site at no marginal cost.

## The marketplace fee — for sites that take bookings

When you turn on the booking module — appointments, lessons, event tickets, service reservations — there is a **twelve percent platform fee** on settled bookings. This is the fee we charge you, the operator. It is itemized on your invoice every month and netted from the funds we pass through to your bank account.

Your customer never sees a "platform fee" on their receipt. They see your name, your price, your brand. The 12% is invisible to them and visible to you, the way every honest middleman should operate.

Twelve percent is not arbitrary. TaskRabbit charges fifteen. Thumbtack charges a per-lead fee that effectively runs higher on lower-value bookings. Uber charges twenty-five to thirty. Twelve threads the needle: high enough to fund the matching engine, the dispatch tooling, the dispute mediation, the payouts plumbing, and the live-tracking map — low enough that operators do not feel skinned.

If you do not turn on the booking module, the 12% never applies. A pure marketing site or e-commerce site routed through Stripe Link incurs only the standard Stripe processing fee, passed straight to the buyer at checkout. We do not skim on top.

## What you save by not building this yourself

Let's price what most teams spend cobbling these pieces together themselves:

| Piece                          | Typical monthly cost |
| ------------------------------ | -------------------- |
| Webflow Pro + custom domain    | $40                  |
| Headless CMS subscription      | $99–$300             |
| Frontend hosting (Vercel Pro)  | $20–$200             |
| Stripe Connect setup time      | $0 base + 40 hrs dev |
| Booking engine (Acuity, etc.)  | $25–$80              |
| Email + transactional sender   | $20–$80              |
| Image CDN (Cloudflare Images)  | $5–$50               |
| Analytics + session replay     | $30–$100             |
| Sentry + error tracking        | $26                  |

Floor: about $260/month before any developer hours. Ceiling: $1,000/month with a part-time engineer. Project Sites bundles every line item above for the same fifty.

## Compared to neighbors

| Platform        | Base   | Site count        | AI generation | Booking      | Code export |
| --------------- | ------ | ----------------- | ------------- | ------------ | ----------- |
| Project Sites   | $50    | 5–unlimited       | Built in      | 12% on settle| Yes (React) |
| Webflow Pro     | $40    | 1                 | Add-on        | Add-on       | Limited HTML|
| Squarespace Biz | $33    | 1                 | Limited       | Add-on + fees| No          |
| Shopify Basic   | $29    | 1 storefront      | Limited       | Add-on       | No          |
| Wix Studio Pro  | $50    | Unlimited (agency)| Add-on        | Add-on       | No          |
| Vercel Pro      | $20    | Per team          | None bundled  | None         | Your repo   |

The honest comparison: most of those numbers go up the moment you need a second site, a custom domain, a booking widget, or a real export option. We bundle. They unbundle.

## Frequently asked

**Does the fifty include hosting?** Yes. Every site lives on Cloudflare's network with global edge delivery, SSL, automatic image optimization, and daily backup. Hosting is not a separate line.

**What if I blow through the 100K requests?** You pay a tenth of a cent per request over the tier. A typical builder using their full quota and overshooting by 50K spends $50 base + $50 overage. No cliff. No throttle. We bill, you keep going.

**Can I bring my own domain?** Yes, on every plan. Point a CNAME at us; we provision SSL and email forwarding in about two minutes.

**Does the team count seat-by-seat?** No. Ten members on Pro means ten members. We do not charge per seat. We charge per work the account does.

**Can I export the code?** Yes. Every site is a React + Vite project and downloads as a zip. You can rehost on Vercel, Netlify, your own Workers, or staple a Cloudflare Pages deploy to your existing CI. We do not hostage your work.

**What about refunds?** Prorated to the day of cancellation. No "we'll keep what's left of the month" nonsense.

**Are there annual plans?** Coming in Q3 with a 15% discount and a guaranteed price hold for the term.

## What you do next

Sign in with email or Google. Search for a business. Watch the AI build for about eight minutes. Publish. Send the link. The bill arrives at the end of the month and looks exactly like this page promised.

```json
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Pricing — Project Sites",
  "description": "Start at fifty a month. Scale with usage. No surprises.",
  "url": "https://projectsites.dev/pricing",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```
