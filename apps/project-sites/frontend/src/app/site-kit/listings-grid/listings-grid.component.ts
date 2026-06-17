import { Component, Input } from '@angular/core';
import { NgFor, NgIf, CurrencyPipe } from '@angular/common';

export interface ListingBadge {
  label: string;
  variant?: 'new' | 'featured' | 'sold' | 'default';
}

export interface Listing {
  title: string;
  price?: number;
  priceLabel?: string;
  location?: string;
  description?: string;
  details?: string[];
  badge?: ListingBadge;
  ctaLabel?: string;
  ctaHref?: string;
}

@Component({
  selector: 'sk-listings-grid',
  standalone: true,
  imports: [NgFor, NgIf, CurrencyPipe],
  template: `
    <section
      [attr.aria-labelledby]="headingId"
      style="padding: 48px 24px; max-width: 1100px; margin: 0 auto;"
    >
      <h2
        *ngIf="heading"
        [id]="headingId"
        style="
          color: var(--ps-ink, #f4f4ff);
          font-size: clamp(1.4rem, 4vw, 2rem);
          font-weight: 800;
          text-align: center;
          margin: 0 0 8px;
        "
      >{{ heading }}</h2>
      <p
        *ngIf="subtitle"
        style="text-align:center;color:rgba(244,244,255,0.5);font-size:0.9rem;margin:0 0 36px;"
      >{{ subtitle }}</p>

      <ul
        role="list"
        style="
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
        "
      >
        <li
          *ngFor="let listing of listings"
          role="listitem"
          style="
            background: rgba(244,244,255,0.04);
            border: 1px solid rgba(244,244,255,0.09);
            border-radius: var(--ps-radius-xl, 22px);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            transition: transform 0.22s, border-color 0.22s;
            position: relative;
          "
          onmouseenter="this.style.transform='translateY(-3px)';this.style.borderColor='rgba(0,229,255,0.25)'"
          onmouseleave="this.style.transform='translateY(0)';this.style.borderColor='rgba(244,244,255,0.09)'"
        >
          <!-- Image placeholder -->
          <div
            aria-hidden="true"
            style="
              width: 100%;
              aspect-ratio: 4/3;
              background: rgba(0,229,255,0.05);
              position: relative;
              overflow: hidden;
            "
          >
            <svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg"
              style="width:100%;height:100%;"
              aria-hidden="true"
            >
              <rect width="320" height="240" fill="rgba(0,229,255,0.04)"/>
              <!-- Simple architectural placeholder -->
              <rect x="80" y="80" width="160" height="110" rx="3" fill="rgba(0,229,255,0.07)" stroke="rgba(0,229,255,0.15)" stroke-width="1.5"/>
              <polygon points="60,80 160,30 260,80" fill="rgba(0,229,255,0.1)" stroke="rgba(0,229,255,0.18)" stroke-width="1.5"/>
              <rect x="130" y="140" width="60" height="50" rx="2" fill="rgba(0,229,255,0.12)"/>
              <rect x="90" y="100" width="30" height="25" rx="2" fill="rgba(0,229,255,0.08)"/>
              <rect x="200" y="100" width="30" height="25" rx="2" fill="rgba(0,229,255,0.08)"/>
            </svg>

            <!-- Badge overlay -->
            <span
              *ngIf="listing.badge"
              style="
                position: absolute;
                top: 12px;
                left: 12px;
                font-size: 0.72rem;
                font-weight: 800;
                letter-spacing: 0.06em;
                text-transform: uppercase;
                padding: 4px 10px;
                border-radius: 99px;
              "
              [style.background]="getBadgeBg(listing.badge.variant)"
              [style.color]="getBadgeColor(listing.badge.variant)"
            >{{ listing.badge.label }}</span>
          </div>

          <!-- Body -->
          <div style="padding: 18px 18px 14px; flex: 1; display: flex; flex-direction: column; gap: 6px;">
            <!-- Price row -->
            <div
              *ngIf="listing.price || listing.priceLabel"
              style="
                font-size: 1.2rem;
                font-weight: 900;
                color: var(--ps-accent, #00e5ff);
                font-variant-numeric: tabular-nums;
              "
            >
              <span *ngIf="listing.price">{{ listing.price | currency:'USD':'symbol':'1.0-0' }}</span>
              <span *ngIf="!listing.price && listing.priceLabel">{{ listing.priceLabel }}</span>
            </div>

            <h3 style="
              font-size: 1rem;
              font-weight: 700;
              color: var(--ps-ink, #f4f4ff);
              margin: 0;
              line-height: 1.3;
            ">{{ listing.title }}</h3>

            <p
              *ngIf="listing.location"
              style="
                color: rgba(244,244,255,0.45);
                font-size: 0.8rem;
                margin: 0;
                display: flex;
                align-items: center;
                gap: 4px;
              "
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="M8 1C5.24 1 3 3.24 3 6c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5S7.17 4.5 8 4.5 9.5 5.17 9.5 6 8.83 7.5 8 7.5z" fill="currentColor"/>
              </svg>
              {{ listing.location }}
            </p>

            <p
              *ngIf="listing.description"
              style="
                color: rgba(244,244,255,0.6);
                font-size: 0.83rem;
                line-height: 1.5;
                margin: 4px 0 0;
              "
            >{{ listing.description }}</p>

            <!-- Detail chips -->
            <ul
              *ngIf="listing.details?.length"
              role="list"
              aria-label="Details"
              style="
                list-style: none;
                margin: 8px 0 0;
                padding: 0;
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
              "
            >
              <li
                *ngFor="let d of listing.details"
                style="
                  background: rgba(244,244,255,0.06);
                  border: 1px solid rgba(244,244,255,0.1);
                  border-radius: 6px;
                  padding: 3px 8px;
                  font-size: 0.75rem;
                  color: rgba(244,244,255,0.6);
                "
              >{{ d }}</li>
            </ul>

            <!-- CTA -->
            <a
              *ngIf="listing.ctaLabel"
              [href]="listing.ctaHref || '#'"
              style="
                display: block;
                text-align: center;
                margin-top: auto;
                padding-top: 14px;
                padding-bottom: 10px;
                color: var(--ps-accent, #00e5ff);
                font-size: 0.85rem;
                font-weight: 700;
                text-decoration: none;
                border-top: 1px solid rgba(244,244,255,0.07);
              "
              [attr.aria-label]="listing.ctaLabel + ': ' + listing.title"
              onmouseenter="this.style.textDecoration='underline'"
              onmouseleave="this.style.textDecoration='none'"
            >{{ listing.ctaLabel }} →</a>
          </div>
        </li>
      </ul>
    </section>
  `,
})
export class ListingsGridComponent {
  @Input() heading = 'Featured Listings';
  @Input() headingId = 'sk-listings-heading';
  @Input() subtitle = 'Browse our current available properties.';
  @Input() listings: Listing[] = [
    {
      title: '3BR / 2BA Modern Townhome',
      price: 425000,
      location: 'East Nashville, TN',
      description: 'Light-filled end-unit with rooftop terrace and 2-car garage.',
      details: ['3 bed', '2 bath', '1,840 sq ft'],
      badge: { label: 'New', variant: 'new' },
      ctaLabel: 'View Details',
      ctaHref: '#listing-1',
    },
    {
      title: 'Historic Bungalow on Corner Lot',
      price: 312000,
      location: 'Germantown, TN',
      description: 'Restored 1920s bungalow with original hardwood and renovated kitchen.',
      details: ['2 bed', '1 bath', '1,100 sq ft'],
      ctaLabel: 'View Details',
      ctaHref: '#listing-2',
    },
    {
      title: 'New Construction Estate Home',
      price: 890000,
      location: 'Brentwood, TN',
      description: 'Builder-grade finishes, open-plan design, and large wooded lot.',
      details: ['5 bed', '4 bath', '3,700 sq ft'],
      badge: { label: 'Featured', variant: 'featured' },
      ctaLabel: 'View Details',
      ctaHref: '#listing-3',
    },
  ];

  getBadgeBg(variant?: string): string {
    const map: Record<string, string> = {
      new: 'var(--ps-accent, #00e5ff)',
      featured: '#7C3AED',
      sold: 'rgba(244,244,255,0.15)',
      default: 'rgba(244,244,255,0.15)',
    };
    return map[variant ?? 'default'] ?? map['default'];
  }

  getBadgeColor(variant?: string): string {
    if (variant === 'new' || variant === 'featured') return '#060610';
    return 'rgba(244,244,255,0.8)';
  }
}
