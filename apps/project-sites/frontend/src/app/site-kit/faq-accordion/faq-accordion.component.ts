import { Component, Input } from '@angular/core';

export interface FaqItem {
  question: string;
  answer: string;
}

@Component({
  selector: 'sk-faq-accordion',
  standalone: true,
  imports: [],
  styles: [
    `
      details summary {
        cursor: pointer;
        list-style: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1.25rem 1.5rem;
        font-weight: 600;
        font-size: 1rem;
        gap: 1rem;
        user-select: none;
      }
      details summary::-webkit-details-marker {
        display: none;
      }
      .faq-icon {
        flex-shrink: 0;
        transition: transform 0.25s;
        font-size: 1.1rem;
        opacity: 0.65;
      }
      details[open] .faq-icon {
        transform: rotate(45deg);
        opacity: 1;
      }
      @media (prefers-reduced-motion: reduce) {
        .faq-icon {
          transition: none;
        }
      }
    `,
  ],
  template: `
    @if (items.length) {
      <section
        [style.background]="'var(--ps-bg,#060610)'"
        [style.color]="'var(--ps-ink,#f4f4ff)'"
        style="padding:5rem 1.5rem;"
      >
        <div style="max-width:760px;margin:0 auto;">
          <!-- Header -->
          <div style="text-align:center;margin-bottom:3rem;">
            <h2
              style="font-size:clamp(1.75rem,3.5vw,2.75rem);font-weight:700;
                     margin:0 0 .75rem;letter-spacing:-.02em;"
            >
              {{ heading }}
            </h2>
            @if (subheading) {
              <p style="opacity:.65;font-size:1.05rem;">{{ subheading }}</p>
            }
          </div>
          <!-- FAQ items -->
          <div style="display:flex;flex-direction:column;gap:.75rem;">
            @for (faq of items; track faq) {
              <details
                [style.background]="'var(--ps-surface-1,rgba(255,255,255,.04))'"
                [style.border]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
                style="border-radius:var(--ps-radius-md,12px);overflow:hidden;"
              >
                <summary [style.color]="'var(--ps-ink,#f4f4ff)'">
                  {{ faq.question }}
                  <span class="faq-icon" [style.color]="'var(--ps-accent,#00e5ff)'">+</span>
                </summary>
                <div
                  style="padding:.25rem 1.5rem 1.25rem;font-size:.97rem;line-height:1.75;opacity:.75;"
                >
                  {{ faq.answer }}
                </div>
              </details>
            }
          </div>
        </div>
      </section>
    }
  `,
})
export class SkFaqAccordionComponent {
  @Input() heading = 'Frequently asked questions';
  @Input() subheading = "Can't find what you're looking for? Reach out to our team.";
  // No fabricated defaults — a kit FAQ accordion must NEVER ship invented Q&A to a
  // generated business site (it would also emit fake FAQPage JSON-LD asserting Q&A
  // that doesn't exist). Empty by default → the <section> self-hides (). The
  // consumer passes the business's REAL, published FAQs. (anti-fabrication mandate)
  @Input() items: FaqItem[] = [];
}
