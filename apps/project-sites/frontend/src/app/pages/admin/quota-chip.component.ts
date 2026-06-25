/**
 * Site-quota chip — surfaces the per-tenant build quota the worker enforces
 * (#35) so an owner sees "N / M sites used" BEFORE hitting a 403 on create.
 * Reads GET /api/billing/quota (the same checkBuildLimit snapshot the create
 * paths gate on). Hidden for unlimited orgs (nothing meaningful to show).
 */
import { Component, inject, signal, computed, type OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { ApiService } from '../../services/api.service';

interface QuotaSnapshot {
  used: number;
  limit: number | null;
  remaining: number | null;
  allowed: boolean;
  plan: string;
  unlimited: boolean;
}

@Component({
  selector: 'app-quota-chip',
  standalone: true,
  template: `
    @if (quota(); as q) {
      @if (!q.unlimited && q.limit !== null) {
        <div
          class="quota-chip"
          [class.at-limit]="!q.allowed"
          role="status"
          [attr.aria-label]="
            'Site usage: ' +
            q.used +
            ' of ' +
            q.limit +
            ' sites used on the ' +
            q.plan +
            ' plan' +
            (q.allowed ? '' : ' — limit reached')
          "
          [attr.title]="
            q.allowed
              ? q.remaining + ' more site' + (q.remaining === 1 ? '' : 's') + ' available'
              : 'Site limit reached — add more for $50/month per site'
          "
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span class="quota-count">{{ q.used }} / {{ q.limit }}</span>
          <span class="quota-label">{{ q.used === 1 ? 'site' : 'sites' }}</span>
        </div>
      }
    }
  `,
  styles: [
    `
      .quota-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.25rem 0.6rem;
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 600;
        line-height: 1;
        color: var(--ps-accent, #00e5ff);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent);
        white-space: nowrap;
      }
      .quota-chip.at-limit {
        color: #ffb4b4;
        background: color-mix(in oklch, #ff5a5a 14%, transparent);
        border-color: color-mix(in oklch, #ff5a5a 42%, transparent);
      }
      .quota-count {
        font-variant-numeric: tabular-nums;
      }
      .quota-label {
        opacity: 0.7;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 0.62rem;
      }
    `,
  ],
})
export class QuotaChipComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly quota = signal<QuotaSnapshot | null>(null);
  /** True once a non-unlimited quota has loaded — lets a host conditionally space around it. */
  readonly hasQuota = computed(() => {
    const q = this.quota();
    return !!q && !q.unlimited && q.limit !== null;
  });

  ngOnInit(): void {
    this.api
      .get<{ data: QuotaSnapshot }>('/billing/quota')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.quota.set(res?.data ?? null),
        // Silent — a quota chip is an enhancement; never toast or block on its failure.
        error: () => this.quota.set(null),
      });
  }
}
