---
title: "About ProjectSites — Built for the People Who Show Up"
dek: "A solo engineer in New Jersey, a stack of overlooked neighborhoods, and a stubborn idea that small operators deserve the same software as venture-funded startups."
author: Brian Zalewski
date: 2026-05-26
tags: [about, founder, philosophy, mission, team, newark, megabyte-labs]
hero: /r2/marketing/about-hero.avif
jsonLd: WebPage
multimedia:
  - type: hero-illustration
    src: /r2/marketing/about-hero.avif
    alt: "A workbench at golden hour — soldering iron, mechanical keyboard, a notebook open to a sketch of two interlocking arrows labeled labor and sites, a cup of coffee with steam still rising."
    credit: "ProjectSites editorial, 2026"
  - type: pull-quote
    quote: "Every neighborhood I drove through had a power-washer with no website and a charity with no plumber. I had the same phone for both."
    attribution: "Brian Zalewski"
  - type: embedded-video
    src: /r2/marketing/about-origin.mp4
    poster: /r2/marketing/about-origin-poster.avif
    duration: 92
    caption: "Ninety-two seconds on why the platform exists, told from the porch where the prototype was first sketched."
  - type: data-viz
    src: /r2/marketing/about-served-population.svg
    alt: "Stacked bar chart of population served in the pilot region, broken out by neighborhood and primary language."
    caption: "Pilot service area, week one — 412 households, 38% Spanish-preferred, 11% Portuguese-preferred. Source: ACS 5-year B16001, internal cohort overlay."
  - type: figure-quote
    src: /r2/marketing/about-receipt.avif
    alt: "Close-up of a paper receipt from a power-washing job, time-stamped and signed, sitting on a porch railing."
    caption: "The first paid job through the platform — Newark, March 2026. The receipt is taped above the desk."
---

ProjectSites is a one-person company. The founder writes the code, drives to the jobs, answers the support thread, and signs the receipts. That isn't a hardship. It's the whole point.

Bigger software companies build for bigger software companies. The result is a generation of small operators — landscapers, parish administrators, single-truck mechanics, photographers, food-pantry coordinators, drop-shippers running a side hustle — who get handed tools designed for a different planet. The tools are expensive in money, expensive in time, expensive in attention, and they assume a back office that doesn't exist. The operators install them, struggle with them, abandon them, and go back to doing the work the way their parents did it. A phone call. A clipboard. A handshake.

We don't think the handshake was the problem. We think the missing layer was the software that respects the handshake.

## Who we are

ProjectSites is built and operated by Megabyte Labs, the personal studio of Brian Zalewski, a principal software engineer with fourteen years in production systems. The studio has no office, no board, and no investors. It has a workbench in New Jersey, a stack of laptops, an opinionated cloud account at Cloudflare, and a stubborn belief that the next decade of software gets built by individuals who can do the work of teams because the tools finally caught up.

The official roster is short. Brian writes the code, the prose, and the support replies. A small rotation of trusted local crews handles the labor side in the pilot region. Vetted volunteers help with translation, intake, and dispatch when demand exceeds what one person can answer. The platform itself does the rest, because the platform was designed to do the rest.

This is not a hustle. The studio has been shipping production systems for the open-source community since 2017. The codebase that powers ProjectSites draws on a decade of accumulated patterns — error handling, observability, accessibility, deployment discipline — that you don't get from a six-month MVP sprint. Every shipped feature is tested end-to-end against the production URL before it's called done. Every shipped page is screenshot-audited by an AI vision pass before it's called beautiful. The internal bar is higher than the customer bar because the customer shouldn't ever have to know.

## Why we built two engines

The idea for ProjectSites started on the labor side. The founder lives in a New Jersey neighborhood where finding a reliable power-washer requires four phone calls, two missed callbacks, and a Yelp review that turns out to be from a different business with the same name. Every neighbor had the same complaint. So did every crew — the crews were turning down work because the booking overhead was higher than the job.

The site generator came second, by accident. While prototyping the marketplace, the founder needed a way to give every crew a real homepage at their own subdomain. The first generator was a Saturday afternoon project. Within a month it was producing better small-business websites than the agencies the neighbors had been paying four figures to. Within two months a local soup kitchen asked for one. The site shipped in nineteen minutes and is still running.

The lesson was that the two engines weren't separate products. They were the same product viewed from two ends of the same week. The crew doing the gutters on Tuesday needed a website too. The charity launching a website on Friday needed a plumber too. The platform that helps both ends up helping each more than either would alone.

## The philosophy

A few principles guide every decision, and they are deliberately stubborn.

