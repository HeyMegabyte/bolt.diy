import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, provideAppInitializer } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject,
  catchError,
  EMPTY,
  firstValueFrom,
  repeat,
  Subscription,
  switchMap,
  tap,
  timer,
  type Observable,
} from 'rxjs';
import type { Capability, Me, Tenant } from '../types/domain';

/**
 * Holds the `/api/me` payload (user, capabilities, tenants,
 * currentTenant, isSuperAdmin) as signals while keeping the underlying
 * stream observable for refresh / polling per [[rxjs-first-angular]].
 *
 * Boot wiring: call {@link provideMeInitializer} in `app.config.ts` to
 * fetch `/api/me` before the first router activation.
 */
@Injectable({ providedIn: 'root' })
export class MeStore {
  private readonly http = inject(HttpClient);

  private readonly meSubject = new BehaviorSubject<Me | null>(null);

  /** Stream for RxJS consumers (e.g., effects, interceptors). */
  readonly me$: Observable<Me | null> = this.meSubject.asObservable();

  /** Snapshot signal of the latest `/api/me` payload. */
  readonly me = toSignal(this.me$, { initialValue: null });

  readonly user = computed(() => this.me()?.user ?? null);
  readonly capabilities = computed<readonly Capability[]>(
    () => this.me()?.capabilities ?? [],
  );
  readonly tenants = computed<readonly Tenant[]>(() => this.me()?.tenants ?? []);
  readonly currentTenant = computed<Tenant | null>(
    () => this.me()?.currentTenant ?? null,
  );
  readonly isSuperAdmin = computed<boolean>(() => this.me()?.isSuperAdmin ?? false);

  /** True when the user can switch between multiple tenants. */
  readonly hasMultipleTenants = computed<boolean>(() => this.tenants().length > 1);

  private refreshSub: Subscription | null = null;

  /** Imperative one-shot fetch — used by the app initializer. */
  fetch(): Promise<Me | null> {
    return firstValueFrom(
      this.http.get<Me>('/api/me').pipe(
        tap((me) => this.meSubject.next(me)),
        catchError(() => {
          this.meSubject.next(null);
          return EMPTY;
        }),
      ),
      { defaultValue: null },
    );
  }

  /**
   * Starts a 60-second background refresh. Idempotent — safe to call
   * from the shell `ngOnInit`. Internal stream stays observable; the
   * signal updates whenever a response lands.
   */
  startRefresh(intervalMs = 60_000): void {
    if (this.refreshSub) return;
    this.refreshSub = timer(intervalMs)
      .pipe(
        switchMap(() => this.http.get<Me>('/api/me')),
        tap((me) => this.meSubject.next(me)),
        catchError(() => EMPTY),
        repeat({ delay: intervalMs }),
      )
      .subscribe();
  }

  stopRefresh(): void {
    this.refreshSub?.unsubscribe();
    this.refreshSub = null;
  }
}

/**
 * `provideAppInitializer` wiring that warms `/api/me` before the router
 * activates the first route. Drop into `app.config.ts` providers.
 */
export function provideMeInitializer() {
  return provideAppInitializer(() => inject(MeStore).fetch());
}
