/**
 * @module pages/admin-v2/sections/billing
 *
 * V2 Billing section — plan + entitlements at a glance. Reads the confirmed
 * `getSubscription()` + `getEntitlements()` APIs (forkJoin), renders a plan
 * card (status badge) + an entitlements list (enabled/disabled badges +
 * animated domain cap via `<app-rolling-counter>` per the cinematic-ui rule),
 * and a "Manage billing" button that opens the Stripe portal. 4-state contract
 * on helm primitives per [[spartan-ui-design-system]] + [[angular-large-app-supervisor]].
 *
 * @example Routed as the `billing` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of, startWith } from 'rxjs';
import { ApiService, type SubscriptionInfo, type Entitlements } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';

type BillingState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; sub: SubscriptionInfo; ent: Entitlements };

@Component({
  selector: 'app-v2-billing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmBadgeDirective,
    RollingCounterComponent,
  ],
  template: `
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-foreground">Billing</h2>
      <p class="text-sm text-muted-foreground">Plan, usage &amp; subscription</p>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 max-w-3xl" data-testid="v2-billing-loading">
          <div hlmCard class="h-28 animate-pulse opacity-60"></div>
          <div hlmCard class="h-28 animate-pulse opacity-60"></div>
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-billing-error">
          <h3 hlmCardTitle>Couldn't load billing</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 max-w-3xl">
          <div hlmCard data-testid="v2-billing-plan">
            <div class="flex items-center justify-between gap-2">
              <h3 hlmCardTitle>Plan</h3>
              <span hlmBadge [variant]="statusVariant(sub()!.status)">{{ sub()!.status || 'unknown' }}</span>
            </div>
            <p class="mt-2 text-2xl font-semibold capitalize text-foreground">{{ sub()!.plan || 'free' }}</p>
            <button hlmBtn variant="primary" size="sm" class="mt-3" (click)="openPortal()" [disabled]="portalLoading()"
                    data-testid="v2-billing-portal">
              {{ portalLoading() ? 'Opening…' : 'Manage billing' }}
            </button>
          </div>

          <div hlmCard data-testid="v2-billing-entitlements">
            <h3 hlmCardTitle>Entitlements</h3>
            <ul class="mt-3 flex flex-col gap-2 text-sm">
              <li class="flex items-center justify-between">
                <span class="text-muted-foreground">Custom domains</span>
                <span class="tabular-nums text-foreground"><app-rolling-counter [value]="ent()!.maxCustomDomains" /></span>
              </li>
              @for (f of flags(); track f.label) {
                <li class="flex items-center justify-between">
                  <span class="text-muted-foreground">{{ f.label }}</span>
                  <span hlmBadge [variant]="f.on ? 'success' : 'neutral'">{{ f.on ? 'enabled' : 'off' }}</span>
                </li>
              }
            </ul>
          </div>
        </div>
      }
    }
  `,
})
export class V2BillingComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly portalLoading = signal(false);

  protected readonly state = toSignal(
    forkJoin({
      sub: this.api.getSubscription(),
      ent: this.api.getEntitlements(),
    }).pipe(
      // `/api/billing/subscription` returns { data: null } for free orgs with no
      // active subscription — default to a free-plan object so the template never
      // dereferences null.
      map(
        (r) =>
          ({
            status: 'ready',
            sub: r.sub.data ?? { plan: 'free', status: 'none' },
            ent: r.ent.data,
          }) as BillingState,
      ),
      startWith({ status: 'loading' } as BillingState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as BillingState),
      ),
    ),
    { initialValue: { status: 'loading' } as BillingState },
  );

  protected readonly sub = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.sub : null;
  });
  protected readonly ent = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.ent : null;
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected readonly flags = computed(() => {
    const e = this.ent();
    if (!e) return [];
    return [
      { label: 'AI chat', on: e.chatEnabled },
      { label: 'Analytics', on: e.analyticsEnabled },
      { label: 'Top bar hidden', on: e.topBarHidden },
    ];
  });

  protected openPortal(): void {
    this.portalLoading.set(true);
    this.api
      .getBillingPortal(location.href)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.portalLoading.set(false);
          const url = res?.data?.portal_url;
          if (url) location.assign(url);
        },
        error: () => this.portalLoading.set(false),
      });
  }

  protected reload(): void {
    location.reload();
  }

  protected statusVariant(status: string): BadgeVariant {
    switch (status) {
      case 'active':
        return 'success';
      case 'past_due':
      case 'unpaid':
        return 'danger';
      case 'trialing':
        return 'info';
      default:
        return 'neutral';
    }
  }
}
