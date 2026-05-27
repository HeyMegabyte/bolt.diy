---
title: "Portfolio — The Flagship Template"
dek: "Built for the people whose work is the proof. Photographers, designers, writers, engineers who let craft speak first."
author: Brian Zalewski
date: 2026-05-26
tags: [template, portfolio, design, showcase]
hero: /r2/templates/portfolio-flagship-hero.avif
jsonLd: WebPage
multimedia:
  - type: photography
    src: /r2/templates/portfolio-examples-grid.jpg
    alt: "Grid of nine real portfolio sites built from this template"
  - type: interactive-widget
    component: <portfolio-template-configurator/>
  - type: pull-quote
    text: "Your portfolio is not a CV. It is the room where your work makes its case before you walk in."
  - type: embedded-video
    src: /r2/video/portfolio-walkthrough.webm
    poster: /r2/templates/portfolio-poster.jpg
---

A photographer's portfolio is the room their work walks into before they do. A designer's portfolio is the silent pitch deck that runs while they sleep. An engineer's portfolio is the proof that their commits do what their resume says. The template you are reading about is built for those rooms.

It is the flagship of the projectsites.dev catalog because the portfolio is the hardest single page on the internet to get right. Get it wrong and your work disappears under generic chrome. Get it right and you do not have to send a cover letter again.

## Who this is for

The honest answer: anyone whose career outcomes depend on people seeing real work and forming a strong opinion in under two minutes.

- **Designers** — product designers, brand identity studios, illustrators, industrial designers
- **Photographers and filmmakers** — wedding, editorial, commercial, fine art
- **Writers and journalists** — long-form, technical, copywriting portfolios
- **Engineers** — case studies of shipped systems, before/after architecture diagrams, real metrics
- **Architects, ceramicists, furniture makers** — anyone whose work needs to be photographed beautifully
- **Researchers and academics** — publication-grade portfolios with citations and downloadable PDFs
- **Founders building a personal brand alongside the company** — the LinkedIn alternative that does not look like LinkedIn

If your work lives in a Notion page or a Google Drive folder right now, this template is what moves it into a domain you own.

## What's included

A portfolio is not one page. It is a small constellation of pages that orbits the work. The template ships with the constellation.

**Home.** A hero that frames the practice in one sentence and one image. Below that, a tightly curated index of the latest three to nine projects. No carousels. No autoplay video. Just work, with discipline.

**Work index.** Filterable by category, year, client, or medium. Renders in three layout variants — grid, magazine, list — that you can switch between with a single setting. The grid is the default because grids let the eye breathe.

**Project case study.** The dedicated page where one piece of work makes its full argument. Hero image. Problem statement. Process notes. Final stills, in-progress reference, callouts. Roles, collaborators, timeline. Optional downloadable PDF. Press mentions and follow-on coverage. The case study template is the difference between "I made this" and "I understand why this works."

**About.** Bio, photo, capabilities, the short story of the practice. Optional CV download. Schema-marked-up so Google understands you are a person, not a thumbnail.

**Contact.** Honest contact: email, phone, calendar booking link via Cal.com or Calendly if you use one. A Turnstile-protected form for clients who want to type. No spam, ever.

**Press.** Coverage, awards, talks, interviews. Each item is a small card with publication, date, link, and a pull quote.

**Now page.** A small running journal of what you are working on this season. Five lines, monthly. The kind of page Derek Sivers championed and that quietly does more for client conversion than any landing page.

**Colophon.** Type, color, sourcing. Visible only to people who care about the craft. They will care.

## The customization story

The template ships with a defaults set built to be defensible: clean type, considered grid, OKLCH brand colors, restrained motion. Roughly 80% of practitioners can ship the defaults and look like they hired a studio.

For the other 20% who want their voice to come through, customization is structured and finite. You change:

- **Brand color** — single OKLCH-defined accent. Drives links, buttons, hover states, focus rings. Everything else is built from neutral grays.
- **Type pair** — three preset pairings (Sora + IBM Plex Sans, Cardinal + Inter, Cormorant + JetBrains Mono), or paste in any two Google Fonts and the system picks defensible weights.
- **Layout density** — comfortable, dense, or magazine. Affects line-height, paragraph spacing, image gallery gaps.
- **Motion intensity** — full, restrained, off. Off is respected for visitors with `prefers-reduced-motion`.
- **Color scheme** — dark-first, light-first, or follow-system. We hard-test contrast against WCAG AA at every accent + background combination.

Editing happens in the AI editor or by exporting the React + Vite project and changing tokens in `theme.scss`. Both paths feel native.

## Real examples

A wedding photographer in Brooklyn shipped a portfolio with this template in under three hours. Her hero is a single image, full-bleed, captioned with the couple's first names and the year. The case studies are not "weddings" — they are stories. Bookings went up 23% in the first quarter (anecdotal; she also raised prices).

A product designer in Berlin runs a case-study-only portfolio. Six pieces of work, six pages, no "about" page longer than three paragraphs. She gets contacted weekly by founders pitching her work.

An open-source engineer in Lagos uses the template to host long-form write-ups of his shipped systems. The "work" page renders his GitHub graph alongside thumbnails of the architecture diagrams. He got hired into a Series B engineering team off a single case-study link in a cold email.

A landscape architect in Seattle uses the gallery template variant exclusively. Project pages are 80% imagery and 20% text. Each project ends with a measured-drawing PDF the client can download. He bills three times the regional average.

## Pricing position

Portfolio sites live in the $50/month Starter plan. One portfolio rarely needs more than five sites' worth of capacity (most practitioners run one main portfolio plus maybe one or two project-specific microsites). The included 100K API requests cover every research crawl, image upload, and edit you will plausibly run.

If you want to build portfolios for clients as a service, the $200/month Pro plan covers unlimited sites and a team of ten, which is enough to run an agency.

## Start building

Three paths in:

**1. Start from your existing portfolio.** Give us the URL. We crawl it, extract your work, your colors, your fonts. The new version goes live in about eight minutes with your existing content already in place.

**2. Start from a Notion page or a PDF.** Upload it. The AI parses your projects and renders a fresh portfolio with the same content, properly designed.

**3. Start blank and import work piece by piece.** For the practitioners who want to curate as they build. The AI editor walks you through each project with a checklist.

Whichever path, you end up with a portfolio that does the quiet thing a portfolio is supposed to do: make the work the first and last argument.

```json
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Portfolio — The Flagship Template",
  "description": "Built for the people whose work is the proof. Photographers, designers, writers, engineers who let craft speak first.",
  "url": "https://projectsites.dev/templates/portfolio-flagship",
  "publisher": { "@type": "Organization", "name": "ProjectSites", "url": "https://projectsites.dev" }
}
```
