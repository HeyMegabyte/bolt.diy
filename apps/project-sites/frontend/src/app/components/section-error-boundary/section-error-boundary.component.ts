/**
 * @module components/section-error-boundary
 *
 * @description
 * Angular standalone error boundary for admin sections (item #53).
 *
 * Angular has no native `ErrorBoundary` — the `ErrorHandler` token is a
 * single global. This component approximates React's per-section boundary
 * by:
 *   1. Subscribing to the {@link SectionErrorBus} (a global RxJS subject the
 *      app's {@link GlobalErrorHandler} pushes into),
 *   2. Filtering errors to the currently-active route segment so a crash in
 *      `/admin/analytics` doesn't show the fallback under `/admin/forms`,
 *   3. Swapping its `<ng-content>` for a friendly fallback panel with
 *      "Reload section" + "Report" buttons,
 *   4. "Reload section" toggles an internal signal that destroys and
 *      re-instantiates the child content via `@if` (Angular's idiomatic
 *      replacement for React `key=` remount).
 *
 * @example
 * ```html
 * <app-section-error-boundary>
 *   <router-outlet></router-outlet>
 * </app-section-error-boundary>
 * ```
 */

import { CommonModule } from '@angular/common';
import {
  Component,
  inject,
  signal,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ToastService } from '../../services/toast.service';
import { SectionErrorBus, type SectionError } from './section-error-bus';

@Component({
  selector: 'app-section-error-boundary',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (hasError()) {
      <section
        class="section-error-boundary"
        role="alert"
        aria-live="polite"
        data-testid="section-error-boundary"
      >
        <div class="boundary-card">
          <div class="boundary-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <h3 class="boundary-title">This section ran into a problem</h3>
          <p class="boundary-message">{{ errorMessage() }}</p>
          <div class="boundary-actions">
            <button type="button" class="boundary-btn primary"
                    (click)="reload()" data-testid="section-error-reload">
              Reload section
            </button>
            <button type="button" class="boundary-btn ghost"
                    (click)="report()" data-testid="section-error-report">
              Report
            </button>
          </div>
          <p class="boundary-meta" *ngIf="lastError()?.route as r">Route: {{ r }}</p>
        </div>
      </section>
    } @else if (renderKey()) {
      <ng-content></ng-content>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .section-error-boundary {
        display: flex; align-items: center; justify-content: center;
        padding: 3rem 1.5rem; min-height: 50vh;
      }
      .boundary-card {
        max-width: 480px; width: 100%; text-align: center;
        background: rgba(13, 13, 40, 0.6);
        border: 1px solid rgba(255, 80, 80, 0.18);
        border-radius: 16px; padding: 2rem 1.75rem;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(12px);
      }
      .boundary-icon {
        width: 56px; height: 56px; border-radius: 14px;
        margin: 0 auto 1rem;
        display: flex; align-items: center; justify-content: center;
        background: rgba(255, 80, 80, 0.08);
        color: #ff6b6b;
      }
      .boundary-title {
        font-size: 1.15rem; font-weight: 700; color: #fff;
        margin: 0 0 0.5rem;
      }
      .boundary-message {
        font-size: 0.88rem; color: rgba(255, 255, 255, 0.7);
        margin: 0 0 1.5rem; line-height: 1.5;
      }
      .boundary-actions {
        display: flex; gap: 0.75rem; justify-content: center;
        margin-bottom: 1rem;
      }
      .boundary-btn {
        padding: 0.6rem 1.2rem; border-radius: 10px;
        font-size: 0.85rem; font-weight: 600; cursor: pointer;
        border: 1px solid transparent; transition: all 0.18s ease;
      }
      .boundary-btn.primary {
        background: #00E5FF; color: #060610;
      }
      .boundary-btn.primary:hover { filter: brightness(1.12); }
      .boundary-btn.ghost {
        background: transparent; color: rgba(255, 255, 255, 0.85);
        border-color: rgba(255, 255, 255, 0.18);
      }
      .boundary-btn.ghost:hover { background: rgba(255, 255, 255, 0.06); }
      .boundary-meta {
        font-size: 0.7rem; color: rgba(255, 255, 255, 0.4);
        margin: 0; font-family: 'JetBrains Mono', monospace;
      }
    `,
  ],
})
export class SectionErrorBoundaryComponent implements OnInit, OnDestroy {
  private readonly bus = inject(SectionErrorBus);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** True when the current section threw and the fallback should render. */
  hasError = signal(false);

  /** The last captured error, surfaced for "Report" + meta line. */
  lastError = signal<SectionError | null>(null);

  /** User-safe error message — never raw stack traces. */
  errorMessage = signal('We caught the crash and kept the rest of the dashboard running. Try reloading just this section.');

  /**
   * Render key — flipped to false then back to true on reload so Angular
   * destroys + re-instantiates the `<ng-content>` (idiomatic re-mount).
   */
  renderKey = signal(true);

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.bus.errors$.subscribe((err) => {
      // Only react to errors on the route this boundary wraps.
      const currentRoute = this.router.url.split('?')[0] ?? '';
      if (err.route && !currentRoute.startsWith(err.route)) return;
      this.lastError.set(err);
      this.hasError.set(true);
    });

    // Reset boundary on successful navigation away.
    this.router.events.subscribe(() => {
      // No-op; the parent will swap routes naturally.
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Re-instantiate the child content + clear the error flag. */
  reload(): void {
    this.hasError.set(false);
    this.lastError.set(null);
    this.renderKey.set(false);
    setTimeout(() => this.renderKey.set(true), 0);
  }

  /**
   * Forward the captured error to the server-side `/api/internal/client-error`
   * endpoint, which fans it out to Sentry via the Worker's Toucan client.
   */
  report(): void {
    const err = this.lastError();
    if (!err) return;
    const payload = {
      message: err.message,
      stack: err.stack ?? null,
      route: err.route ?? this.router.url,
      userId: err.userId ?? null,
    };
    try {
      void fetch('/api/internal/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        // Keep alive briefly so it survives a section reload.
        keepalive: true,
      })
        .then(() => this.toast.success('Reported — thanks. We are on it.'))
        .catch(() => this.toast.error('Could not reach the server. Please retry.'));
    } catch {
      this.toast.error('Could not reach the server. Please retry.');
    }
  }
}
