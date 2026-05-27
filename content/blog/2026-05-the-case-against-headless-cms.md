---
title: "Headless CMS is a Trap for 90% of Websites"
dek: "It promises flexibility and power. It delivers operational debt and JavaScript bloat."
author: Brian Zalewski
date: 2026-05-26
tags: [opinion, cms, architecture]
hero: /r2/blog/headless-cms-hero.avif
jsonLd: Article
multimedia:
  - type: hero-illustration
    src: /r2/blog/headless-cms-hero.svg
    alt: "Diagram of a website's content stack vs. a headless content stack"
  - type: pull-quote
    text: "Headless CMS trades build simplicity for deploy complexity. For a 50-page marketing site, that's a terrible trade."
  - type: data-viz
    component: <data-viz-cms-complexity-cost/>
  - type: embedded-video
    src: /r2/video/headless-cms-explanation.webm
    poster: /r2/video/headless-cms-poster.jpg
---

I spent four years watching nonprofits and small SaaS companies adopt headless CMS platforms. Most regretted it within eight months.

They arrived with legitimate needs: update copy without a developer. Deploy fast. Own their content. Those are real problems. Headless CMS pitches the answer: decouple content from presentation, ship a REST API, plug in any frontend. It sounds clean. It is not.

## The Headless Promise Is Fraud

The pitch assumes you want to feed the same content to web, iOS, Android, email, print, and a hologram. If that's you, great. For everyone else — which is about 90% of the web — you're paying for optionality you'll never exercise.

What you get instead: a content schema that's generic enough for six channels but matches none perfectly. A three-tier deployment pipeline where changes cascade slowly. A frontend that's no longer boring HTML files but a JavaScript application that has to fetch and hydrate and poll and cache. A team split between "content people" who use the admin and "dev people" who maintain the frontend.

The nonprofits I watched had a simple use case: 40 pages, a blog, maybe a donation form. They picked Contentful or Sanity thinking it was an upgrade from WordPress. Six months in, they had a $200/month SaaS subscription, two Node.js developers handling builds, and they still couldn't change the homepage without a code deploy.

WordPress did that in 2003. Free.

## The Real Cost: It's Not the Monthly Fee

Headless CMS vendors market the monthly subscription. That's the decoy. The actual cost is operational.

**Setup overhead.** Headless CMS requires a frontend. Contentful doesn't ship one. Sanity doesn't ship one. You pick Next.js, Astro, Remix, Nuxt, whatever, and now you own a frontend framework, a build pipeline, a deployment platform, and a dev environment. The Contentful account is $99/month. The frontend infra is $500–2000/month plus DevOps time.

**Schema inertia.** Once you've modeled content in Contentful's UI (custom fields, nested arrays, rich-text blocks), changing that schema means migrating every published entry. A small change — renaming a field, adding a required property — becomes a migration script. On WordPress, you change a post template; entries auto-conform.

**Deployment friction.** A change to homepage copy on a traditional CMS: edit, save, live. On a headless setup: edit in Contentful, trigger a webhook, rebuild the frontend (30–90 seconds), purge the CDN cache (5–30 seconds), verify the build didn't break. The content team watches a loading bar for two minutes.

**Frontend sprawl.** The frontend is now a "full-stack JavaScript application." You need linting, testing, CI/CD, Docker (maybe), monitoring. A WordPress blog needed a plugin and FTP. Your Astro site with Contentful needs GitHub Actions, Vercel, Sentry, and a senior engineer to reason about why builds occasionally time out.

The $100/month Contentful bill is honest. The 40 hours of annual developer time you burn on infra is the hidden cost nobody admits.

## Headless CMS Works for Three Cases

If you actually need decoupling, headless makes sense:

**True omnichannel.** You're serving the same content to web, iOS app, Android app, embedded kiosk, and maybe a print catalog. All six channels need the same data model. Headless CMS shines. Examples: Shopify (inventory + product data across sales channels), Stripe (documentation + API references across web + SDKs), a hotel chain (rooms + rates across booking sites + mobile app + printed brochures).

**High-volume collaboration.** Your content team is 12 people and edits independently. A collaborative rich-text editor (Sanity's live collab, Contentful's). A clear editorial workflow (draft → review → schedule → publish). WordPress can do this; headless CMS does it natively. But you're only considering this if you've already decided the ROI justifies a $500+/month SaaS platform.

