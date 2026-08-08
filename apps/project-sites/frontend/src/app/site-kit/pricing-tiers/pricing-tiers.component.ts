import { Component, Input } from '@angular/core';
import { NgFor, NgIf, CurrencyPipe } from '@angular/common';

export interface PricingFeature {
  text: string;
  included: boolean;
}

export interface PricingTier {
  name: string;
  price: number;
  period?: string;
  description?: string;
  features: PricingFeature[];
  ctaLabel: string;
  ctaHref: string;
  highlighted?: boolean;
  badge?: string;
}

@Component({
  selector: 'sk-pricing-tiers',
  standalone: true,
  imports: [NgFor, NgIf, CurrencyPipe],
  template: `
    <section
      *ngIf="tiers.length"
      [attr.aria-labelledby]="headingId"
      style="padding: 48px 24px; max-width: 1040px; margin: 0 auto;"
    >
      <h2
        *ngIf="heading"
        [id]="headingId"
        style="
          color: var(--ps-ink, #f4f4ff);
          font-size: clamp(1.5rem, 4vw, 2.2rem);
          font-weight: 800;
          text-align: center;
          margin: 0 0 8px;
        "
      >{{ heading }}</h2>
      <p
        *ngIf="subtitle"
        style="text-align:center;color:rgba(244,244,255,0.55);font-size:0.9rem;margin:0 0 40px;"
      >{{ subtitle }}</p>

      <div
        role="list"
        style="
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 20px;
          align-items: start;
        "
      >
        <div
          *ngFor="let tier of tiers"
          role="listitem"
          style="
            border-radius: var(--ps-radius-xl, 22px);
            padding: 32px 24px;
            display: flex;
            flex-direction: column;
            position: relative;
            transition: transform 0.22s;
          "
          [style.background]="tier.highlighted ? 'rgba(0,229,255,0.08)' : 'rgba(244,244,255,0.04)'"
          [style.border]="tier.highlighted ? '2px solid rgba(0,229,255,0.5)' : '1px solid rgba(244,244,255,0.1)'"
          onmouseenter="this.style.transform='translateY(-4px)'"
          onmouseleave="this.style.transform='translateY(0)'"
        >
          <!-- Badge -->
          <span
            *ngIf="tier.badge"
            style="
              position: absolute;
              top: -14px;
              left: 50%;
              transform: translateX(-50%);
              background: var(--ps-accent, #00e5ff);
              color: #060610;
              font-size: 0.72rem;
              font-weight: 800;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              padding: 4px 14px;
              border-radius: 99px;
              white-space: nowrap;
            "
            aria-label="Recommended plan"
          >{{ tier.badge }}</span>

          <!-- Tier name -->
          <h3 style="
            color: var(--ps-ink, #f4f4ff);
            font-size: 1.1rem;
            font-weight: 700;
            margin: 0 0 4px;
          ">{{ tier.name }}</h3>

          <p
            *ngIf="tier.description"
            style="color:rgba(244,244,255,0.5);font-size:0.82rem;margin:0 0 20px;line-height:1.4;"
          >{{ tier.description }}</p>

          <!-- Price -->
          <div style="margin-bottom: 24px;">
            <span style="
              font-size: clamp(2rem, 6vw, 2.8rem);
              font-weight: 900;
              color: var(--ps-ink, #f4f4ff);
              font-variant-numeric: tabular-nums;
            ">{{ tier.price | currency:'USD':'symbol':'1.0-0' }}</span>
            <span
              *ngIf="tier.period"
              style="color:rgba(244,244,255,0.4);font-size:0.82rem;margin-left:4px;"
            >/ {{ tier.period }}</span>
          </div>

          <!-- Features -->
          <ul
            role="list"
            aria-label="Features"
            style="list-style:none;margin:0 0 28px;padding:0;flex:1;display:flex;flex-direction:column;gap:10px;"
          >
            <li
              *ngFor="let feature of tier.features"
              style="
                display: flex;
                align-items: flex-start;
                gap: 10px;
                font-size: 0.88rem;
              "
              [style.color]="feature.included ? 'rgba(244,244,255,0.8)' : 'rgba(244,244,255,0.3)'"
            >
              <!-- Check or cross -->
              <svg
                [attr.aria-label]="feature.included ? 'Included' : 'Not included'"
                viewBox="0 0 20 20"
                width="18"
                height="18"
                style="flex-shrink:0;margin-top:1px;"
              >
                <ng-container *ngIf="feature.included">
                  <circle cx="10" cy="10" r="9" fill="rgba(0,229,255,0.15)"/>
                  <polyline points="6,10 9,13 14,7" fill="none" stroke="var(--ps-accent,#00e5ff)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </ng-container>
                <ng-container *ngIf="!feature.included">
                  <circle cx="10" cy="10" r="9" fill="rgba(244,244,255,0.05)"/>
                  <line x1="7" y1="7" x2="13" y2="13" stroke="rgba(244,244,255,0.2)" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="13" y1="7" x2="7" y2="13" stroke="rgba(244,244,255,0.2)" stroke-width="1.5" stroke-linecap="round"/>
                </ng-container>
              </svg>
              {{ feature.text }}
            </li>
          </ul>

          <!-- CTA -->
          <a
            [href]="tier.ctaHref"
            style="
              display: block;
              text-align: center;
              padding: 12px 20px;
              border-radius: 99px;
              font-weight: 800;
              font-size: 0.9rem;
              text-decoration: none;
              transition: opacity 0.22s;
            "
            [style.background]="tier.highlighted ? 'var(--ps-accent, #00e5ff)' : 'rgba(244,244,255,0.08)'"
            [style.color]="tier.highlighted ? '#060610' : 'var(--ps-ink, #f4f4ff)'"
            [style.border]="tier.highlighted ? 'none' : '1px solid rgba(244,244,255,0.15)'"
            onmouseenter="this.style.opacity='0.85'"
            onmouseleave="this.style.opacity='1'"
          >{{ tier.ctaLabel }}</a>
        </div>
      </div>
    </section>
  `,
})
export class PricingTiersComponent {
  @Input() heading = 'Choose Your Plan';
  @Input() headingId = 'sk-pricing-heading';
  @Input() subtitle = 'No hidden fees. Cancel anytime.';
  // No fabricated defaults — a kit pricing table must NEVER ship invented prices/plans
  // ($0/$49/$199) to a real business site; a visitor would read fabricated pricing as
  // fact. Empty by default → the <section> self-hides (*ngIf). The consumer passes the
  // business's REAL pricing. (anti-fabrication mandate)
  @Input() tiers: PricingTier[] = [];
}