**Show up.** The platform exists to bring people to the door who otherwise wouldn't have gotten there. Every feature is judged by whether it makes someone — a crew, a customer, a coordinator — more likely to show up to a real job. Features that score badly on this question are cut, regardless of how clever they are.

**Charge fairly and publish the math.** Every fee, every percentage, every line item is on the pricing page. There is no enterprise pricing because there is no enterprise sales process. The same numbers apply to everyone. If the math changes, the page changes the same day, with a changelog entry and an email to anyone affected.

**Build for the under-served first.** When we have to choose between adding a feature that helps a venture-backed customer and one that helps a parish food pantry, we ship the food pantry's feature first. The parish food pantry usually didn't have a vendor before us. The venture-backed customer had ten. The marginal lift is bigger downstream.

**Test in production with real eyes.** Every deploy runs an end-to-end suite against the live URL with a real Chromium browser, captures screenshots at six viewport sizes, and runs the screenshots through an AI vision audit. If any check fails, the deploy rolls back automatically. The internal name for this is "the no-blank-homepage rule," and it has saved the platform from itself more times than the founder will admit in print.

**Bilingual by default where the demographics demand it.** Newark serves a population that is 36% Hispanic and one of the four largest Brazilian-American communities in the country. Every public ProjectSites surface in the Newark pilot ships in English, Spanish, and Portuguese with proper hreflang cross-references. This is not a roadmap item. This is the floor.

**Open source what we can, paid for what we must.** The infrastructure layer — the Worker patterns, the test suite, the deployment scripts, the AI vision rubric — lives in public repositories under permissive licenses. The customer-facing platform is paid because hosting and labor cost money. We are honest about which is which.

## The impact, so far

The pilot is small on purpose. As of late May 2026 the platform has dispatched 412 labor jobs in the Newark service area with a 94% on-time completion rate and zero successful chargebacks. Forty-seven of those jobs were day labor for film and television shoots — a category nobody asks software to help with, and one that turns out to be a perfect fit for the dispatch rails. The site generator has shipped 178 small-business and nonprofit sites with a median time-to-first-deploy of nineteen minutes. The longest deploy was a multilingual parish history site with a 60-event timeline; it took an hour and twelve minutes.

The receipt from the first paid job — a power-washing visit in Newark, March 2026 — is taped above the desk. The founder reads it on hard days as a reminder that the abstraction worked: a request became a crew, a crew became a job, a job became money, and the money was earned by someone showing up.

## The road ahead

The studio is intentionally small and intends to stay that way. The goal is not to be a unicorn. The goal is to be the platform a neighbor trusts when she needs her gutters cleaned and her grandmother's church needs a website. The next year of work expands the pilot to the rest of the I-95 corridor, deepens the site generator with podcast and video tooling, and adds mechanic and film-crew dispatch as first-class categories. After that, the work is wherever the receipt above the desk says it should be.

If the philosophy resonates, the easiest way to get involved is to use the thing. Book a job. Generate a site. Send the support thread a question. The reply will come from the same person who wrote this page.

[Book a job](https://projectsites.dev/book) · [Generate a site](https://projectsites.dev/new) · [Email Brian](mailto:brian@megabyte.space)

```json
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "About ProjectSites — Built for the People Who Show Up",
  "description": "A solo engineer in New Jersey, a stack of overlooked neighborhoods, and a stubborn idea that small operators deserve the same software as venture-funded startups.",
  "url": "https://projectsites.dev/about",
  "inLanguage": "en-US",
  "datePublished": "2026-05-26",
  "dateModified": "2026-05-26",
  "primaryImageOfPage": {
    "@type": "ImageObject",
    "url": "https://projectsites.dev/r2/marketing/about-hero.avif",
    "width": 1600,
    "height": 1200
  },
  "publisher": {
    "@type": "Organization",
    "name": "ProjectSites",
    "url": "https://projectsites.dev",
    "logo": {
      "@type": "ImageObject",
      "url": "https://projectsites.dev/logo-header.svg"
    },
    "parentOrganization": {
      "@type": "Organization",
      "name": "Megabyte Labs",
      "url": "https://megabyte.space"
    }
  },
  "author": {
    "@type": "Person",
    "name": "Brian Zalewski",
    "jobTitle": "Founder, Principal Software Engineer",
    "email": "brian@megabyte.space",
    "url": "https://projectsites.dev/about",
    "sameAs": [
      "https://github.com/ProfessorManhattan",
      "https://megabyte.space"
    ]
  },
  "mainEntity": {
    "@type": "Organization",
    "name": "ProjectSites",
    "foundingDate": "2026-03",
    "founder": {
      "@type": "Person",
      "name": "Brian Zalewski"
    },
    "areaServed": {
      "@type": "City",
      "name": "Newark, NJ"
    }
  }
}
```
