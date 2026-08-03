import { Component, signal, inject, DestroyRef, type OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../../services/api.service';

/** One resolved upgrade moment (mirrors the worker `UpgradeMoment` shape). */
interface UpgradeMoment {
  readonly trigger: string;
  readonly eligible: boolean;
  readonly headline: string;
  readonly body: string;
  readonly benefits: readonly string[];
  readonly cta_label: string;
  readonly cta_url: string;
  readonly price_hint: string;
  readonly value_metric: string;
  readonly dismiss_key: string;
}
interface UpgradeMomentList {
  readonly moments: readonly UpgradeMoment[];
  readonly count: number;
}

/**
 * Upgrade Moments strip (Tier-1 conversion lever). Fetches the org's eligible,
 * non-dismissed friction-point nudges from `GET /api/upgrade-moments` and renders
 * them as compact cards. Each CTA deep-links to billing attributed to the trigger
 * (`/admin/billing?upsell=<trigger>`) so the funnel can measure which friction
 * point converts. Dismiss persists in the worker (KV, 90-day TTL).
 *
 * Silent-by-design: the flag-off case returns 404 and any error renders nothing —
 * an upsell nudge must never break the owner's dashboard.
 */
@Component({
  selector: 'app-upgrade-moments',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (moments().length > 0) {
      <section class="mb-4" data-testid="upgrade-moments" aria-label="Recommended upgrades">
        <div class="flex items-baseline justify-between mb-2">
          <h2 class="text-[0.8rem] font-bold text-white tracking-tight m-0">Get more from your site</h2>
          <span class="text-[0.7rem] text-text-secondary">Free plan — optional power-ups</span>
        </div>
        <div class="grid gap-2 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          @for (m of moments(); track m.trigger) {
            <article
              class="relative rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 hover:border-primary/30 transition-colors"
              data-testid="upgrade-moment-card">
              <button
                type="button"
                class="absolute top-2 right-2 text-text-secondary hover:text-white text-[0.85rem] leading-none p-1 cursor-pointer disabled:opacity-50"
                [disabled]="dismissing().has(m.trigger)"
                (click)="dismiss(m.trigger)"
                [attr.aria-label]="'Dismiss ' + m.headline"
                data-testid="upgrade-moment-dismiss">
                ✕
              </button>
              <div class="flex items-center gap-2 pr-6">
                <span class="text-[0.85rem] font-semibold text-white">{{ m.headline }}</span>
              </div>
              <p class="text-[0.76rem] text-text-secondary mt-1 mb-2">{{ m.value_metric }}</p>
              <div class="flex items-center justify-between gap-2">
                <a
                  class="inline-flex items-center px-3 py-1.5 rounded-lg text-[0.76rem] font-semibold bg-primary text-dark hover:opacity-90 transition-opacity cursor-pointer"
                  [routerLink]="'/admin/billing'"
                  [queryParams]="{ upsell: m.trigger }"
                  data-bcl="upgrade_cta"
                  [attr.data-bcl-trigger]="m.trigger"
                  data-testid="upgrade-moment-cta">
                  {{ m.cta_label }} →
                </a>
                <span class="text-[0.68rem] font-medium text-text-secondary uppercase tracking-wider">{{ m.price_hint }}</span>
              </div>
            </article>
          }
        </div>
      </section>
    }
  `,
})
export class UpgradeMomentsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly moments = signal<readonly UpgradeMoment[]>([]);
  /** Triggers with an in-flight dismiss — guards double-submit. */
  readonly dismissing = signal<ReadonlySet<string>>(new Set());

  ngOnInit(): void {
    this.api
      // `silent: true` — this renders on the /admin hub and its flag is experimental,
      // so a flag-off 404 is EXPECTED. Without silent, ApiService fired the alarming
      // "Can't reach the server" toast on the dashboard (the subscribe error handler
      // below only stops the COMPONENT from toasting; ApiService toasts first).
      // Confirmed the dashboard toast source via the sweep's net-failure logger.
      .get<UpgradeMomentList>('/upgrade-moments', undefined, { silent: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => this.moments.set(Array.isArray(r?.moments) ? r.moments : []),
        // flag-off 404 or any error → render nothing (never break the dashboard).
        error: () => this.moments.set([]),
      });
  }

  /**
   * Persist a dismissal and optimistically remove the card. Re-shows the card if
   * the worker rejects the dismissal so the owner can retry.
   */
  dismiss(trigger: string): void {
    if (this.dismissing().has(trigger)) return;
    const next = new Set(this.dismissing());
    next.add(trigger);
    this.dismissing.set(next);

    const before = this.moments();
    this.moments.set(before.filter((m) => m.trigger !== trigger));

    this.api
      .post(`/upgrade-moments/${trigger}/dismiss`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.clearDismissing(trigger),
        error: () => {
          this.moments.set(before); // restore on failure
          this.clearDismissing(trigger);
        },
      });
  }

  private clearDismissing(trigger: string): void {
    const next = new Set(this.dismissing());
    next.delete(trigger);
    this.dismissing.set(next);
  }
}
