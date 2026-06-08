/**
 * Getting Started hub at `/admin`.
 *
 * Replaces the former Perplexity-like AI chat dashboard. Instead of a
 * conversation surface, this is an orientation page: it introduces every
 * admin section grouped by purpose, surfaces tips + keyboard tricks, and
 * links out to the places a customer is most likely heading next.
 *
 * The cross-route admin chrome (route progress, topbar extras, floating AI
 * FAB, drawers) still mounts here via {@link AdminUpgradesShellComponent} so
 * it renders across every `/admin/*` route through the persistent host.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RevealDirective } from '../../../directives/reveal.directive';
import { AdminUpgradesShellComponent } from '../../../components/admin-upgrades/admin-upgrades-shell.component';
import { CmdGlyphComponent } from '../../../components/cmd-glyph/cmd-glyph.component';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { AdminStateService } from '../admin-state.service';
import { AuthService } from '../../../services/auth.service';
import { isSysAdminEmail } from '../sys-admin';

interface SectionCard {
  label: string;
  desc: string;
  link: string;
  glyph: string;
}

interface SectionGroup {
  title: string;
  cards: readonly SectionCard[];
}

interface Tip {
  glyph: string;
  text: string;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RevealDirective, AdminUpgradesShellComponent, CmdGlyphComponent, RollingCounterComponent],
  template: `
    <section class="dash" aria-label="Getting started">
      <!-- Persistent admin chrome (route progress, topbar extras, AI FAB,
           drawers) — mounted here so it renders across every /admin/* route. -->
      <app-admin-upgrades-shell></app-admin-upgrades-shell>

      <!-- ── Welcome hero ─────────────────────────────────────── -->
      <header class="hero" appReveal>
        <div class="halo" aria-hidden="true"></div>
        <p class="eyebrow">Getting started</p>
        <h1 class="h">Welcome to your command center</h1>
        <p class="s">
          Everything you can do with your sites lives here. Explore a section below, pick up a
          keyboard trick, or jump straight back into the editor.
        </p>

        <div class="hero-actions">
          @if (hasSites()) {
            <a class="cta cta-primary" routerLink="/admin/editor" data-testid="dash-resume">
              <app-cmd-glyph name="code" /> Open the editor
            </a>
            <a class="cta cta-ghost" routerLink="/create">Create a new site</a>
          } @else {
            <a class="cta cta-primary" routerLink="/create" data-testid="dash-create-first">
              <app-cmd-glyph name="rocket" /> Create your first site
            </a>
          }
        </div>

        @if (hasSites()) {
          <p class="stat" aria-live="polite">
            <app-rolling-counter [value]="siteCount()" />
            {{ siteCount() === 1 ? 'site' : 'sites' }} in your account
          </p>
        }
      </header>

      <!-- Two-layer feature plane discovery banner. LAYER 2 "Features"
           (owner-facing, site-scoped) shows to everyone; LAYER 1 "Feature Flags"
           (platform-ops flags) is operator-only. -->
      <section class="features-banner" role="navigation" aria-label="Feature control plane">
        <a class="features-banner-card" routerLink="/admin/site-features" data-testid="dash-features-card">
          <span class="features-banner-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg></span>
          <span class="features-banner-body">
            <strong>Features</strong>
            <span class="features-banner-sub">Turn site capabilities on for your hosted site — plan-aware, previewable, undoable. Upgrade-locked add-ons surface here.</span>
          </span>
          <span class="features-banner-cta" aria-hidden="true">→</span>
        </a>
        @if (isSysAdmin()) {
        <a class="features-banner-card features-banner-card-alt" routerLink="/admin/feature-flags" data-testid="dash-system-admin-card">
          <span class="features-banner-icon features-banner-icon--alt" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></span>
          <span class="features-banner-body">
            <strong>Feature Flags</strong>
            <span class="features-banner-sub">Platform-ops control plane — toggle, roll out, killswitch 50+ feature flags. Stage filter, per-flag inspect, hash-chain audit trail.</span>
          </span>
          <span class="features-banner-cta" aria-hidden="true">→</span>
        </a>
        }
      </section>

      <!-- ── Section guide ────────────────────────────────────── -->
      @for (group of groups; track group.title) {
        <section class="group" appReveal aria-labelledby="grp-{{ $index }}">
          <h2 class="group-title" id="grp-{{ $index }}">{{ group.title }}</h2>
          <ul class="cards">
            @for (card of group.cards; track card.link) {
              <li>
                <a class="sec-card" [routerLink]="card.link" [attr.data-testid]="'dash-sec-' + card.glyph">
                  <span class="sec-glyph" aria-hidden="true"><app-cmd-glyph [name]="card.glyph" /></span>
                  <span class="sec-body">
                    <strong class="sec-label">{{ card.label }}</strong>
                    <span class="sec-desc">{{ card.desc }}</span>
                  </span>
                  <span class="sec-cta" aria-hidden="true">→</span>
                </a>
              </li>
            }
          </ul>
        </section>
      }

      <!-- ── Tips & tricks ────────────────────────────────────── -->
      <section class="group" appReveal aria-labelledby="grp-tips">
        <h2 class="group-title" id="grp-tips">Tips &amp; tricks</h2>
        <ul class="tips">
          @for (tip of tips; track tip.text) {
            <li class="tip">
              <span class="tip-glyph" aria-hidden="true"><app-cmd-glyph [name]="tip.glyph" /></span>
              <span class="tip-text">{{ tip.text }}</span>
            </li>
          }
        </ul>
      </section>

      <!-- ── Helpful links ────────────────────────────────────── -->
      <section class="group links-group" appReveal aria-labelledby="grp-links">
        <h2 class="group-title" id="grp-links">Need a hand?</h2>
        <nav class="links" aria-label="Helpful links">
          <a routerLink="/admin/docs"><app-cmd-glyph name="book" /> Read the API docs</a>
          <a routerLink="/admin/sites"><app-cmd-glyph name="grid" /> Browse all your sites</a>
          <a routerLink="/admin/user"><app-cmd-glyph name="gear" /> Account &amp; preferences</a>
          <a routerLink="/contact"><app-cmd-glyph name="life-buoy" /> Contact support</a>
        </nav>
      </section>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
        min-height: calc(100vh - 64px);
      }
      .dash {
        position: relative;
        padding: 28px 24px 96px;
        max-width: 1100px;
        margin: 0 auto;
        color: var(--ps-ink, #f4f4ff);
      }

      /* Hero */
      .hero {
        text-align: center;
        padding: 56px 12px 12px;
        position: relative;
      }
      .halo {
        position: absolute;
        inset: -40px 10% auto 10%;
        height: 280px;
        background:
          radial-gradient(ellipse 60% 100% at 50% 0%, rgba(0, 229, 255, 0.18), transparent 70%),
          radial-gradient(ellipse 40% 80% at 30% 30%, rgba(124, 58, 237, 0.18), transparent 70%);
        filter: blur(40px);
        z-index: -1;
        pointer-events: none;
      }
      .eyebrow {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.72rem;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--ps-accent, #00e5ff) 80%, var(--ps-ink, #f4f4ff) 20%);
        margin: 0 0 8px;
      }
      .h {
        font-family: 'Sora', system-ui, sans-serif;
        font-size: clamp(1.9rem, 4vw, 3.1rem);
        font-weight: 600;
        letter-spacing: -0.02em;
        margin: 0 0 14px;
        background: linear-gradient(135deg, #00e5ff 0%, #7c3aed 50%, #f4f4ff 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        text-wrap: balance;
      }
      .s {
        font-size: 1rem;
        opacity: 0.75;
        max-width: 600px;
        margin: 0 auto;
        text-wrap: pretty;
        line-height: 1.55;
      }
      .hero-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: center;
        margin: 26px 0 0;
      }
      .cta {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 0 20px;
        border-radius: 999px;
        font: inherit;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
        transition:
          transform 180ms ease,
          box-shadow 180ms ease,
          border-color 180ms ease;
      }
      .cta app-cmd-glyph {
        font-size: 1.05rem;
      }
      .cta-primary {
        background: linear-gradient(135deg, #00e5ff, #7c3aed);
        color: #060610;
      }
      .cta-primary:hover {
        transform: translateY(-1px);
        box-shadow: 0 16px 36px -16px rgba(0, 229, 255, 0.6);
      }
      .cta-ghost {
        background: rgba(0, 229, 255, 0.05);
        border: 1px solid rgba(0, 229, 255, 0.22);
        color: var(--ps-ink, #f4f4ff);
      }
      .cta-ghost:hover {
        transform: translateY(-1px);
        border-color: rgba(0, 229, 255, 0.5);
      }
      .cta:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 2px;
      }
      .stat {
        margin: 18px 0 0;
        font-size: 0.9rem;
        opacity: 0.7;
      }
      .stat app-rolling-counter {
        font-weight: 700;
        color: var(--ps-accent, #00e5ff);
        font-variant-numeric: tabular-nums;
      }

      /* Features banner (unchanged discovery surface) */
      .features-banner {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.85rem;
        padding: 1.5rem 0 0;
      }
      @media (max-width: 720px) {
        .features-banner {
          grid-template-columns: 1fr;
        }
      }
      .features-banner-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem 1.15rem;
        background: color-mix(in oklch, var(--ps-bg, #060610) 50%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent);
        border-radius: 14px;
        text-decoration: none;
        color: inherit;
        transition:
          border-color 0.15s ease,
          transform 0.15s ease;
      }
      .features-banner-card:hover {
        border-color: var(--ps-accent, #00e5ff);
        transform: translateY(-1px);
      }
      .features-banner-card:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 2px;
      }
      .features-banner-card-alt {
        border-color: color-mix(in oklch, #fbbf24 30%, transparent);
      }
      .features-banner-card-alt:hover {
        border-color: #fbbf24;
      }
      .features-banner-icon {
        flex-shrink: 0;
        display: inline-flex;
        color: var(--ps-accent, #00e5ff);
      }
      .features-banner-icon svg {
        width: 26px;
        height: 26px;
        display: block;
      }
      .features-banner-icon--alt {
        color: #fbbf24;
      }
      .features-banner-body {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        flex: 1;
      }
      .features-banner-body strong {
        font-size: 1.05rem;
      }
      .features-banner-sub {
        font-size: 0.8rem;
        color: color-mix(in oklch, currentColor 65%, transparent);
        line-height: 1.45;
      }
      .features-banner-cta {
        font-size: 1.4rem;
        opacity: 0.65;
      }
      .features-banner-card:hover .features-banner-cta {
        opacity: 1;
      }

      /* Section groups */
      .group {
        margin-top: 38px;
      }
      .group-title {
        font-family: 'Sora', system-ui, sans-serif;
        font-size: 1.05rem;
        font-weight: 600;
        margin: 0 0 14px;
        letter-spacing: -0.01em;
      }
      .cards {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
        gap: 12px;
      }
      .sec-card {
        display: flex;
        align-items: flex-start;
        gap: 13px;
        height: 100%;
        padding: 15px 16px;
        background: rgba(8, 8, 32, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        text-decoration: none;
        color: inherit;
        transition:
          border-color 0.15s ease,
          transform 0.15s ease,
          background 0.15s ease;
      }
      .sec-card:hover {
        border-color: rgba(0, 229, 255, 0.5);
        background: rgba(0, 229, 255, 0.04);
        transform: translateY(-2px);
      }
      .sec-card:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 2px;
      }
      .sec-glyph {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 38px;
        height: 38px;
        border-radius: 10px;
        font-size: 1.15rem;
        color: var(--ps-accent, #00e5ff);
        background: rgba(0, 229, 255, 0.08);
        border: 1px solid rgba(0, 229, 255, 0.18);
      }
      .sec-body {
        display: flex;
        flex-direction: column;
        gap: 3px;
        flex: 1;
        min-width: 0;
      }
      .sec-label {
        font-size: 0.95rem;
        font-weight: 600;
      }
      .sec-desc {
        font-size: 0.8rem;
        line-height: 1.45;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 62%, transparent);
        text-wrap: pretty;
      }
      .sec-cta {
        align-self: center;
        font-size: 1.1rem;
        opacity: 0;
        transform: translateX(-4px);
        transition:
          opacity 0.15s ease,
          transform 0.15s ease;
        color: var(--ps-accent, #00e5ff);
      }
      .sec-card:hover .sec-cta {
        opacity: 1;
        transform: translateX(0);
      }

      /* Tips */
      .tips {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
        gap: 12px;
      }
      .tip {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 13px 15px;
        background: rgba(124, 58, 237, 0.06);
        border: 1px solid rgba(124, 58, 237, 0.16);
        border-radius: 12px;
        font-size: 0.86rem;
        line-height: 1.4;
      }
      .tip-glyph {
        flex-shrink: 0;
        font-size: 1.05rem;
        color: color-mix(in oklch, #7c3aed 50%, var(--ps-ink, #f4f4ff) 50%);
      }

      /* Links */
      .links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .links a {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        padding: 0 15px;
        border-radius: 999px;
        background: rgba(8, 8, 32, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: var(--ps-ink, #f4f4ff);
        text-decoration: none;
        font-size: 0.85rem;
        transition:
          border-color 0.15s ease,
          transform 0.15s ease;
      }
      .links a app-cmd-glyph {
        font-size: 1rem;
        color: var(--ps-accent, #00e5ff);
      }
      .links a:hover {
        border-color: rgba(0, 229, 255, 0.5);
        transform: translateY(-1px);
      }
      .links a:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 2px;
      }

      @media (max-width: 720px) {
        .dash {
          padding: 18px 14px 72px;
        }
        .hero {
          padding: 32px 6px 8px;
        }
      }
    `,
  ],
})
export class AdminDashboardComponent {
  private state = inject(AdminStateService);
  private auth = inject(AuthService);

  /** Operator-only gate for the "Feature Flags" discovery card — mirrors the sidebar nav + sysAdminGuard. */
  readonly isSysAdmin = computed(() => isSysAdminEmail(this.auth.email()));
  readonly siteCount = computed(() => this.state.sites().length);
  readonly hasSites = computed(() => this.siteCount() > 0);

  /** Section guide, grouped by what a customer is trying to do. Every link resolves to a live admin route. */
  readonly groups: readonly SectionGroup[] = [
    {
      title: 'Build your site',
      cards: [
        { label: 'Editor', desc: 'Edit your site’s code and content in the live Bolt editor.', link: '/admin/editor', glyph: 'code' },
        { label: 'Snapshots', desc: 'Frozen versions of every build — preview, restore, or roll back.', link: '/admin/snapshots', glyph: 'camera' },
        { label: 'Media', desc: 'Upload, generate, and organize images, video, and audio.', link: '/admin/media', glyph: 'image' },
        { label: 'Domains', desc: 'Connect a custom domain and manage your hostnames.', link: '/admin/domains', glyph: 'globe' },
      ],
    },
    {
      title: 'Grow your audience',
      cards: [
        { label: 'Analytics', desc: 'Traffic, conversions, and funnel insight for every site.', link: '/admin/analytics', glyph: 'chart' },
        { label: 'SEO', desc: 'Titles, meta, structured data, and search readiness.', link: '/admin/seo', glyph: 'search' },
        { label: 'Social', desc: 'Compose, schedule, and measure posts across 11 networks.', link: '/admin/social', glyph: 'share' },
        { label: 'Forms', desc: 'Every form submission, routed and searchable.', link: '/admin/forms', glyph: 'inbox' },
      ],
    },
    {
      title: 'Operate & monitor',
      cards: [
        { label: 'Voice', desc: 'A phone number, SMS, and a browser test console.', link: '/admin/voice', glyph: 'phone' },
        { label: 'Apps', desc: 'A self-hostable app store on Cloudflare Containers.', link: '/admin/apps', glyph: 'grid' },
        { label: 'Traces', desc: 'Every AI call — forms, chat, endpoints, and search.', link: '/admin/traces', glyph: 'activity' },
        { label: 'Logs', desc: 'Audit trail plus structured request, AI, and job logs.', link: '/admin/logs', glyph: 'list' },
      ],
    },
    {
      title: 'Account & help',
      cards: [
        { label: 'Settings', desc: 'Site preferences, integrations, and notifications.', link: '/admin/settings', glyph: 'gear' },
        { label: 'Billing', desc: 'Your plan, credits, and invoices in one place.', link: '/admin/billing', glyph: 'credit-card' },
        { label: 'API Docs', desc: 'An interactive explorer — call any endpoint from your session.', link: '/admin/docs', glyph: 'book' },
        { label: 'Features', desc: 'Turn site capabilities on — plan-aware and reversible.', link: '/admin/site-features', glyph: 'layers' },
      ],
    },
  ];

  /** Keyboard + workflow tricks most customers never discover on their own. */
  readonly tips: readonly Tip[] = [
    { glyph: 'command', text: 'Press ⌘K (or Ctrl+K) to jump to any section or action instantly.' },
    { glyph: 'keyboard', text: 'Press ? anywhere to see the full list of keyboard shortcuts.' },
    { glyph: 'code', text: 'Type g then e to open the editor — g v opens Voice.' },
    { glyph: 'image', text: 'Drag a file onto any admin page to add it to your Media library.' },
  ];
}
