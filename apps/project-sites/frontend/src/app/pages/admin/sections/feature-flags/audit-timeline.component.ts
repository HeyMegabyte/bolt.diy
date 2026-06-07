import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface AuditEntry {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  /** Human summary of what changed (e.g. "rollout 0% → 25%"). */
  readonly summary: string;
  readonly created_at: string;
  /** Optional typed reason captured for a dangerous change. */
  readonly reason?: string | null;
}

/**
 * Reusable per-flag / per-feature audit history timeline. Both layers render
 * change history through this so the audit UI is identical. Pure presentational.
 */
@Component({
  selector: 'app-flag-audit-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ol class="at" data-testid="ff-audit-timeline" aria-label="Change history">
      @for (e of entries(); track e.id) {
        <li class="at-row">
          <span class="at-dot" aria-hidden="true"></span>
          <div class="at-body">
            <p class="at-summary">{{ e.summary }}</p>
            <p class="at-meta">
              <span class="at-actor">{{ e.actor }}</span>
              <span class="at-sep" aria-hidden="true">·</span>
              <span class="at-action">{{ e.action }}</span>
              <span class="at-sep" aria-hidden="true">·</span>
              <!-- Relative time is more scannable in a history feed; the absolute
                   timestamp stays available on hover (title) + in datetime. -->
              <time [attr.datetime]="e.created_at" [attr.title]="e.created_at | date: 'medium'">{{ relTime(e.created_at) }}</time>
            </p>
            @if (e.reason) {
              <p class="at-reason"><span class="at-reason-label">Reason:</span> {{ e.reason }}</p>
            }
          </div>
        </li>
      }
      @if (entries().length === 0) {
        <li class="at-empty" role="status">No changes recorded yet.</li>
      }
    </ol>
  `,
  styles: [`
    .at { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .65rem; }
    .at-row { display: flex; gap: .65rem; align-items: flex-start; }
    .at-dot { flex: none; width: 8px; height: 8px; margin-top: .45rem; border-radius: 50%;
      background: var(--ps-accent, #00e5ff); box-shadow: 0 0 0 3px color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent); }
    .at-body { min-width: 0; }
    .at-summary { margin: 0; font-size: .85rem; color: color-mix(in oklch, currentColor 92%, transparent); }
    .at-meta { margin: .15rem 0 0; font-size: .72rem; color: color-mix(in oklch, currentColor 55%, transparent); display: flex; gap: .35rem; flex-wrap: wrap; align-items: center; }
    .at-actor { color: color-mix(in oklch, var(--ps-accent, #00e5ff) 80%, var(--ps-ink, #f4f4ff)); }
    .at-action { font-family: var(--ps-mono, ui-monospace, monospace); }
    .at-reason { margin: .25rem 0 0; font-size: .78rem; color: color-mix(in oklch, currentColor 70%, transparent); }
    .at-reason-label { color: color-mix(in oklch, currentColor 55%, transparent); text-transform: uppercase; font-size: .68rem; letter-spacing: .04em; }
    .at-empty { font-size: .82rem; color: color-mix(in oklch, currentColor 50%, transparent); padding: .5rem 0; }
  `],
})
export class FlagAuditTimelineComponent {
  readonly entries = input<AuditEntry[]>([]);

  /**
   * Compact relative time for the history feed ("just now" / "5m ago" /
   * "3h ago" / "2d ago"), degrading to a locale date beyond 30 days. `now` is
   * injectable for deterministic tests. Invalid input → '' (never "NaN ago").
   */
  relTime(iso: string, now: number = Date.now()): string {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const s = Math.floor((now - t) / 1000);
    if (s < 45) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  }
}
