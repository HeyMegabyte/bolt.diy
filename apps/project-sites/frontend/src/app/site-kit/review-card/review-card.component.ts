import { Component, Input } from '@angular/core';

@Component({
  selector: 'sk-review-card',
  standalone: true,
  imports: [],
  template: `
    @if (body) {
      <article
        [attr.aria-label]="'Review by ' + reviewer"
        itemscope
        itemtype="https://schema.org/Review"
        style="
        background: var(--ps-surface-1, rgba(13,13,40,0.8));
        border: 1px solid rgba(0,229,255,0.12);
        border-radius: var(--ps-radius-xl, 22px);
        padding: 28px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        box-shadow: var(--ps-shadow-card, 0 4px 24px rgba(0,0,0,0.3));
        transition: transform var(--ps-dur-base,220ms) var(--ps-ease-out,ease-out),
                    box-shadow var(--ps-dur-base,220ms) var(--ps-ease-out,ease-out);
      "
        onmouseenter="this.style.transform='translateY(-3px)';this.style.boxShadow='0 12px 40px rgba(0,229,255,0.1)'"
        onmouseleave="this.style.transform='';this.style.boxShadow=''"
      >
        <!-- Stars -->
        <div
          role="img"
          [attr.aria-label]="rating + ' out of 5 stars'"
          style="display:flex;gap:3px;"
          itemprop="reviewRating"
          itemscope
          itemtype="https://schema.org/Rating"
        >
          <meta itemprop="ratingValue" [attr.content]="rating" />
          <meta itemprop="bestRating" content="5" />
          @for (s of stars; track s) {
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              [attr.fill]="s <= rating ? 'var(--ps-accent,#00e5ff)' : 'rgba(244,244,255,0.15)'"
              stroke="none"
              aria-hidden="true"
            >
              <polygon
                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              />
            </svg>
          }
        </div>
        <!-- Quote -->
        <blockquote
          itemprop="reviewBody"
          style="
          margin: 0;
          color: var(--ps-ink, #f4f4ff);
          font-size: 0.95rem;
          line-height: 1.65;
          opacity: 0.9;
        "
        >
          &ldquo;{{ body }}&rdquo;
        </blockquote>
        <!-- Reviewer -->
        <footer style="display:flex;align-items:center;gap:12px;margin-top:4px;">
          <div
            itemprop="author"
            itemscope
            itemtype="https://schema.org/Person"
            style="
            width: 40px; height: 40px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--ps-accent,#00e5ff), var(--ps-accent-secondary,#7C3AED));
            display: flex; align-items: center; justify-content: center;
            font-size: 1rem; font-weight: 700;
            color: var(--ps-bg, #060610);
            flex-shrink: 0;
          "
            aria-hidden="true"
          >
            {{ reviewer.charAt(0) }}
          </div>
          <div>
            <div
              itemprop="name"
              style="color:var(--ps-ink,#f4f4ff);font-size:0.875rem;font-weight:700;"
            >
              {{ reviewer }}
            </div>
            @if (role) {
              <div style="color:rgba(244,244,255,0.55);font-size:0.8rem;">{{ role }}</div>
            }
          </div>
          @if (platform) {
            <div style="margin-left:auto;">
              <span
                style="
            background: rgba(0,229,255,0.08);
            border: 1px solid rgba(0,229,255,0.15);
            color: var(--ps-accent,#00e5ff);
            font-size: 0.7rem;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 99px;
            text-transform: uppercase;
            letter-spacing: .04em;
          "
                >{{ platform }}</span
              >
            </div>
          }
        </footer>
      </article>
    }
  `,
})
export class ReviewCardComponent {
  // No fabricated defaults — a review card must NEVER ship an invented reviewer,
  // invented quote, or a "Google" source badge for a review that doesn't exist.
  // Empty `body` self-hides the <article> (); the consumer passes a REAL,
  // permission-collected review or renders nothing. (anti-fabrication mandate)
  @Input() reviewer = '';
  @Input() role = '';
  @Input() body = '';
  @Input() rating = 5;
  @Input() platform = '';

  get stars(): number[] {
    return [1, 2, 3, 4, 5];
  }
}
