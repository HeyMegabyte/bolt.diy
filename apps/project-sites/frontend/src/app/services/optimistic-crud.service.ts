import { Injectable, inject } from '@angular/core';
import { type Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import type { WritableSignal } from '@angular/core';

/**
 * Lightweight optimistic-CRUD wrapper around ApiService.
 *
 * Usage:
 *   optimisticCrud.save(
 *     () => this.api.put('/sites/' + id, body),
 *     this.siteSignal,
 *     body,
 *     'Site updated'
 *   );
 *
 * The signal is immediately updated with `nextValue`, the HTTP call fires,
 * and on error the signal rolls back to the pre-call value AND a toast is
 * shown with the rollback message.
 */
@Injectable({ providedIn: 'root' })
export class OptimisticCrudService {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  /** Mutate: immediately set the signal to nextValue, fire the call, rollback on error. */
  save<T>(
    call: () => Observable<T>,
    signal: WritableSignal<T>,
    nextValue: T,
    rollbackMessage = 'Changes reverted due to error',
  ): Observable<T> {
    const prev = signal();
    signal.set(nextValue);
    return call().pipe(
      tap({
        error: (err: unknown) => {
          signal.set(prev);
          const msg = err instanceof Error ? err.message : String(err);
          this.toast.show(`${rollbackMessage}: ${msg}`, 'error');
        },
      }),
    );
  }

  /** Delete: immediately remove from a signal array, fire the call, restore on error. */
  remove<T extends { id: string }>(
    call: () => Observable<unknown>,
    listSignal: WritableSignal<T[]>,
    item: T,
    rollbackMessage = 'Delete reverted',
  ): Observable<unknown> {
    const prev = listSignal();
    listSignal.set(prev.filter((x) => x.id !== item.id));
    return call().pipe(
      tap({
        error: () => {
          listSignal.set(prev);
          this.toast.show(rollbackMessage, 'error');
        },
      }),
    );
  }
}
