import { Component, Input } from '@angular/core';

export interface Stat {
  value: string;
  label: string;
}

@Component({
  selector: 'sk-stats-band',
  standalone: true,
  imports: [],
  template: `
    @if (stats.length) {
      <section
        [style.background]="'var(--ps-surface-1,rgba(255,255,255,.03))'"
        [style.borderTop]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
        [style.borderBottom]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
        [style.color]="'var(--ps-ink,#f4f4ff)'"
        style="padding:4rem 1.5rem;"
      >
        <div style="max-width:1100px;margin:0 auto;">
          @if (heading) {
            <h2
              style="text-align:center;font-size:clamp(1.5rem,3vw,2.25rem);
                   font-weight:700;margin:0 0 3rem;letter-spacing:-.02em;"
            >
              {{ heading }}
            </h2>
          }
          <dl
            style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
                   gap:2rem;text-align:center;"
          >
            @for (s of stats; track s) {
              <div>
                <dt
                  [style.color]="'var(--ps-accent,#00e5ff)'"
                  style="font-size:clamp(2.5rem,5vw,3.75rem);font-weight:800;
                       letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums;
                       display:block;"
                >
                  {{ s.value }}
                </dt>
                <dd style="font-size:.95rem;opacity:.65;margin-top:.5rem;font-weight:500;">
                  {{ s.label }}
                </dd>
              </div>
            }
          </dl>
        </div>
      </section>
    }
  `,
})
export class SkStatsBandComponent {
  @Input() heading = '';
  // No fabricated defaults — a stats band must NEVER ship invented metrics
  // (10M+ users / 99.9% uptime …) to a generated business site. The consumer/
  // generator passes REAL, verifiable numbers; with none the <section> self-hides
  // (). Demo data lives in the Storybook story. (anti-fabrication mandate)
  @Input() stats: Stat[] = [];
}
