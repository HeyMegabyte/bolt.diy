import { Component, Input } from '@angular/core';
import { NgFor } from '@angular/common';

export interface TrustBadge {
  label: string;
  icon?: string;
}

@Component({
  selector: 'sk-trust-badges',
  standalone: true,
  imports: [NgFor],
  template: `
    <section
      [attr.aria-label]="ariaLabel"
      style="
        padding: 24px 16px;
        background: var(--ps-surface-1, rgba(13,13,40,0.8));
        border-top: 1px solid rgba(0,229,255,0.08);
        border-bottom: 1px solid rgba(0,229,255,0.08);
      "
    >
      <ul
        role="list"
        style="
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 24px 40px;
        "
      >
        <li
          *ngFor="let badge of badges"
          style="
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--ps-ink, #f4f4ff);
            font-size: 0.875rem;
            font-weight: 600;
            opacity: 0.9;
          "
        >
          <span
            *ngIf="badge.icon"
            aria-hidden="true"
            style="
              display: flex;
              align-items: center;
              justify-content: center;
              width: 28px;
              height: 28px;
              background: rgba(0,229,255,0.12);
              border-radius: 50%;
              color: var(--ps-accent, #00e5ff);
              flex-shrink: 0;
            "
            [innerHTML]="badge.icon"
          ></span>
          <svg
            *ngIf="!badge.icon"
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="var(--ps-accent,#00e5ff)" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
            style="flex-shrink:0"
          >
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {{ badge.label }}
        </li>
      </ul>
    </section>
  `,
})
export class TrustBadgesComponent {
  @Input() badges: TrustBadge[] = [
    { label: 'Licensed & Insured' },
    { label: '5-Star Rated' },
    { label: '24/7 Support' },
    { label: 'Free Estimates' },
    { label: 'Satisfaction Guaranteed' },
  ];
  @Input() ariaLabel = 'Trust badges';
}