**API-first as the core product.** You're building a platform where users consume your content programmatically. Your content IS an API. You're not optimizing for a website; you're optimizing for a data feed. The website is incidental. Headless CMS is the right model. But also: build your own. It's simpler than you think.

For everyone else? You don't need it.

## The Viable Alternatives

**Option A: WordPress + Headless.** Yeah, WordPress. The dinosaur is still there. It's matured. It has a REST API. You can decouple if you want. Most people use it as a traditional CMS because that's actually simpler. The VPS for WordPress is $5/month. The headless frontend is optional, not mandatory.

**Option B: Static site generator + Git for content.** Hugo. Jekyll. Astro (used correctly — SSG, not SPA). Content lives in Markdown files in Git. Changes are pull requests. Builds happen via GitHub Actions. Deploys go to S3 / R2 / Netlify. You own everything. There are no $200/month vendor dependencies. The content team has to be comfortable with Git or a Git wrapper (Forestry, Decap CMS — both free or very cheap). Most nonprofits can make this work.

**Option C: Traditional CMS with good APIs.** Craft CMS. ProcessWire. Statamic. These are the quiet middle. They're open-source, self-hosted, have REST APIs if you want them, and they have great UIs for content editors. You don't pay a monthly fee. You deploy to your own server (or a cheap VPS). Nobody knows about them because they don't have $100M in VC funding, so they don't get TechCrunch articles.

**Option D: Just use WordPress.** Seriously. Or Webflow if you want no-code. Both have gotten very good. Both have normal editing UX. Both deploy instantly. Both cost $20–200/month all-in.

## Why Headless CMS Exploded

The rise of headless CMS coincides with three industry shifts:

**Jamstack hype (2016–2021).** Marketing was brilliant. "Decoupled" sounded sophisticated. "API-first" sounded future-proof. Everyone wanted to be an API company. The fact that you don't need one was irrelevant. Headless CMS vendors rode the wave.

**Venture funding.** Contentful, Sanity, Strapi, Hygraph, Webiny — they all raised large Series rounds. They need to justify that capital. They need paying customers. They need to convince you that your simple website is actually a "headless architecture" problem. If it's not a problem, they need to make it one.

**Frontend complexity increased.** React made frontend development "respectable." You could now hire frontend engineers. The psychological incentive to build a complex frontend (to justify the salary of the frontend engineer) is real. A static site doesn't need a frontend engineer. A Next.js + Contentful setup does. Suddenly your org structure demands the headless CMS.

## What Happened to the Nonprofits

Most migrated back.

One switched from Contentful to Webflow. The content team celebrated. They got a visual builder, WYSIWYG editing, instant deploys, and no Node.js knowledge required. The bill went from $300/month to $25/month.

Another abandoned the headless frontend entirely and used Contentful's rich-text renderer as a WordPress alternative. They hosted it on a cheap VPS, gave the content team a custom admin UI, and saved $100/month. It wasn't elegant, but it shipped and it worked.

One went back to WordPress. No regrets.

None of them said, "We wish we'd stuck with headless."

## The Question to Ask

Before you pick a headless CMS, ask: "Do I need the same content on six different platforms?"

If the answer is no — if your content is for a website, period — then you don't need headless.

You need a simple CMS with great UX, a one-click deploy, and a monthly bill under $50.

WordPress has that. Webflow has that. Craft CMS has that. Statamic has that.

Contentful does not.

The trap isn't headless CMS technology; it's the belief that decoupling is always good. Sometimes tight integration is exactly what you want. Sometimes "boring" is the most powerful engineering decision you can make.

Pick the simplest tool that solves your actual problem. For 90% of websites, that's not a headless CMS.

It's the one they already had.

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Headless CMS is a Trap for 90% of Websites",
  "author": { "@type": "Person", "name": "Brian Zalewski", "url": "https://megabyte.space" },
  "datePublished": "2026-05-26",
  "image": "https://projectsites.dev/r2/blog/headless-cms-hero.avif",
  "description": "It promises flexibility and power. It delivers operational debt and JavaScript bloat.",
  "wordCount": 1847,
  "inLanguage": "en",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```
