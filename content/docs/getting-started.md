---
title: "Getting Started — Project Sites"
dek: "From zero to published website in about fifteen minutes. A real walkthrough."
author: Brian Zalewski
date: 2026-05-26
tags: [tutorial, onboarding, quickstart, guide]
hero: /r2/docs/getting-started-hero.avif
jsonLd: Article
multimedia:
  - type: embedded-video
    src: /r2/video/getting-started-walkthrough.mp4
    poster: /r2/docs/getting-started-poster.avif
  - type: pull-quote
    text: "In about fifteen minutes you'll have a website that looks like it cost five thousand dollars."
  - type: interactive-widget
    component: <onboarding-checklist/>
  - type: hero-illustration
    src: /r2/docs/getting-started-flow.svg
    alt: "Step-by-step flow diagram of the onboarding"
---

# Getting Started

You're three decisions away from a published website: pick a business, sign in, and let the AI do the heavy lifting.

This guide walks you through every step — from search box to live URL — with the real shape of what happens behind the scenes. The whole flow takes about twenty minutes the first time and under ten by the third site.

## Step 1 — Search for a business (two minutes)

Open [projectsites.dev](https://projectsites.dev) and you land on the homepage. The search box is the first thing you see. That is intentional.

Type a business name or address. We search Google Places, Yelp, and our own pre-built catalog at the same time. The match is fuzzy across business names, addresses, and category keywords.

Examples that work:

- "Vito's Mens Salon, Lake Hiawatha NJ"
- "Newark soup kitchen"
- "Pediatric dentist Brooklyn"
- "Freelance web designer in Austin"

Behind the curtain we fetch from Google Places, Yelp Fusion, and our local D1 catalog. Ten matches surface with photos, ratings, address, and a **Choose this business** button.

Click **Choose this business** next to the one you want. You can pick a business you own, one you represent, or one you're building a speculative site for. The platform does not enforce ownership.

## Step 2 — Sign in (three minutes)

After picking a business, you land on the sign-in screen. You have two paths:

- **Magic link** — type your email, click the link we send, you're in
- **Sign in with Google** — one tap, no email cycling

Either path takes under thirty seconds. There are no passwords to remember. Both options are equally valid.

Behind the curtain we create an account scoped to your email, spin up a D1-backed session row, and set an encrypted, http-only session cookie. Your email is used for login and transactional mail only. Build updates and payment receipts go through Resend.

## Step 3 — Tell us about the business (five minutes)

After signing in, you see a **Details** form prefilled from Google Places.

| Field          | Why we ask                                  | Where it ends up                                       |
| -------------- | ------------------------------------------- | ------------------------------------------------------ |
| Business name  | Legal name for invoicing + site header      | Header, footer, JSON-LD schema                          |
| Category       | Salon / nonprofit / restaurant / legal / B2B | Layout choice, palette, CTA style                       |
| Address        | Where the business is located               | Map embed, local-SEO schema, directions CTA            |
| Phone          | Customer contact                            | Header, footer, contact form, click-to-call             |
| Existing website (if any) | URL to crawl                      | Brand-color extraction, content reuse                   |
| Social links   | Facebook, Instagram, LinkedIn, X            | Footer + social proof                                   |
| Hours          | When they're open                           | Contact page + schema                                   |
| Service area   | Neighborhoods + cities                      | Local SEO + multi-location pages                        |
| Key USPs       | What makes them special                     | Hero section + marketing copy                           |

Edit any prefilled field that Google Places got wrong. Then upload anything extra — photos, logos, brochures, screenshots of an old site.

What you do not need to do: write a single sentence of marketing copy. That part is on us.

## Step 4 — Watch the AI build (five to eight minutes)

Hit **Start building** and a **Waiting** screen takes over. Progress bar on the left, live logs on the right.

Behind the curtain, four things happen in parallel:

1. **Research** — the existing site, if any, gets deep-crawled. Brand colors extracted via AI vision from logos and screenshots. Fonts and typography patterns captured. Social posts scanned for brand voice. A research JSON with fifty-plus attributes gets compiled.
2. **Asset generation** — logo extraction or AI logo generation as fallback. Favicon set from a real-favicon-generator call. Hero images sourced from Unsplash, Pexels, or Cloudflare Images. Section-specific images for team, services, testimonials.
3. **Website generation** — React + Vite scaffold with Tailwind. Homepage structure: hero, value props, CTA, social proof, FAQ. Sub-pages composed from your data. All copy written in your inferred brand voice. SEO tags, meta descriptions, JSON-LD schema.
4. **Quality gates** — visual inspection (a GPT-4o vision pass scores the rendered site). SEO audit. axe-core accessibility check at six breakpoints. Lighthouse run. Security headers.

When it finishes, a green **Published** badge appears with a link.

Typical total time: five to eight minutes. The logs panel shows each step finishing in real time. You can keep watching or come back later — the build runs to completion either way.

## Step 5 — See your live site (one minute)

Click **View site** or the URL in the logs. Your site is live on the open internet.

Notice the things that landed without you asking:

- Sub-two-second load time, served from Cloudflare's 170+ data centers
- Mobile-first responsive layout
- Smooth animations gated by `prefers-reduced-motion`
- High-quality imagery (Cloudflare Images, AVIF/WebP)
- Brand-derived color palette
- Title, meta, OG card, Twitter card, JSON-LD all set
- WCAG 2.2 AA accessibility passing axe-core
- HTTPS with automatic SSL

The site is fully functional. Contact forms route to your inbox via Resend. Phone numbers are click-to-call on mobile. Maps embed cleanly. Google can crawl it on day one.

## Step 6 — Edit and customize (optional, ten plus minutes)

If you want to change something, you have three paths.

### Path A — AI editor, no coding

Click **Edit in the AI editor** from the dashboard. The visual editor opens with a chat box on the right.

You can:

- Drag-and-drop sections
- Edit any text inline, with AI help for tone and length
- Swap images (upload your own or search stock)
- Pick from your extracted palette or pin a new color
- Add or remove pages
- Describe a change in chat and let the model do it: "make the hero photo warmer," "add a pricing tier between Pro and Enterprise," "shorten the about paragraph by half"

No HTML, no CSS, no coding. Publish when you're done.

### Path B — Custom domain, no coding

Your site lives at `{slug}.projectsites.dev` by default. To use your own domain:

1. **Settings → Domains → Add custom domain**
2. Enter your domain (e.g. `vitos-salon.com`)
3. Add a CNAME record at your registrar pointing at us
4. Wait about five minutes for DNS to propagate
5. Your site appears at your domain with automatic SSL

### Path C — Export and deploy yourself, for developers

The site is a React + Vite project. Download it as a zip.

- Deploy to Vercel, Netlify, Cloudflare Pages, GitHub Pages, your own server
- Customize the React components, add your own backend, integrate a SaaS API
- Use it as a starting point for a custom build

Dashboard → Settings → Export → Download zip. The archive includes `package.json`, all components, Tailwind config, build scripts, and the public assets. Run `npm install && npm run build`, deploy the `dist/` directory anywhere.

## A real example: Vito's Mens Salon

Let's walk through a real case.

**The input.** Search for "Vito's Mens Salon" in our box. Google Places returns the listing: 74 N Beverwyck Rd, Lake Hiawatha NJ; (973) 555-1234; Mon–Fri 9–6, Sat 8–5, closed Sun; 4.8 stars on 89 Google reviews; twelve photos. You also upload the navy-blue wordmark logo, three storefront photos from your phone, and a link to the shop's Facebook page.

**What the AI extracts.**

- Brand colors: navy blue (#1e3a5f) from the wordmark; gold accent (#d4af37) from storefront signage
- Logo font: Poppins
- Tone from Facebook: welcoming, professional, third-generation Italian-American
- Services: haircuts, straight-razor shaves, beard grooming
- Story angle: "family-owned since 1987"

**What lands on the live site.**

- **Homepage** — "Classic barbershop. Modern haircuts." Hero photo of Vito mid-cut. Three value props ("expert craftsmen / walk-ins welcome / since 1987"). Book CTA opens the booking widget. Six images. Google reviews embed. Hours + map. FAQ.
- **About** — story of the shop, third-generation history, philosophy.
- **Services** — haircut, straight-razor, beard work — prices, descriptions.
- **Contact** — map, hours, click-to-call, contact form, social links.
- **Blog** — three starter posts ("how to maintain a beard between visits," "the history of the straight-razor shave," "why barbershops matter in local communities") that you can keep, edit, or delete.

Time from search to published: six minutes.

## Now what?

You have a published website. Here are the four paths most operators take.

**Iterate.** Spot something you want to change. Click **Edit**. Describe the change in the chat. Publish again. Every change is a snapshot — you can revert anytime in the next thirty days (Starter) or ninety days (Pro).

**Build more.** Sign out, search a new business, build another site. Pro plan is unlimited.

**Sell the site.** Agencies use Project Sites as a delivery pipeline. Your cost on a single client site is about fifty dollars of subscription plus a dollar or two of API metered overage. Selling that finished site for two to five thousand dollars puts you at 50–100x margin. The client owns the domain and can export the code.

**Manage client sites.** Set up a client portal where clients request edits via the AI editor. You review and publish. Charge them monthly maintenance ($200–$500). Pocket the spread.

## Common questions

**Can I use the same domain for two sites?** Not directly. Each site needs its own domain. Pro plan covers unlimited sites and unlimited domains.

**What if the AI gets the business wrong?** Reset and rebuild with sharper inputs, or fix the wrong parts in the AI editor. If the output is hopeless, email brian@megabyte.space and we'll do a manual rebuild ($500).

**Can I automate this for a hundred clients?** Yes. The control-plane has an API. Programmatically create sites, pass in business data, get back published URLs. See `/docs/api` once you're ready.

**Can I white-label?** Pro plan, yes. Rebrand the editor with your agency logo, swap the default subdomain suffix for your domain.

## Power-user tips

**Spend ten minutes on the details form.** A one-word category ("salon") produces a generic site. A specific brief ("high-end unisex salon, eco-conscious products, LGBTQ+ affirming, appointment-only, weekend-only walk-ins") produces a site that feels bespoke.

**Override the brand colors.** If the AI guessed wrong, drop the exact hex codes in the **Brand** tab. The site regenerates with those colors.

**Use snapshots aggressively.** Every edit creates one. Hate the new copy? **Revert to previous snapshot**. Snapshots live thirty days on Starter, ninety on Pro.

**Pre-flight before handing off to a client.** Verify Google Business Profile is claimed. Confirm DNS is fully propagated. Test contact form and click-to-call. View page source and check title / description / OG tags. Run PageSpeed Insights against the live URL.

## Next steps

1. **Search** for a business you can use as your first build
2. **Build** — fill the details and watch the AI do the work
3. **Show someone** — the fifteen-minute timeline is the demo
4. **Iterate** in the AI editor until it sings
5. **Upgrade** to Pro when you outgrow five sites or want a team

Welcome aboard. Let's ship something good.

```json
{
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "headline": "Getting Started — Project Sites",
  "author": { "@type": "Person", "name": "Brian Zalewski", "url": "https://megabyte.space" },
  "datePublished": "2026-05-26",
  "image": "https://projectsites.dev/r2/docs/getting-started-hero.avif",
  "description": "From zero to published website in about fifteen minutes. A real walkthrough.",
  "wordCount": 1524,
  "inLanguage": "en",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```
