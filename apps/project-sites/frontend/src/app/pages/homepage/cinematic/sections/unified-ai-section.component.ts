import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { RevealDirective } from '../../../../directives/reveal.directive';
import { RollingCounterComponent } from '../../../../components/rolling-counter/rolling-counter.component';

interface Channel {
  readonly id: string;
  readonly icon: string;
  readonly title: string;
  readonly body: string;
}

interface Integration {
  readonly name: string;
  /** Single-letter monogram fallback — used as the chip glyph. */
  readonly glyph: string;
  /** Dominant-color hex used to tint the dark tile's inset ring. */
  readonly hue: string;
}

/**
 * Unified-AI marketing section — one AI brain across web chat, SMS, voice,
 * email, and 100+ MCP integrations. Sits between the cinematic hero and the
 * social-proof / stats strip on the landing page.
 *
 * @remarks
 * - `appReveal` on every direct child for staggered first-paint motion.
 * - Every numeric stat renders through `<app-rolling-counter>`
 *   (cinematic-ui-patterns mandate).
 * - All colors flow from `var(--ps-*)` brand tokens.
 * - Vanity-number teaser uses `font-variant-numeric: tabular-nums` so digits
 *   never reflow + a slow shimmer overlay (respecting reduced-motion).
 * - JSON-LD `Service` schema is emitted via a sanitized signal so search +
 *   AI crawlers index the offer at the section level.
 *
 * @example
 * ```html
 * <app-unified-ai-section />
 * ```
 */
