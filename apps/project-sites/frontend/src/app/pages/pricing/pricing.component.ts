import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RollingCounterComponent } from '../../components/rolling-counter/rolling-counter.component';
import { RevealDirective } from '../../directives/reveal.directive';

/**
 * Public pricing page — the $50/month base offer + the $500/year annual offer.
 *
 * @remarks
 * "We don't sell websites. We deliver them." One flat price per active site, no
 * tiers to decode. Cinematic per the projectsites brand: prices roll via
 * `<app-rolling-counter>`, sections fade via `appReveal`, brand `--ps-*` tokens
 * only. CTAs route into the existing claim/create funnel (`/search` → `/create`).
 */
@Component({
  selector: 'app-pricing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RollingCounterComponent, RevealDirective],
  template: `
    <main class="pricing">
      <section class="pricing__hero" appReveal>
        <p class="pricing__eyebrow">Simple, honest pricing</p>
        <h1 class="pricing__title">One price. Your whole site, delivered.</h1>
        <p class="pricing__sub">
          We don't sell websites — we deliver them. Live, hosted, SSL'd, and yours.
          No setup fees, no tiers to decode. Cancel anytime.
        </p>
      </section>

      <section class="pricing__grid" aria-label="Plans">
        <article class="tier" appReveal>
          <header class="tier__head">
            <h2 class="tier__name">Monthly</h2>
            <p class="tier__price">
              <app-rolling-counter [value]="50" prefix="$" />
              <span class="tier__per">/month</span>
            </p>
            <p class="tier__note">per active site, billed monthly</p>
          </header>
          <ul class="tier__list">
            <li>Hosted on Cloudflare's global edge</li>
            <li>Free SSL + a {{ '{slug}' }}.projectsites.dev address</li>
            <li>Visual editor + AI content updates</li>
            <li>Connect your own custom domain</li>
            <li>Contact forms, SEO metadata, analytics</li>
          </ul>
          <a class="tier__cta" routerLink="/search" data-testid="pricing-cta-monthly">
            Claim your site →
          </a>
        </article>

        <article class="tier tier--featured" appReveal [revealDelay]="80">
          <span class="tier__badge">Save $100</span>
          <header class="tier__head">
            <h2 class="tier__name">Annual</h2>
            <p class="tier__price">
              <app-rolling-counter [value]="500" prefix="$" />
              <span class="tier__per">/year</span>
            </p>
            <p class="tier__note">per active site — two months free</p>
          </header>
          <ul class="tier__list">
            <li>Everything in Monthly</li>
            <li>Two months free vs paying monthly</li>
            <li>Priority build queue</li>
            <li>Locked-in annual rate</li>
            <li>One invoice a year</li>
          </ul>
          <a class="tier__cta tier__cta--primary" routerLink="/search" data-testid="pricing-cta-annual">
            Start annual →
          </a>
        </article>
      </section>

      <p class="pricing__addons" appReveal>
        Add-ons available on any plan: Local SEO, email capture, booking, social
        autoposting, AI concierge, and donation pages.
      </p>
    </main>
  `,
  styles: [
    `
      .pricing {
        max-width: 1040px;
        margin: 0 auto;
        padding: clamp(3rem, 8vw, 6rem) 1.25rem 5rem;
        color: var(--ps-ink, #f4f4ff);
      }
      .pricing__hero {
        text-align: center;
        margin-bottom: clamp(2.5rem, 6vw, 4rem);
      }
      .pricing__eyebrow {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 0.8rem;
        color: var(--ps-accent, #00e5ff);
        margin: 0 0 0.75rem;
      }
      .pricing__title {
        font-size: clamp(2rem, 5vw, 3.25rem);
        line-height: 1.05;
        text-wrap: balance;
        margin: 0 0 1rem;
      }
      .pricing__sub {
        max-width: 36ch;
        margin: 0 auto;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 72%, transparent);
        font-size: 1.05rem;
        line-height: 1.6;
      }
      .pricing__grid {
        display: grid;
        gap: 1.5rem;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }
      .tier {
        position: relative;
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent);
        border-radius: var(--ps-radius-xl, 22px);
        background: color-mix(in oklch, var(--ps-bg, #060610) 70%, #0c0c1c);
        padding: 2rem 1.75rem;
        display: flex;
        flex-direction: column;
        transition: transform 0.333s ease, border-color 0.333s ease, box-shadow 0.333s ease;
      }
      .tier:hover {
        transform: translateY(-4px);
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 45%, transparent);
        box-shadow: 0 18px 50px -20px color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent);
      }
      .tier--featured {
        border-color: var(--ps-accent, #00e5ff);
      }
      .tier__badge {
        position: absolute;
        top: -0.75rem;
        right: 1.25rem;
        background: var(--ps-accent, #00e5ff);
        color: #03070a;
        font-weight: 700;
        font-size: 0.72rem;
        letter-spacing: 0.04em;
        padding: 0.3rem 0.7rem;
        border-radius: 999px;
      }
      .tier__name {
        font-size: 1.05rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin: 0 0 0.5rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 80%, transparent);
      }
      .tier__price {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        font-size: clamp(2.6rem, 6vw, 3.4rem);
        font-weight: 800;
        margin: 0 0 0.35rem;
        font-variant-numeric: tabular-nums;
      }
      .tier__per {
        font-size: 1rem;
        font-weight: 500;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 64%, transparent);
      }
      .tier__note {
        font-size: 0.9rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent);
        margin: 0 0 1.5rem;
      }
      .tier__list {
        list-style: none;
        padding: 0;
        margin: 0 0 1.75rem;
        display: grid;
        gap: 0.7rem;
        flex: 1;
      }
      .tier__list li {
        position: relative;
        padding-left: 1.5rem;
        line-height: 1.45;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 86%, transparent);
      }
      .tier__list li::before {
        content: '✓';
        position: absolute;
        left: 0;
        color: var(--ps-accent, #00e5ff);
        font-weight: 700;
      }
      .tier__cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.85rem 1.25rem;
        border-radius: 12px;
        font-weight: 600;
        text-decoration: none;
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 50%, transparent);
        color: var(--ps-accent, #00e5ff);
        transition: background 0.333s ease, color 0.333s ease, transform 0.333s ease;
      }
      .tier__cta:hover {
        transform: translateY(-2px);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent);
      }
      .tier__cta--primary {
        background: var(--ps-accent, #00e5ff);
        color: #03070a;
        border-color: var(--ps-accent, #00e5ff);
      }
      .tier__cta--primary:hover {
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 88%, #fff);
      }
      .tier__cta:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 3px;
      }
      .pricing__addons {
        text-align: center;
        max-width: 52ch;
        margin: 3rem auto 0;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 58%, transparent);
        font-size: 0.95rem;
        line-height: 1.6;
      }
    `,
  ],
})
export class PricingComponent {}
