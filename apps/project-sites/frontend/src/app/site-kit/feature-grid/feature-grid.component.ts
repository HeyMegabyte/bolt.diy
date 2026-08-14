import { Component, Input } from '@angular/core';

export interface FeatureCard {
  icon: string;
  title: string;
  description: string;
}

@Component({
  selector: 'sk-feature-grid',
  standalone: true,
  imports: [],
  template: `
    @if (features.length) {
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
                     margin:0 0 1rem;letter-spacing:-.02em;text-wrap:balance;"
            >
              {{ heading }}
            </h2>
            @if (subheading) {
              <p style="font-size:1.1rem;opacity:.7;max-width:52ch;margin:0 auto;line-height:1.7;">
                {{ subheading }}
              </p>
            }
          </div>
          <!-- 3-col grid -->
          <div
            style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.5rem;"
          >
            @for (f of features; track f) {
              <div
                [style.background]="'var(--ps-surface-1,rgba(255,255,255,.04))'"
                [style.border]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
                style="border-radius:var(--ps-radius-lg,16px);padding:2rem;
                      transition:border-color .2s, transform .2s;cursor:default;"
                (mouseenter)="
                  $event.currentTarget['style'].borderColor = 'var(--ps-accent,#00e5ff)';
                  $event.currentTarget['style'].transform = 'translateY(-3px)'
                "
                (mouseleave)="
                  $event.currentTarget['style'].borderColor =
                    'var(--ps-hairline,rgba(255,255,255,.08))';
                  $event.currentTarget['style'].transform = 'translateY(0)'
                "
              >
                <!-- Icon -->
                <div
                  [style.color]="'var(--ps-accent,#00e5ff)'"
                  style="font-size:2rem;margin-bottom:1.25rem;line-height:1;"
                >
                  {{ f.icon }}
                </div>
                <h3 style="font-size:1.1rem;font-weight:600;margin:0 0 .625rem;">{{ f.title }}</h3>
                <p style="font-size:.95rem;line-height:1.65;opacity:.7;margin:0;">
                  {{ f.description }}
                </p>
              </div>
            }
          </div>
        </div>
      </section>
    }
  `,
})
export class SkFeatureGridComponent {
  @Input() heading = 'Everything you need';
  @Input() subheading = 'Powerful features to help your team build better products, faster.';
  // No fabricated defaults — a kit feature grid must NEVER ship invented product claims
  // ("Sub-second response times", "200+ edge locations") to a real business site. Empty
  // by default → the <section> self-hides (). The consumer passes the business's
  // REAL features. (anti-fabrication mandate)
  @Input() features: FeatureCard[] = [];
}
