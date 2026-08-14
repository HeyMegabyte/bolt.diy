import { Component, Input } from '@angular/core';

export interface Testimonial {
  quote: string;
  name: string;
  title: string;
  avatarSrc?: string;
}

@Component({
  selector: 'sk-testimonials-grid',
  standalone: true,
  imports: [],
  template: `
    @if (testimonials.length) {
      <section
        [style.background]="'var(--ps-bg,#060610)'"
        [style.color]="'var(--ps-ink,#f4f4ff)'"
        style="padding:5rem 1.5rem;"
      >
        <div style="max-width:1100px;margin:0 auto;">
          <!-- Header -->
          <div style="text-align:center;margin-bottom:3.5rem;">
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
          <!-- Grid -->
          <div
            style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.5rem;"
          >
            @for (t of testimonials; track t) {
              <figure
                [style.background]="'var(--ps-surface-1,rgba(255,255,255,.04))'"
                [style.border]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
                style="border-radius:var(--ps-radius-lg,16px);padding:2rem;margin:0;"
              >
                <!-- Stars -->
                <div
                  [style.color]="'var(--ps-accent,#00e5ff)'"
                  style="font-size:1rem;margin-bottom:1rem;letter-spacing:.1em;"
                  aria-label="5 stars"
                >
                  ★★★★★
                </div>
                <blockquote
                  style="font-size:1rem;line-height:1.7;margin:0 0 1.5rem;
                               font-style:italic;opacity:.85;"
                >
                  "{{ t.quote }}"
                </blockquote>
                <figcaption style="display:flex;align-items:center;gap:.875rem;">
                  @if (t.avatarSrc) {
                    <img
                      [src]="t.avatarSrc"
                      [alt]="t.name"
                      style="width:40px;height:40px;border-radius:50%;object-fit:cover;"
                    />
                  }
                  @if (!t.avatarSrc) {
                    <div
                      [style.background]="'var(--ps-accent,#00e5ff)'"
                      [style.color]="'var(--ps-bg,#060610)'"
                      style="width:40px;height:40px;border-radius:50%;display:flex;
                          align-items:center;justify-content:center;font-weight:700;font-size:.9rem;flex-shrink:0;"
                    >
                      {{ t.name.charAt(0) }}
                    </div>
                  }
                  <div>
                    <p style="font-weight:600;margin:0;font-size:.95rem;">{{ t.name }}</p>
                    <p style="opacity:.55;margin:0;font-size:.85rem;">{{ t.title }}</p>
                  </div>
                </figcaption>
              </figure>
            }
          </div>
        </div>
      </section>
    }
  `,
})
export class SkTestimonialsGridComponent {
  @Input() heading = 'What our customers say';
  // No fabricated stat — "thousands of teams" is an invented metric. Empty → the <p>
  // self-hides (="subheading"). (anti-fabrication mandate)
  @Input() subheading = '';
  // No fabricated defaults — a site-kit testimonials grid must NEVER ship invented
  // customer quotes to a generated business site (anti-fabrication mandate). Consumers
  // pass real, permission-collected testimonials; with none, the <section> self-hides
  // (). Realistic demo data lives in the Storybook story, not a shippable default.
  @Input() testimonials: Testimonial[] = [];
}
