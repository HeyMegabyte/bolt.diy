/**
 * @module components/section-error-boundary/section-error-bus
 *
 * @description
 * Global RxJS subject that fans uncaught client errors out to any mounted
 * {@link SectionErrorBoundaryComponent}. The application's
 * {@link GlobalErrorHandler} pushes here; boundaries subscribe and filter by
 * route segment.
 *
 * Decoupling via a bus avoids a hard dependency from the global error
 * handler on the boundary component, and lets multiple boundaries coexist
 * (e.g., one per pane in a future split-view).
 *
 * @example
 * ```ts
 * // From GlobalErrorHandler:
 * inject(SectionErrorBus).push({ message: err.message, stack: err.stack, route });
 *
 * // From SectionErrorBoundaryComponent (ngOnInit):
 * this.bus.errors$.subscribe((e) => this.handle(e));
 * ```
 */

import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Shape of one error pushed onto the bus. */
export interface SectionError {
  /** User-safe summary (never raw stack trace text). */
  readonly message: string;
  /** Original stack trace if available — sent server-side, not rendered. */
  readonly stack?: string;
  /** Route that was active when the error fired (used for boundary filtering). */
  readonly route?: string;
  /** Authenticated user id, when known. */
  readonly userId?: string;
  /** Epoch ms when the error was observed. */
  readonly ts: number;
}

@Injectable({ providedIn: 'root' })
export class SectionErrorBus {
  private readonly subject = new Subject<SectionError>();

  /** Hot observable of every error pushed onto the bus. */
  readonly errors$ = this.subject.asObservable();

  /**
   * Publish an error to every subscribed boundary.
   *
   * @param err - Partial error shape (ts auto-filled if missing).
   */
  push(err: Omit<SectionError, 'ts'> & { ts?: number }): void {
    this.subject.next({ ts: Date.now(), ...err });
  }
}