@Component({
  selector: 'app-unified-ai-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RevealDirective, RollingCounterComponent],
  template: `
    <section
      class="ua-shell"
      role="region"
      [attr.aria-labelledby]="headingId"
      data-testid="unified-ai-section"
    >
      <!-- JSON-LD: Service schema -->
      <div class="ua-jsonld" aria-hidden="true" [innerHTML]="jsonLd()"></div>

      <!-- ── HEAD ───────────────────────────────────────── -->
      <header class="ua-head" appReveal>
        <span class="ua-eyebrow">One AI, every channel</span>
        <h2 class="ua-h" [id]="headingId">
          Your AI, on every line.
        </h2>
        <p class="ua-sub">
          Same AI brain across your website chat, SMS hotline, voice line, email
          replies, and 100+ integrations. Set it up once.
        </p>
      </header>

      <!-- ── 3-UP CHANNEL GRID ──────────────────────────── -->
      <ul class="ua-channels" appReveal [revealDelay]="120">
        @for (ch of channels; track ch.id; let i = $index) {
          <li
            class="ua-channel"
            appReveal
            [revealDelay]="160 + i * 80"
          >
            <span class="ua-channel-icon" aria-hidden="true">{{ ch.icon }}</span>
            <h3 class="ua-channel-title">{{ ch.title }}</h3>
            <p class="ua-channel-body">{{ ch.body }}</p>
          </li>
        }
      </ul>

      <!-- ── VANITY NUMBER TEASER ───────────────────────── -->
      <div
        class="ua-vanity"
        appReveal
        [revealDelay]="340"
        aria-label="(855) 82L-ABOR — example vanity phone number"
      >
        <span class="ua-vanity-eyebrow">Pick your own vanity line</span>
        <p class="ua-vanity-number" aria-hidden="true">
          <span class="ua-vanity-paren">(</span>855<span class="ua-vanity-paren">)</span>
          <span class="ua-vanity-sep">&nbsp;</span>82L-ABOR
        </p>
        <p class="ua-vanity-sub">
          We help you find a number that spells your brand.
        </p>
      </div>

      <!-- ── INTEGRATIONS ROW ───────────────────────────── -->
      <div class="ua-integrations" appReveal [revealDelay]="400">
        <span class="ua-integrations-eyebrow">Wired to the tools you already run</span>
        <ul class="ua-chips">
          @for (it of integrations; track it.name) {
            <li
              class="ua-chip"
              [style.--ua-chip-hue]="it.hue"
              [attr.aria-label]="it.name"
            >
              <span class="ua-chip-glyph" aria-hidden="true">{{ it.glyph }}</span>
              <span class="ua-chip-name">{{ it.name }}</span>
            </li>
          }
          <li class="ua-chip ua-chip--more" aria-label="100+ integrations">
            <span class="ua-chip-glyph" aria-hidden="true">+</span>
            <span class="ua-chip-name">100+ more</span>
          </li>
        </ul>
      </div>

      <!-- ── STATS ROW ──────────────────────────────────── -->
      <ul class="ua-stats" appReveal [revealDelay]="480">
        <li class="ua-stat" appReveal [revealDelay]="520">
          <span class="ua-stat-value">
            <app-rolling-counter [value]="100" suffix="+" />
          </span>
          <span class="ua-stat-label">integrations</span>
        </li>
        <li class="ua-stat" appReveal [revealDelay]="580">
          <span class="ua-stat-value">
            <app-rolling-counter [value]="24" />/<app-rolling-counter [value]="7" />
          </span>
          <span class="ua-stat-label">coverage</span>
        </li>
        <li class="ua-stat" appReveal [revealDelay]="640">
          <span class="ua-stat-value">
            <app-rolling-counter [value]="3" />
          </span>
          <span class="ua-stat-label">numbers per site</span>
        </li>
        <li class="ua-stat" appReveal [revealDelay]="700">
          <span class="ua-stat-value">
            &lt;<app-rolling-counter [value]="300" suffix="ms" />
          </span>
          <span class="ua-stat-label">answer latency</span>
        </li>
      </ul>

      <!-- ── CTAS ───────────────────────────────────────── -->
      <div class="ua-ctas" appReveal [revealDelay]="760">
        <a
          class="ua-cta ua-cta--primary"
          routerLink="/admin/voice"
          data-testid="unified-ai-cta-primary"
          data-bcl-action="ai_hotline_cta_click"
        >
          <span>Try the AI hotline</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </a>
        <a
          class="ua-cta ua-cta--secondary"
          href="#how-it-works"
          data-testid="unified-ai-cta-secondary"
        >
          See how it works
        </a>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        --ua-bg: var(--ps-bg, #060610);
        --ua-ink: var(--ps-ink, #f4f4ff);
        --ua-accent: var(--ps-accent, #00e5ff);
        --ua-accent-2: var(--ps-accent-secondary, #7c3aed);
      }

      .ua-jsonld {
        display: none;
      }

      .ua-shell {
        position: relative;
        isolation: isolate;
        margin: clamp(48px, 10vh, 112px) 0;
        padding: clamp(40px, 6vh, 72px) clamp(20px, 4vw, 48px);
        border-radius: var(--ps-radius-xl, 22px);
        border: 1px solid color-mix(in oklch, var(--ua-ink) 10%, transparent);
        background:
          radial-gradient(
            120% 100% at 0% 0%,
            color-mix(in oklch, var(--ua-accent) 18%, transparent) 0%,
            transparent 55%
          ),
          radial-gradient(
            100% 90% at 100% 100%,
            color-mix(in oklch, var(--ua-accent-2) 18%, transparent) 0%,
            transparent 60%
          ),
          linear-gradient(
            180deg,
            color-mix(in oklch, var(--ua-ink) 5%, transparent),
            color-mix(in oklch, var(--ua-ink) 2%, transparent)
          );
        overflow: hidden;
      }
      .ua-shell::before {
        content: '';
        position: absolute;
        inset: 0;
        background-image: radial-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px);
        background-size: 3px 3px;
        opacity: 0.6;
        pointer-events: none;
        z-index: -1;
      }

      /* ── HEAD ──────────────────────────────────────── */
      .ua-head {
        max-width: 760px;
        margin: 0 auto clamp(28px, 4vh, 44px);
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 12px;
        align-items: center;
      }
      .ua-eyebrow {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 11px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--ua-accent) 70%, var(--ua-ink) 30%);
      }
      .ua-h {
        margin: 0;
        font-family: 'Sora', system-ui, sans-serif;
        font-weight: 700;
        font-size: clamp(2rem, 4.6vw, 3.4rem);
        line-height: 1.04;
        letter-spacing: -0.022em;
        text-wrap: balance;
        background: linear-gradient(
          180deg,
          var(--ua-ink) 30%,
          color-mix(in oklch, var(--ua-ink) 70%, transparent 30%) 100%
        );
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }
      .ua-sub {
        margin: 0;
        font-size: clamp(0.98rem, 1.2vw, 1.1rem);
        line-height: 1.55;
        color: color-mix(in oklch, var(--ua-ink) 72%, transparent);
        text-wrap: pretty;
      }

      /* ── 3-UP CHANNELS ─────────────────────────────── */
      .ua-channels {
        list-style: none;
        margin: 0 0 clamp(28px, 4vh, 44px);
        padding: 0;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: clamp(14px, 1.6vw, 22px);
      }
      .ua-channel {
        position: relative;
        padding: clamp(18px, 2.4vw, 26px);
        border-radius: var(--ps-radius-xl, 22px);
        background:
          linear-gradient(
            180deg,
            color-mix(in oklch, var(--ua-ink) 5%, transparent),
            color-mix(in oklch, var(--ua-ink) 2%, transparent)
          ),
          var(--ua-bg);
        border: 1px solid color-mix(in oklch, var(--ua-ink) 10%, transparent);
        overflow: hidden;
        transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1),
          border-color 240ms ease;
      }
      .ua-channel::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        height: 2px;
        width: 100%;
        background: linear-gradient(
          90deg,
          color-mix(in oklch, var(--ua-accent) 90%, transparent),
          transparent 70%
        );
        opacity: 0.55;
      }
      @starting-style {
        .ua-channel {
          opacity: 0;
          transform: translateY(8px);
        }
      }
      .ua-channel:hover {
        transform: translateY(-3px);
        border-color: color-mix(in oklch, var(--ua-accent) 30%, transparent);
      }
      .ua-channel-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        line-height: 1;
        margin-bottom: 10px;
        filter: drop-shadow(0 2px 6px rgba(0, 229, 255, 0.18));
      }
      .ua-channel-title {
        margin: 0 0 6px;
        font-size: clamp(1.05rem, 1.5vw, 1.2rem);
        font-weight: 600;
        letter-spacing: -0.012em;
        color: var(--ua-ink);
      }
      .ua-channel-body {
        margin: 0;
        font-size: 0.94rem;
        line-height: 1.55;
        color: color-mix(in oklch, var(--ua-ink) 75%, transparent);
        text-wrap: pretty;
      }

      /* ── VANITY NUMBER ─────────────────────────────── */
      .ua-vanity {
        position: relative;
        margin: 0 auto clamp(28px, 4vh, 44px);
        max-width: 720px;
        padding: clamp(20px, 3vw, 32px);
        border-radius: var(--ps-radius-xl, 22px);
        text-align: center;
        background:
          linear-gradient(
            135deg,
            color-mix(in oklch, var(--ua-accent) 14%, transparent),
            color-mix(in oklch, var(--ua-accent-2) 12%, transparent)
          ),
          var(--ua-bg);
        border: 1px solid color-mix(in oklch, var(--ua-accent) 30%, transparent);
        overflow: hidden;
      }
      .ua-vanity-eyebrow {
        display: block;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 10.5px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--ua-accent) 75%, var(--ua-ink) 25%);
        margin-bottom: 10px;
      }
      .ua-vanity-number {
        margin: 0 0 10px;
        font-family: 'Sora', 'JetBrains Mono', system-ui, monospace;
        font-weight: 800;
        font-size: clamp(2.2rem, 6vw, 4rem);
        line-height: 1.05;
        letter-spacing: 0.04em;
        font-variant-numeric: tabular-nums;
        font-feature-settings: 'tnum' 1;
        background: linear-gradient(
          110deg,
          var(--ua-ink) 0%,
          color-mix(in oklch, var(--ua-accent) 85%, var(--ua-ink) 15%) 40%,
          var(--ua-ink) 65%,
          color-mix(in oklch, var(--ua-accent-2) 85%, var(--ua-ink) 15%) 100%
        );
        background-size: 200% 100%;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        animation: uaShimmer 6.5s linear infinite;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
      }
      .ua-vanity-paren {
        color: color-mix(in oklch, var(--ua-ink) 55%, transparent);
        font-weight: 500;
        -webkit-text-fill-color: color-mix(in oklch, var(--ua-ink) 55%, transparent);
      }
      .ua-vanity-sep {
        display: inline-block;
        width: 0.25em;
      }
      .ua-vanity-sub {
        margin: 0;
        font-size: 0.92rem;
        color: color-mix(in oklch, var(--ua-ink) 70%, transparent);
      }
      @keyframes uaShimmer {
        from { background-position: 200% 0; }
        to { background-position: -200% 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .ua-vanity-number { animation: none; }
      }

      /* ── INTEGRATIONS ──────────────────────────────── */
      .ua-integrations {
        margin: 0 0 clamp(28px, 4vh, 40px);
        text-align: center;
      }
      .ua-integrations-eyebrow {
        display: block;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--ua-ink) 55%, transparent);
        margin-bottom: 14px;
      }
      .ua-chips {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 10px 12px;
      }
      .ua-chip {
        --ua-chip-hue: var(--ua-accent);
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 8px 14px 8px 8px;
        border-radius: 999px;
        background: color-mix(in oklch, var(--ua-bg) 92%, var(--ua-ink) 8%);
        border: 1px solid color-mix(in oklch, var(--ua-ink) 12%, transparent);
        box-shadow:
          0 1px 2px rgba(0, 0, 0, 0.35),
          inset 0 0 0 1px color-mix(in oklch, var(--ua-chip-hue) 12%, transparent);
        color: color-mix(in oklch, var(--ua-ink) 88%, transparent);
        font-size: 0.86rem;
        font-weight: 600;
        letter-spacing: 0.01em;
        transition:
          border-color 220ms ease,
          transform 220ms cubic-bezier(0.16, 1, 0.3, 1),
          box-shadow 220ms ease;
      }
      .ua-chip:hover {
        transform: translateY(-2px);
        border-color: color-mix(in oklch, var(--ua-chip-hue) 60%, transparent);
        box-shadow:
          0 6px 18px rgba(0, 0, 0, 0.45),
          inset 0 0 0 1px color-mix(in oklch, var(--ua-chip-hue) 35%, transparent);
      }
      .ua-chip-glyph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: color-mix(in oklch, var(--ua-chip-hue) 88%, #000 12%);
        color: #ffffff;
        font-family: 'Sora', system-ui, sans-serif;
        font-weight: 800;
        font-size: 0.86rem;
        line-height: 1;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.18),
          0 1px 2px rgba(0, 0, 0, 0.35);
      }
      .ua-chip--more .ua-chip-glyph {
        background: color-mix(in oklch, var(--ua-ink) 88%, transparent);
        color: var(--ua-bg);
      }

      /* ── STATS ─────────────────────────────────────── */
      .ua-stats {
        list-style: none;
        margin: 0 0 clamp(28px, 4vh, 40px);
        padding: 0;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: clamp(10px, 1.4vw, 18px);
      }
      .ua-stat {
        display: flex;
        flex-direction: column;
        gap: 4px;
        align-items: center;
        text-align: center;
        padding: clamp(14px, 2vw, 22px) 10px;
        border-radius: var(--ps-radius-xl, 22px);
        background: color-mix(in oklch, var(--ua-ink) 4%, transparent);
        border: 1px solid color-mix(in oklch, var(--ua-ink) 8%, transparent);
      }
      .ua-stat-value {
        font-family: 'Sora', system-ui, sans-serif;
        font-weight: 700;
        font-size: clamp(1.6rem, 3.4vw, 2.4rem);
        line-height: 1;
        letter-spacing: -0.018em;
        color: oklch(from var(--ua-accent) max(l, 0.78) max(c, 0.22) h);
        display: inline-flex;
        align-items: baseline;
        gap: 2px;
      }
      .ua-stat-label {
        font-size: 0.82rem;
        font-weight: 500;
        color: color-mix(in oklch, var(--ua-ink) 70%, transparent);
        letter-spacing: 0;
      }

      /* ── CTAS ──────────────────────────────────────── */
      .ua-ctas {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 14px;
      }
      .ua-cta {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 0 22px;
        border-radius: 999px;
        font-weight: 600;
        font-size: 0.95rem;
        letter-spacing: 0.01em;
        text-decoration: none;
        transition:
          transform 180ms ease,
          filter 180ms ease,
          background 180ms ease,
          border-color 180ms ease;
      }
      .ua-cta--primary {
        background: linear-gradient(
          135deg,
          oklch(72% 0.22 195),
          oklch(62% 0.24 285)
        );
        color: #060610;
        border: 1px solid transparent;
      }
      .ua-cta--primary:hover {
        transform: translateY(-1px);
        filter: brightness(1.06);
      }
      .ua-cta--primary:focus-visible {
        outline: 2px solid var(--ua-accent);
        outline-offset: 3px;
      }
      .ua-cta--secondary {
        background: transparent;
        color: var(--ua-ink);
        border: 1px solid color-mix(in oklch, var(--ua-ink) 25%, transparent);
      }
      .ua-cta--secondary:hover {
        border-color: color-mix(in oklch, var(--ua-accent) 60%, transparent);
        color: color-mix(in oklch, var(--ua-accent) 70%, var(--ua-ink) 30%);
      }
      .ua-cta--secondary:focus-visible {
        outline: 2px solid var(--ua-accent);
        outline-offset: 3px;
      }

      /* ── BREAKPOINTS ───────────────────────────────── */
      @media (max-width: 880px) {
        .ua-stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 640px) {
        .ua-channels {
          grid-template-columns: 1fr;
        }
        .ua-vanity-number {
          font-size: clamp(2rem, 11vw, 2.8rem);
        }
        .ua-stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .ua-cta {
          width: 100%;
          justify-content: center;
        }
      }
    `,
  ],
})
export class UnifiedAiSectionComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly sanitizer = inject(DomSanitizer);

  /** Stable id used to wire `aria-labelledby` to the H2. */
  readonly headingId = 'unified-ai-heading';

  /** 3-up channel grid — web, SMS, voice. */
  readonly channels: readonly Channel[] = [
    {
      id: 'chat',
      icon: '\u{1F4AC}', // 💬
      title: 'Web chat',
      body: 'Cmd+K-fast support without the wait.',
    },
    {
      id: 'sms',
      icon: '\u{1F4F2}', // 📲
      title: 'SMS hotline',
      body: 'Text-back automation that closes leads.',
    },
    {
      id: 'voice',
      icon: '\u{1F4DE}', // 📞
      title: 'Voice line',
      body: 'AI receptionist that books, recommends, and never sleeps.',
    },
  ];

  /** Integration chips — monogram + hue per logo-contrast rule. */
  readonly integrations: readonly Integration[] = [
    { name: 'Stripe',          glyph: 'S', hue: '#635BFF' },
    { name: 'HubSpot',         glyph: 'H', hue: '#FF7A59' },
    { name: 'Calendly',        glyph: 'C', hue: '#006BFF' },
    { name: 'Mailchimp',       glyph: 'M', hue: '#FFE01B' },
    { name: 'Notion',          glyph: 'N', hue: '#E6E6E6' },
    { name: 'Slack',           glyph: 'S', hue: '#4A154B' },
    { name: 'Linear',          glyph: 'L', hue: '#5E6AD2' },
    { name: 'Google Calendar', glyph: 'G', hue: '#4285F4' },
    { name: 'Resend',          glyph: 'R', hue: '#000000' },
    { name: 'Discord',         glyph: 'D', hue: '#5865F2' },
  ];

  /** JSON-LD Service schema — sanitized + injected via `[innerHTML]`. */
  readonly jsonLd = computed<SafeHtml>(() => {
    // SSR-safe — schema is static JSON, doesn't need DOM.
    void isPlatformBrowser(this.platformId);
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'projectsites.dev Unified AI Assistant',
      'serviceType': 'AI voice + SMS assistant',
      'areaServed': 'US',
      'provider': {
        '@type': 'Organization',
        'name': 'projectsites.dev',
        'url': 'https://projectsites.dev',
      },
      'description':
        'One AI brain answers website chat, SMS, voice calls, and email — wired to Stripe, HubSpot, Calendly, Mailchimp, Notion, Slack, Linear, Google Calendar, Resend, Discord, and 100+ MCP integrations.',
      'offers': {
        '@type': 'Offer',
        'availability': 'https://schema.org/InStock',
      },
      'hasOfferCatalog': {
        '@type': 'OfferCatalog',
        'name': 'AI channels',
        'itemListElement': [
          { '@type': 'Service', 'name': 'AI web chat' },
          { '@type': 'Service', 'name': 'AI SMS hotline' },
          { '@type': 'Service', 'name': 'AI voice receptionist' },
        ],
      },
    };
    const json = JSON.stringify(schema).replace(/</g, '\\u003c');
    return this.sanitizer.bypassSecurityTrustHtml(
      `<script type="application/ld+json">${json}</script>`
    );
  });

  /** Exposed for tests + future analytics seeding. */
  readonly viewed = signal(false);
}
