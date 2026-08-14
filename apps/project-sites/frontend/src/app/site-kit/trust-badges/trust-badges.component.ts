import { Component, Input } from '@angular/core';

export interface TrustBadge {
  label: string;
  icon?: string;
}

@Component({
  selector: 'sk-trust-badges',
  standalone: true,
  imports: [],
  template: `
    @if (badges.length) {
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
          @for (badge of badges; track badge) {
            <li
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
              @if (badge.icon) {
                <span
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
              }
              @if (!badge.icon) {
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--ps-accent,#00e5ff)"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  style="flex-shrink:0"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              }
              {{ badge.label }}
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class TrustBadgesComponent {
  // No fabricated defaults — trust badges assert claims ABOUT the business
  // (Licensed & Insured / 5-Star Rated …). Shipping them unverified to a generated
  // site is a false claim. The consumer passes only TRUE, verified badges; with
  // none the <section> self-hides (). (anti-fabrication mandate)
  @Input() badges: TrustBadge[] = [];
  @Input() ariaLabel = 'Trust badges';
}
