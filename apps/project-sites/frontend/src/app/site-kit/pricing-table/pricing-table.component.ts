import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface PricingTier {
  name: string;
  price: string;
  period?: string;
  description: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  popular?: boolean;
}

@Component({
  selector: 'sk-pricing-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section
      [style.background]="'var(--ps-bg,#060610)'"
      [style.color]="'var(--ps-ink,#f4f4ff)'"
      style="padding:5rem 1.5rem;">
      <div style="max-width:1100px;margin:0 auto;">
        <!-- Header -->
        <div style="text-align:center;margin-bottom:3.5rem;">
          <h2 style="font-size:clamp(1.75rem,3.5vw,2.75rem);font-weight:700;
                     margin:0 0 .75rem;letter-spacing:-.02em;">{{ heading }}</h2>
          <p *ngIf="subheading" style="opacity:.65;font-size:1.05rem;">{{ subheading }}</p>
        </div>

        <!-- Tiers -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.5rem;align-items:start;">
          <div *ngFor="let tier of tiers"
               [style.border]="tier.popular
                 ? '2px solid var(--ps-accent,#00e5ff)'
                 : '1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
               [style.background]="tier.popular
                 ? 'var(--ps-surface-2,rgba(0,229,255,.06))'
                 : 'var(--ps-surface-1,rgba(255,255,255,.03))'"
               style="border-radius:var(--ps-radius-xl,22px);padding:2rem;position:relative;">

            <!-- Popular badge -->
            <div *ngIf="tier.popular"
                 [style.background]="'var(--ps-accent,#00e5ff)'"
                 [style.color]="'var(--ps-bg,#060610)'"
                 style="position:absolute;top:-1px;left:50%;transform:translateX(-50%);
                        padding:.25rem .875rem;border-radius:0 0 8px 8px;
                        font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">
              Most Popular
            </div>

            <h3 style="font-size:1.15rem;font-weight:600;margin:0 0 .5rem;">{{ tier.name }}</h3>
            <p style="opacity:.6;font-size:.9rem;margin:0 0 1.25rem;min-height:2.5em;">{{ tier.description }}</p>

            <div style="margin-bottom:1.75rem;">
              <span style="font-size:2.5rem;font-weight:800;font-variant-numeric:tabular-nums;">{{ tier.price }}</span>
              <span *ngIf="tier.period" style="opacity:.55;font-size:.9rem;margin-left:.25rem;">{{ tier.period }}</span>
            </div>

            <a [href]="tier.ctaHref"
               [style.background]="tier.popular
                 ? 'var(--ps-grad-primary,linear-gradient(135deg,#00e5ff,#00d4ff))'
                 : 'transparent'"
               [style.color]="tier.popular ? 'var(--ps-bg,#060610)' : 'var(--ps-ink,#f4f4ff)'"
               [style.border]="tier.popular ? 'none' : '1px solid var(--ps-hairline,rgba(255,255,255,.2))'"
               style="display:block;text-align:center;padding:.75rem;
                      border-radius:var(--ps-radius-sm,8px);font-weight:600;
                      text-decoration:none;margin-bottom:1.75rem;transition:opacity .15s;"
               (mouseenter)="$event.target['style'].opacity='.8'"
               (mouseleave)="$event.target['style'].opacity='1'">
              {{ tier.ctaLabel }}
            </a>

            <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.625rem;">
              <li *ngFor="let f of tier.features"
                  style="display:flex;align-items:flex-start;gap:.625rem;font-size:.9rem;opacity:.8;">
                <span [style.color]="'var(--ps-accent,#00e5ff)'" style="flex-shrink:0;margin-top:.1em;">✓</span>
                {{ f }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class SkPricingTableComponent {
  @Input() heading = 'Simple, transparent pricing';
  @Input() subheading = 'No hidden fees. Cancel anytime.';
  @Input() tiers: PricingTier[] = [
    {
      name: 'Starter', price: '$0', period: '/month',
      description: 'Perfect for side projects and personal use.',
      features: ['3 projects', '10k requests/mo', 'Community support'],
      ctaLabel: 'Get started free', ctaHref: '#signup',
    },
    {
      name: 'Pro', price: '$49', period: '/month',
      description: 'For growing teams that need more power.',
      features: ['Unlimited projects', '1M requests/mo', 'Priority support', 'Custom domains', 'Analytics'],
      ctaLabel: 'Start free trial', ctaHref: '#trial', popular: true,
    },
    {
      name: 'Enterprise', price: 'Custom', period: '',
      description: 'Tailored for large organizations.',
      features: ['Unlimited everything', 'SLA guarantee', 'Dedicated support', 'SSO', 'On-prem option'],
      ctaLabel: 'Contact sales', ctaHref: '#contact',
    },
  ];
}
