import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface FlagBadge {
  /** Short label shown in the chip. */
  readonly label: string;
  /** Visual tone — drives the cyan/black-cockpit color treatment. */
  readonly tone: 'on' | 'off' | 'stage' | 'risk' | 'scope' | 'neutral' | 'warn';
  /** Optional tooltip / aria detail. */
  readonly title?: string;
}

/**
 * Reusable status/scope/risk badge row. Both control-plane layers render their
 * flag/feature chips through this so badge styling stays identical. Pure
 * presentational — no inputs beyond the badge list.
 */
@Component({
  selector: 'app-flag-badge-row',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="br" data-testid="ff-badge-row">
      @for (b of badges; track b.label + b.tone) {
        <span class="br-chip" [attr.data-tone]="b.tone" [attr.title]="b.title || null" [attr.aria-label]="b.title || b.label">
          {{ b.label }}
        </span>
      }
    </div>
  `,
  styles: [`
    .br { display: flex; gap: .4rem; flex-wrap: wrap; align-items: center; }
    .br-chip { font-size: .68rem; padding: .18rem .5rem; border-radius: 999px; letter-spacing: .03em;
      text-transform: uppercase; font-weight: 600; white-space: nowrap;
      background: color-mix(in oklch, currentColor 14%, transparent); color: color-mix(in oklch, currentColor 80%, transparent); }
    .br-chip[data-tone="on"] { background: #4ade80; color: #052e16; }
    .br-chip[data-tone="off"] { background: color-mix(in oklch, currentColor 14%, transparent); color: color-mix(in oklch, currentColor 70%, transparent); }
    .br-chip[data-tone="stage"] { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 22%, transparent); color: var(--ps-accent, #00e5ff); }
    .br-chip[data-tone="risk"] { background: color-mix(in oklch, #f87171 28%, transparent); color: #fecaca; }
    .br-chip[data-tone="scope"] { background: color-mix(in oklch, #a78bfa 26%, transparent); color: #ede9fe; }
    .br-chip[data-tone="warn"] { background: color-mix(in oklch, #fbbf24 30%, transparent); color: #1c1917; }
    .br-chip[data-tone="neutral"] { background: color-mix(in oklch, currentColor 12%, transparent); }
  `],
})
export class FlagBadgeRowComponent {
  @Input() badges: FlagBadge[] = [];
}
