import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface FaqItem { question: string; answer: string; }

@Component({
  selector: 'sk-faq-accordion',
  standalone: true,
  imports: [CommonModule],
  styles: [`
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
    details summary::-webkit-details-marker { display: none; }
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
      .faq-icon { transition: none; }
    }
  `],
  template: `
    <section
      [style.background]="'var(--ps-bg,#060610)'"
      [style.color]="'var(--ps-ink,#f4f4ff)'"
      style="padding:5rem 1.5rem;">
      <div style="max-width:760px;margin:0 auto;">
        <!-- Header -->
        <div style="text-align:center;margin-bottom:3rem;">
          <h2 style="font-size:clamp(1.75rem,3.5vw,2.75rem);font-weight:700;
                     margin:0 0 .75rem;letter-spacing:-.02em;">{{ heading }}</h2>
          <p *ngIf="subheading" style="opacity:.65;font-size:1.05rem;">{{ subheading }}</p>
        </div>

        <!-- FAQ items -->
        <div style="display:flex;flex-direction:column;gap:.75rem;">
          <details *ngFor="let faq of items"
                   [style.background]="'var(--ps-surface-1,rgba(255,255,255,.04))'"
                   [style.border]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
                   style="border-radius:var(--ps-radius-md,12px);overflow:hidden;">
            <summary [style.color]="'var(--ps-ink,#f4f4ff)'">
              {{ faq.question }}
              <span class="faq-icon" [style.color]="'var(--ps-accent,#00e5ff)'">+</span>
            </summary>
            <div style="padding:.25rem 1.5rem 1.25rem;font-size:.97rem;line-height:1.75;opacity:.75;">
              {{ faq.answer }}
            </div>
          </details>
        </div>
      </div>
    </section>
  `,
})
export class SkFaqAccordionComponent {
  @Input() heading = 'Frequently asked questions';
  @Input() subheading = "Can't find what you're looking for? Reach out to our team.";
  @Input() items: FaqItem[] = [
    { question: 'Is there a free plan?', answer: 'Yes — our Starter plan is completely free with no credit card required. You can upgrade anytime.' },
    { question: 'How does billing work?', answer: 'We bill monthly or annually. Annual plans include a 20% discount. You can cancel at any time from your account settings.' },
    { question: 'Can I import my existing data?', answer: 'Absolutely. We support CSV, JSON, and direct integrations with 50+ popular tools.' },
    { question: 'Do you offer enterprise pricing?', answer: 'Yes — contact our sales team for custom pricing, SLAs, and dedicated support options.' },
    { question: 'Is my data secure?', answer: 'All data is encrypted at rest and in transit. We are SOC 2 Type II certified and GDPR compliant.' },
  ];
}
