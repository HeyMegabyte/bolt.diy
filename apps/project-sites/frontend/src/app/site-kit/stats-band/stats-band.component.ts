import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface Stat { value: string; label: string; }

@Component({
  selector: 'sk-stats-band',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section
      [style.background]="'var(--ps-surface-1,rgba(255,255,255,.03))'"
      [style.borderTop]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
      [style.borderBottom]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
      [style.color]="'var(--ps-ink,#f4f4ff)'"
      style="padding:4rem 1.5rem;">
      <div style="max-width:1100px;margin:0 auto;">
        <h2 *ngIf="heading"
            style="text-align:center;font-size:clamp(1.5rem,3vw,2.25rem);
                   font-weight:700;margin:0 0 3rem;letter-spacing:-.02em;">
          {{ heading }}
        </h2>
        <dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
                   gap:2rem;text-align:center;">
          <div *ngFor="let s of stats">
            <dt [style.color]="'var(--ps-accent,#00e5ff)'"
                style="font-size:clamp(2.5rem,5vw,3.75rem);font-weight:800;
                       letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums;
                       display:block;">
              {{ s.value }}
            </dt>
            <dd style="font-size:.95rem;opacity:.65;margin-top:.5rem;font-weight:500;">
              {{ s.label }}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  `,
})
export class SkStatsBandComponent {
  @Input() heading = '';
  @Input() stats: Stat[] = [
    { value: '10M+', label: 'Active users' },
    { value: '99.9%', label: 'Uptime SLA' },
    { value: '<50ms', label: 'Median latency' },
    { value: '180+', label: 'Countries served' },
  ];
}
