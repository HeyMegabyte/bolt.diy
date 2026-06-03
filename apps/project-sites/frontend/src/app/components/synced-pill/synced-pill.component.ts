import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Live-freshness pill — a cyan pulse dot + "Synced HH:MM:SS" for any
 * live-polling surface, so the user can trust the data is current.
 *
 * @remarks
 * - Renders NOTHING until `at` is a real timestamp — so a surface that has not
 *   yet (or never successfully) loaded never shows a false "synced" time.
 * - The pulse honours `prefers-reduced-motion`.
 * - Brand-locked to `--ps-accent` (no hard-coded hex).
 *
 * @example
 * ```html
 * <app-synced-pill [at]="syncedAt()" />
 * ```
 * where `syncedAt` is set to `Date.now()` only on a successful data load.
 */
@Component({
  selector: 'app-synced-pill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label(); as t) {
      <span class="sync-pill" data-testid="synced-pill"
            [attr.title]="'Data refreshes live — last synced at ' + t">
        <span class="sync-dot" aria-hidden="true"></span>
        {{ prefix() }} {{ t }}
      </span>
    }
  `,
  styles: [`
    .sync-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 0.72rem; white-space: nowrap;
      color: color-mix(in oklch, var(--ps-accent, #00E5FF) 72%, var(--ps-ink, #f4f4ff) 28%); }
    .sync-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ps-accent, #00E5FF);
      box-shadow: 0 0 6px color-mix(in oklch, var(--ps-accent, #00E5FF) 60%, transparent);
      animation: syncedPillPulse 1.8s ease-out infinite; }
    @keyframes syncedPillPulse {
      0% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--ps-accent, #00E5FF) 55%, transparent); }
      70% { box-shadow: 0 0 0 5px transparent; }
      100% { box-shadow: 0 0 0 0 transparent; }
    }
    @media (prefers-reduced-motion: reduce) { .sync-dot { animation: none; } }
  `],
})
export class SyncedPillComponent {
  /** Epoch ms of the last successful load, or null before/without one. */
  readonly at = input<number | null>(null);
  /** Leading word before the time (e.g. "Synced", "Updated"). */
  readonly prefix = input<string>('Synced');

  /** Formatted clock time, or null when `at` is null (→ renders nothing). */
  readonly label = computed(() => {
    const t = this.at();
    return t ? new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
  });
}
