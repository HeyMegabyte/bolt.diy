/**
 * @module pages/press
 *
 * @description
 * Public press kit + 8-slide cinematic picture walkthrough rendered at
 * `/press`. Brand assets, founder bio, fact sheet, press releases, and media
 * contact — everything a journalist or partner needs in one URL.
 *
 * @remarks
 * - Standalone, OnPush, signals only.
 * - Brand tokens from `_polish.scss`. No hard-coded brand hex codes.
 * - Walkthrough images live at `/walkthrough/0[1-8]-*.jpg` (1920×1080).
 * - Lazy-loaded from `app.routes.ts`.
 */
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';

import { RouterLink } from '@angular/router';
import { MetaService } from '../../services/meta.service';
import {
  BASE_URL,
  ORG_ID,
  breadcrumbList,
  graph,
  organization,
  person,
  softwareApplication,
  webPage,
} from '../../lib/json-ld';

interface Slide {
  readonly n: number;
  readonly slug: string;
  readonly title: string;
  readonly caption: string;
  readonly src: string;
  readonly alt: string;
}

@Component({
  selector: 'app-press',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="press-page">
      <div class="container">
        <!-- HERO -->
        <header class="press-hero">
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <a routerLink="/">Home</a>
            <span aria-hidden="true">·</span>
            <span aria-current="page">Press</span>
          </nav>
          <p class="eyebrow">Press kit · v1.0 · updated May 25, 2026</p>
          <h1>Everything you need to write about ProjectSites.</h1>
          <p class="subtitle">
            Brand assets, founder bio, screenshots, fact sheet, and direct contacts for press,
            partnerships, and investors.
          </p>
          <div class="cta-row">
            <a class="cta-primary" routerLink="/brand">Download brand kit (4 MB) →</a>
            <a class="cta-secondary" href="mailto:press@megabyte.space"
              >Email press&#64;megabyte.space</a
            >
          </div>
        </header>

        <!-- WALKTHROUGH -->
        <section class="walkthrough" id="walkthrough" aria-labelledby="walkthrough-h">
          <header class="section-head">
            <p class="eyebrow">Picture walkthrough</p>
            <h2 id="walkthrough-h">From search to live site, in 8 frames.</h2>
            <p class="section-sub">
              1920×1080 cinematic renders. Free for editorial use with credit
              <q>ProjectSites.dev / Megabyte Labs</q>. Right-click → save, or grab the ZIP at
              <a routerLink="/brand">/brand</a>.
            </p>
          </header>

          <ol class="slides" role="list">
            @for (slide of slides; track slide.n) {
              <li class="slide" [id]="'slide-' + slide.n" role="listitem">
                <figure>
                  <img
                    [src]="slide.src"
                    [alt]="slide.alt"
                    width="1920"
                    height="1080"
                    [attr.loading]="slide.n === 1 ? 'eager' : 'lazy'"
                    [attr.fetchpriority]="slide.n === 1 ? 'high' : 'auto'"
                    decoding="async"
                  />
                  <figcaption>
                    <span class="slide-n">{{ pad(slide.n) }}</span>
                    <div class="slide-body">
                      <h3>{{ slide.title }}</h3>
                      <p>{{ slide.caption }}</p>
                    </div>
                    <a
                      class="slide-dl"
                      [href]="slide.src"
                      [download]="'projectsites-' + slide.slug + '.jpg'"
                    >
                      Download ↓
                    </a>
                  </figcaption>
                </figure>
              </li>
            }
          </ol>
        </section>

        <!-- FACT SHEET -->
        <section class="fact-sheet" aria-labelledby="facts-h">
          <header class="section-head">
            <p class="eyebrow">One-page fact sheet</p>
            <h2 id="facts-h">The 60-second briefing.</h2>
          </header>

          <div class="fact-grid">
            <article class="card">
              <h3>What it is</h3>
              <p>
                ProjectSites is an AI-native website builder that turns a single Google Places
                lookup plus a short brand brief into a deployed, magazine-grade business website in
                under 15 minutes — hosted on Cloudflare, edited in-browser, with WCAG 2.2 AA, SEO,
                PWA, and AI search optimization baked in by default.
              </p>
            </article>
            <article class="card">
              <h3>Who it&apos;s for</h3>
              <p>
                Real-world businesses: restaurants, salons, nonprofits, healthcare providers,
                lawyers, local services. Anyone who&apos;d otherwise pay $5k–$25k for an agency
                build and wait 8–12 weeks. We ship the same outcome in 15 minutes for a fraction of
                the price.
              </p>
            </article>
            <article class="card">
              <h3>How it works</h3>
              <p>
                Six AI passes (research → brand → structure → copy → media → polish) run in parallel
                inside Cloudflare Workers + Workers AI. Output is a Vite + React 19 + Tailwind v4
                site with shadcn/ui components, served from Cloudflare Workers + R2 over the edge
                network.
              </p>
            </article>
            <article class="card">
              <h3>What&apos;s different</h3>
              <p>
                No stock-image slop, no lorem ipsum, no <q>coming soon</q> placeholders. Every site
                ships with real content, real photography (sourced from your Google Places listing
                first), real performance (LCP ≤ 2.0s), and real accessibility (axe-core 0 violations
                at 6 breakpoints).
              </p>
            </article>
            <article class="card">
              <h3>By the numbers</h3>
              <ul class="num-list">
                <li>Avg build time: <b>8m 12s</b></li>
                <li>Sites shipped: <b>1,024+</b></li>
                <li>Edge uptime: <b>99.99%</b></li>
                <li>Avg Lighthouse: <b>96 / 100</b></li>
                <li>Integrations: <b>31</b> OAuth providers</li>
                <li>Founded: <b>January 2026</b></li>
                <li>Team: <b>Solo founder</b> + AI agents</li>
              </ul>
            </article>
            <article class="card">
              <h3>Tech stack</h3>
              <p>
                Cloudflare Workers · D1 · R2 · KV · Workers AI · Workflows v2 · Containers · Vite ·
                React 19 · Tailwind v4 · shadcn/ui · Hono · Drizzle · Clerk · Resend · Stripe ·
                Square · Sentry · PostHog · Bolt.diy (in-browser editor). Open-source-first.
              </p>
            </article>
          </div>

          <p class="fact-foot">
            Need PDF fact sheet, investor deck, or product roadmap?
            <a href="mailto:press@megabyte.space">Email press&#64;megabyte.space</a> — we respond
            within 24 hours.
          </p>
        </section>

        <!-- FOUNDER -->
        <section class="founder" id="founder" aria-labelledby="founder-h">
          <header class="section-head">
            <p class="eyebrow">The founder</p>
            <h2 id="founder-h">Meet Brian.</h2>
          </header>

          <div class="founder-card">
            <div class="founder-avatar" aria-hidden="true">BZ</div>
            <div class="founder-body">
              <h3>Brian Zalewski</h3>
              <p class="founder-role">Founder &amp; Principal Engineer · Megabyte Labs</p>
              <p>
                Brian is a Principal Software Engineer (14 yrs) building solo with AI. Megabyte Labs
                is the umbrella for his AI-native product work — ProjectSites is the flagship.
                Previously: open-source maintainer (200+ GitHub repos), Cloudflare early adopter,
                Claude Agent SDK power user.
              </p>
              <p class="boilerplate-lead">Boilerplate for press releases:</p>
              <blockquote class="boilerplate">
                ProjectSites by Megabyte Labs is an AI-native website builder for real-world
                businesses. Founded January 2026 by principal engineer Brian Zalewski, ProjectSites
                ships gorgeous, fully-optimized business websites in under 15 minutes — hosted on
                Cloudflare, edited in-browser, and built to rank in Google + ChatGPT from day one.
              </blockquote>
              <ul class="founder-links" role="list">
                <li><a href="https://x.com/MegabyteLabs" rel="noopener">&#64;MegabyteLabs</a></li>
                <li>
                  <a href="https://github.com/blzalewski" rel="noopener">github.com/blzalewski</a>
                </li>
                <li>
                  <a href="https://www.linkedin.com/in/brianzalewski" rel="noopener">LinkedIn</a>
                </li>
                <li>
                  <a href="mailto:brian@megabyte.space" class="email-link"
                    >brian&#64;megabyte.space</a
                  >
                </li>
              </ul>
            </div>
          </div>
        </section>

        <!-- BRAND ASSETS -->
        <section class="brand-assets" id="brand-assets" aria-labelledby="brand-h">
          <header class="section-head">
            <p class="eyebrow">Brand assets</p>
            <h2 id="brand-h">Logo, colors, type.</h2>
          </header>

          <div class="asset-grid">
            <article class="card">
              <h3>Logo</h3>
              <div class="asset-canvas asset-canvas-light">
                <img src="/logo.svg" alt="ProjectSites logo" height="60" />
              </div>
              <ul class="asset-list" role="list">
                <li><a href="/logo.svg" download>logo.svg (full color)</a></li>
                <li><a href="/logo-icon.svg" download>logo-icon.svg (monogram)</a></li>
                <li><a href="/logo-header.svg" download>logo-header.svg (horizontal)</a></li>
                <li><a href="/logo-header.png" download>logo-header.png (PNG)</a></li>
              </ul>
            </article>

            <article class="card">
              <h3>Color palette</h3>
              <div class="palette">
                <div
                  class="swatch"
                  style="background:#060610;color:#f4f4ff;border:1px solid rgba(244,244,255,.14)"
                >
                  <b>Void</b><br />#060610
                </div>
                <div class="swatch" style="background:#00E5FF;color:#060610">
                  <b>Cyan</b><br />#00E5FF
                </div>
                <div class="swatch" style="background:#7C3AED;color:#fff">
                  <b>Violet</b><br />#7C3AED
                </div>
                <div class="swatch" style="background:#50AAE3;color:#060610">
                  <b>Sky</b><br />#50AAE3
                </div>
                <div class="swatch" style="background:#F4F4FF;color:#060610">
                  <b>Ink</b><br />#F4F4FF
                </div>
                <div class="swatch" style="background:#6EE7B7;color:#060610">
                  <b>Mint</b><br />#6EE7B7
                </div>
              </div>
              <p class="asset-note">All swatches in OKLCH.</p>
            </article>

            <article class="card">
              <h3>Typography</h3>
              <ul class="type-list" role="list">
                <li>
                  <span class="type-label">DISPLAY</span>
                  <div class="type-sample type-display">Sora — Aa Bb</div>
                </li>
                <li>
                  <span class="type-label">UI / BODY</span>
                  <div class="type-sample type-body">Space Grotesk — Aa Bb</div>
                </li>
                <li>
                  <span class="type-label">MONO / CODE</span>
                  <div class="type-sample type-mono">JetBrains Mono — Aa Bb</div>
                </li>
              </ul>
              <p class="asset-note">All three on Google Fonts.</p>
            </article>
          </div>

          <p class="usage-note">
            <b>Usage:</b> Don&apos;t recolor the logo. Don&apos;t stretch. Maintain 1× clear space.
            The wordmark is always <i>ProjectSites</i> (one word, camelCase). Avoid
            <q>Project Sites</q> (two words) or <q>projectsites.dev</q> in display use.
          </p>
        </section>

        <!-- PRESS RELEASES -->
        <section class="releases" id="releases" aria-labelledby="releases-h">
          <header class="section-head">
            <p class="eyebrow">Recent announcements</p>
            <h2 id="releases-h">Press releases.</h2>
          </header>

          <ul class="release-list" role="list">
            @for (r of releases; track r.date) {
              <li class="release">
                <header class="release-head">
                  <time [attr.datetime]="r.date">{{ r.dateLabel }}</time>
                  <span class="release-tag" [attr.data-tone]="r.tone">{{ r.tag }}</span>
                </header>
                <h3>{{ r.title }}</h3>
                <p>{{ r.summary }}</p>
              </li>
            }
          </ul>

          <p class="releases-foot">
            Subscribe via <a href="/feed.xml">RSS</a> or
            <a href="mailto:press@megabyte.space?subject=Press list">press&#64;megabyte.space</a>.
          </p>
        </section>

        <!-- MEDIA CONTACT -->
        <section class="contacts" id="contact" aria-labelledby="contact-h">
          <header class="section-head">
            <p class="eyebrow">Press inquiries</p>
            <h2 id="contact-h">Talk to a human.</h2>
            <p class="section-sub">Direct line — no PR firm in the middle.</p>
          </header>

          <div class="contact-card">
            <div class="contact-grid">
              <div>
                <b>Press &amp; media</b>
                <div><a href="mailto:press@megabyte.space">press&#64;megabyte.space</a></div>
              </div>
              <div>
                <b>Founder direct</b>
                <div><a href="mailto:brian@megabyte.space">brian&#64;megabyte.space</a></div>
              </div>
              <div>
                <b>Partnerships</b>
                <div><a href="mailto:partners@megabyte.space">partners&#64;megabyte.space</a></div>
              </div>
              <div>
                <b>Investors</b>
                <div><a href="mailto:invest@megabyte.space">invest&#64;megabyte.space</a></div>
              </div>
            </div>
          </div>
          <p class="contact-foot">
            Response time: typically &lt;24h on weekdays, &lt;48h on weekends.
          </p>
        </section>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        background: var(--ps-bg, #060610);
        color: var(--ps-ink, #f4f4ff);
      }

      .press-page {
        min-height: 100vh;
        padding: 56px 24px 96px;
      }

      .container {
        max-width: 1240px;
        margin: 0 auto;
      }

      .eyebrow {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--ps-accent, #00e5ff);
        margin: 0 0 12px;
      }

      h1 {
        font-size: clamp(2.2rem, 5vw, 3.5rem);
        font-weight: 700;
        letter-spacing: -0.03em;
        line-height: 1.05;
        margin: 0 0 16px;
        max-width: 22ch;
        text-wrap: balance;
      }

      h2 {
        font-size: clamp(1.5rem, 3.5vw, 2.2rem);
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.1;
        margin: 0 0 12px;
        text-wrap: balance;
      }

      h3 {
        font-size: 1.2rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        margin: 0 0 8px;
      }

      .subtitle,
      .section-sub {
        font-size: 1.05rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent);
        line-height: 1.55;
        max-width: 60ch;
      }

      .press-hero {
        margin-bottom: 72px;
      }

      .breadcrumb {
        font-size: 0.85rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
        margin: 0 0 16px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .breadcrumb a {
        color: color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, var(--ps-ink, #f4f4ff));
        text-decoration: none;
        transition: color 0.15s;
      }

      .breadcrumb a:hover {
        color: var(--ps-accent, #00e5ff);
      }

      .cta-row {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
        margin-top: 28px;
      }

      .cta-primary,
      .cta-secondary {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 12px 22px;
        border-radius: var(--ps-radius-xl, 22px);
        font-weight: 600;
        font-size: 0.98rem;
        text-decoration: none;
        transition:
          transform 0.18s,
          box-shadow 0.2s;
      }

      .cta-primary {
        background: var(--ps-accent, #00e5ff);
        color: var(--ps-bg, #060610);
        box-shadow: 0 6px 18px color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent);
      }

      .cta-primary:hover {
        transform: translateY(-1px);
      }

      .cta-secondary {
        background: color-mix(in oklch, var(--ps-bg, #060610) 92%, var(--ps-ink, #f4f4ff));
        color: var(--ps-ink, #f4f4ff);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 14%, transparent);
      }

      .cta-secondary:hover {
        border-color: var(--ps-accent, #00e5ff);
      }

      .section-head {
        margin-bottom: 32px;
      }

      .walkthrough,
      .fact-sheet,
      .founder,
      .brand-assets,
      .releases,
      .contacts {
        margin-bottom: 80px;
      }

      .slides {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 56px;
      }

      .slide figure {
        margin: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 20px;
      }

      .slide img {
        width: 100%;
        height: auto;
        border-radius: var(--ps-radius-xl, 22px);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 14%, transparent);
        background: color-mix(in oklch, var(--ps-bg, #060610) 88%, var(--ps-ink, #f4f4ff));
      }

      .slide figcaption {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 20px;
        align-items: center;
      }

      .slide-n {
        font-family: var(--ps-font-mono, 'JetBrains Mono', monospace);
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--ps-accent, #00e5ff);
        padding: 6px 12px;
        border-radius: 999px;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 10%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 25%, transparent);
        white-space: nowrap;
      }

      .slide-body h3 {
        margin: 0 0 4px;
      }

      .slide-body p {
        margin: 0;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent);
        font-size: 0.96rem;
      }

      .slide-dl {
        font-size: 0.88rem;
        padding: 8px 14px;
        border-radius: 999px;
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 14%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent);
        text-decoration: none;
        white-space: nowrap;
      }

      .slide-dl:hover {
        border-color: var(--ps-accent, #00e5ff);
        color: var(--ps-ink, #f4f4ff);
      }

      .fact-grid,
      .asset-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
      }

      .card {
        padding: 24px;
        border-radius: var(--ps-radius-lg, 18px);
        background: color-mix(in oklch, var(--ps-bg, #060610) 88%, var(--ps-ink, #f4f4ff));
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
        transition:
          border-color 0.2s,
          transform 0.2s;
      }

      .card:hover {
        border-color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 14%, transparent);
        transform: translateY(-2px);
      }

      .card p {
        font-size: 0.96rem;
        line-height: 1.55;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 72%, transparent);
        margin: 0;
      }

      .num-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 6px;
        font-size: 0.95rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 72%, transparent);
      }

      .num-list b {
        color: var(--ps-ink, #f4f4ff);
        font-variant-numeric: tabular-nums;
      }

      .fact-foot,
      .releases-foot,
      .contact-foot,
      .usage-note,
      .asset-note {
        font-size: 0.92rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent);
        margin: 24px 0 0;
      }

      .founder-card {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 32px;
        padding: 32px;
        border-radius: var(--ps-radius-lg, 18px);
        background: color-mix(in oklch, var(--ps-bg, #060610) 88%, var(--ps-ink, #f4f4ff));
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
      }

      @media (max-width: 640px) {
        .founder-card {
          grid-template-columns: 1fr;
        }
      }

      .founder-avatar {
        width: 120px;
        height: 120px;
        border-radius: 24px;
        background: linear-gradient(135deg, var(--ps-accent, #00e5ff), var(--ps-violet, #7c3aed));
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--ps-bg, #060610);
        font-weight: 800;
        font-size: 3rem;
        letter-spacing: -0.02em;
      }

      .founder-role {
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent);
        margin: 4px 0 16px;
      }

      .boilerplate-lead {
        margin: 18px 0 8px;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent);
        font-size: 0.92rem;
      }

      .boilerplate {
        margin: 0;
        padding: 14px 18px;
        border-left: 3px solid var(--ps-accent, #00e5ff);
        background: color-mix(in oklch, var(--ps-bg, #060610) 94%, var(--ps-accent, #00e5ff));
        border-radius: 10px;
        font-style: italic;
        line-height: 1.55;
      }

      .founder-links {
        list-style: none;
        padding: 0;
        margin: 16px 0 0;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .founder-links a {
        display: inline-flex;
        align-items: center;
        padding: 6px 12px;
        border-radius: 999px;
        background: color-mix(in oklch, var(--ps-bg, #060610) 88%, var(--ps-ink, #f4f4ff));
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 14%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent);
        font-size: 0.85rem;
        text-decoration: none;
      }

      .founder-links .email-link {
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 10%, transparent);
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent);
        color: color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, var(--ps-ink, #f4f4ff));
      }

      .asset-canvas {
        padding: 32px;
        border-radius: 14px;
        margin: 12px 0 16px;
        text-align: center;
      }

      .asset-canvas-light {
        background: #fff;
      }

      .asset-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 6px;
        font-size: 0.9rem;
      }

      .asset-list a {
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 80%, transparent);
        text-decoration: underline;
        text-decoration-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent);
        text-underline-offset: 3px;
      }

      .asset-list a:hover {
        color: var(--ps-accent, #00e5ff);
      }

      .palette {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin: 12px 0 12px;
      }

      .swatch {
        padding: 14px 12px;
        border-radius: 10px;
        font-family: var(--ps-font-mono, 'JetBrains Mono', monospace);
        font-size: 0.78rem;
        line-height: 1.4;
      }

      .type-list {
        list-style: none;
        padding: 0;
        margin: 12px 0 0;
        display: grid;
        gap: 14px;
      }

      .type-label {
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.14em;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent);
      }

      .type-sample {
        font-size: 1.4rem;
        line-height: 1.2;
        margin-top: 4px;
      }

      .type-display {
        font-family: var(--ps-font-display, 'Sora', sans-serif);
        font-weight: 600;
      }

      .type-body {
        font-family: var(--ps-font-body, 'Space Grotesk', sans-serif);
      }

      .type-mono {
        font-family: var(--ps-font-mono, 'JetBrains Mono', monospace);
      }

      .release-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 14px;
        max-width: 820px;
      }

      .release {
        padding: 22px;
        border-radius: var(--ps-radius-lg, 18px);
        background: color-mix(in oklch, var(--ps-bg, #060610) 88%, var(--ps-ink, #f4f4ff));
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
      }

      .release-head {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-bottom: 8px;
        font-size: 0.85rem;
      }

      .release-head time {
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
      }

      .release-tag {
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 0.78rem;
        font-weight: 500;
        background: color-mix(in oklch, var(--ps-bg, #060610) 80%, var(--ps-ink, #f4f4ff));
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 14%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent);
      }

      .release-tag[data-tone='accent'] {
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent);
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent);
        color: color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, var(--ps-ink, #f4f4ff));
      }

      .release-tag[data-tone='violet'] {
        background: color-mix(in oklch, var(--ps-violet, #7c3aed) 12%, transparent);
        border-color: color-mix(in oklch, var(--ps-violet, #7c3aed) 30%, transparent);
        color: color-mix(in oklch, var(--ps-violet, #7c3aed) 70%, var(--ps-ink, #f4f4ff));
      }

      .release h3 {
        margin: 0 0 6px;
        font-size: 1.1rem;
      }

      .release p {
        margin: 0;
        font-size: 0.95rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent);
        line-height: 1.55;
      }

      .contact-card {
        padding: 28px;
        border-radius: var(--ps-radius-lg, 18px);
        background: color-mix(in oklch, var(--ps-bg, #060610) 88%, var(--ps-ink, #f4f4ff));
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
      }

      .contact-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 18px;
        font-size: 0.96rem;
      }

      .contact-grid b {
        display: block;
        margin-bottom: 4px;
        color: var(--ps-ink, #f4f4ff);
      }

      .contact-grid a {
        color: color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, var(--ps-ink, #f4f4ff));
        text-decoration: none;
      }

      .contact-grid a:hover {
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      @media (prefers-reduced-motion: reduce) {
        .cta-primary,
        .cta-secondary,
        .card {
          transition: none;
        }
      }
    `,
  ],
})
export class PressComponent implements OnInit {
  private readonly meta = inject(MetaService);

  ngOnInit(): void {
    const url = `${BASE_URL}/press`;
    this.meta.setJsonLd(
      graph([
        organization(),
        softwareApplication(),
        person({
          id: `${BASE_URL}/about#brian`,
          name: 'Brian Zalewski',
          jobTitle: 'Founder & Principal Engineer',
          sameAs: [
            'https://github.com/blzalewski',
            'https://x.com/MegabyteLabs',
            'https://www.linkedin.com/in/brianzalewski',
          ],
        }),
        breadcrumbList([
          { name: 'Home', url: `${BASE_URL}/` },
          { name: 'Press', url },
        ]),
        webPage({
          url,
          title: 'Press kit — ProjectSites',
          description:
            'Brand assets, founder bio, fact sheet, 8-slide cinematic picture walkthrough, press releases, and media contacts for ProjectSites by Megabyte Labs.',
          image: `${BASE_URL}/walkthrough/08-live.jpg`,
        }),
      ]),
    );
  }

  protected readonly slides: readonly Slide[] = [
    {
      n: 1,
      slug: 'search',
      title: 'Find your business.',
      caption: 'Type your name, address, or storefront. We surface real listings in 300ms.',
      src: '/walkthrough/01-search.jpg',
      alt: 'Glass-morphism search bar floating in dark cinematic void with three business suggestion cards below',
    },
    {
      n: 2,
      slug: 'select',
      title: 'Pick the one that’s yours.',
      caption:
        'Logo, address, ratings already pulled. One click and we know who we’re building for.',
      src: '/walkthrough/02-select.jpg',
      alt: 'Premium frosted business profile card with circular logo, name, address, rating row, and cyan CTA button',
    },
    {
      n: 3,
      slug: 'brief',
      title: 'Brand it in 30 seconds.',
      caption: 'Drop a logo, choose colors, describe the vibe. The AI does the rest.',
      src: '/walkthrough/03-brief.jpg',
      alt: 'Upload modal with drag-drop zone, three brand color swatches, description field, and Generate CTA',
    },
    {
      n: 4,
      slug: 'generate',
      title: 'Six AI passes, one site.',
      caption:
        'Research, voice, design, code, deploy, verify. Each pass measurably improves the site.',
      src: '/walkthrough/04-generate.jpg',
      alt: 'Six glowing node cards arranged in arc with monoline icons and progress bars, connected by cyan trace lines',
    },
    {
      n: 5,
      slug: 'preview',
      title: 'Watch it come alive.',
      caption:
        'Magazine-quality photography, real content, gorgeous typography. Live in under 15 minutes.',
      src: '/walkthrough/05-preview.jpg',
      alt: 'Browser window mockup showing a generated restaurant homepage with hero dish photograph and reservation CTA',
    },
    {
      n: 6,
      slug: 'edit',
      title: 'Tweak anything, instantly.',
      caption: 'Edit code or chat with the AI in the browser. No deploy step.',
      src: '/walkthrough/06-edit.jpg',
      alt: 'Split-screen IDE mockup with dark-theme code editor on left and live website preview on right',
    },
    {
      n: 7,
      slug: 'deploy',
      title: 'Bring your own domain.',
      caption: 'We mint SSL, set up DNS, and verify in under a minute.',
      src: '/walkthrough/07-deploy.jpg',
      alt: 'DNS configuration card with custom-domain pill, green Verified badge, and three DNS record rows',
    },
    {
      n: 8,
      slug: 'live',
      title: 'Live on every device.',
      caption: 'Laptop, tablet, phone — the same gorgeous brand everywhere.',
      src: '/walkthrough/08-live.jpg',
      alt: 'Cinematic shot of MacBook, iPad mini, and iPhone arranged on dark reflective stage, all showing the same restaurant brand',
    },
  ];

  protected readonly releases = [
    {
      date: '2026-05-25',
      dateLabel: 'May 25, 2026',
      tag: 'Design',
      tone: 'violet',
      title: 'New cinematic homepage + 8-slide picture walkthrough',
      summary:
        'A full visual story from search to ship — 1920×1080 cinematic frames available for editorial use.',
    },
    {
      date: '2026-05-25',
      dateLabel: 'May 25, 2026',
      tag: 'Product',
      tone: 'default',
      title: '31 OAuth integrations now live: Stripe, Square, Notion, Linear, Sentry, and 26 more',
      summary: 'Connect your business stack with one click. Full list at /integrations.',
    },
    {
      date: '2026-05-24',
      dateLabel: 'May 24, 2026',
      tag: 'Launch',
      tone: 'accent',
      title: 'ProjectSites ships v1.0 — AI-native website builder for real businesses',
      summary:
        'Megabyte Labs announces general availability of ProjectSites, an AI-native website builder that ships magazine-grade business websites in under 15 minutes.',
    },
  ];

  protected pad(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
  }
}
