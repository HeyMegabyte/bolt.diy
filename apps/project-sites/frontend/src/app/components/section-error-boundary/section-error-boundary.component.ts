/**
 * @module components/section-error-boundary
 *
 * @description
 * Angular standalone error boundary for admin sections.
 * Approximates React's per-section ErrorBoundary by listening to the global
 * `SectionErrorBus` and swapping `<ng-content>` for a friendly fallback panel
 * when the active route segment crashes. Includes:
 *   - "Reload section" — destroys + re-mounts the child via signal flip
 *   - "Copy diagnostics" — copies a redacted, paste-ready bug report
 *   - "Report" — best-effort POST to `/api/internal/client-error` (Sentry sink)
 */

import { CommonModule } from '@angular/common';
import { Component, inject, signal, type OnDestroy, type OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ToastService } from '../../services/toast.service';
import { SectionErrorBus, type SectionError } from './section-error-bus';

@Component({
  selector: 'app-section-error-boundary',
  standalone: true,
  imports: [],
  template: `
    @if (hasError()) {
      <section
        class="section-error-boundary"
        role="alert"
        aria-live="polite"
        data-testid="section-error-boundary"
      >
        <div class="boundary-card">
          <div class="boundary-glow" aria-hidden="true"></div>
          <div class="boundary-icon" aria-hidden="true">
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
              />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h3 class="boundary-title">This section ran into a problem</h3>
          <p class="boundary-message">{{ errorMessage() }}</p>
          <div class="boundary-actions">
            <button
              type="button"
              class="boundary-btn primary"
              (click)="reload()"
              data-testid="section-error-reload"
            >
              Reload section
            </button>
            <button
              type="button"
              class="boundary-btn ghost"
              (click)="copyDiagnostics()"
              data-testid="section-error-copy"
            >
              Copy diagnostics
            </button>
            <button
              type="button"
              class="boundary-btn ghost"
              (click)="report()"
              data-testid="section-error-report"
            >
              Report
            </button>
          </div>
          @if (lastError()?.route; as r) {
            <p class="boundary-meta">
              <span class="meta-label">route</span> {{ r }}
              <span class="meta-sep">·</span>
              <span class="meta-label">at</span> {{ formatTime(lastError()?.ts) }}
            </p>
          }
        </div>
      </section>
    } @else if (renderKey()) {
      <ng-content></ng-content>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .section-error-boundary {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: clamp(2rem, 5vw, 3rem) 1.5rem;
        min-height: 50vh;
      }

      .boundary-card {
        position: relative;
        max-width: 520px;
        width: 100%;
        text-align: center;
        background: linear-gradient(
          180deg,
          oklch(0.18 0.05 290 / 0.85),
          oklch(0.12 0.04 290 / 0.92)
        );
        border: 1px solid color-mix(in oklch, oklch(0.72 0.22 25) 22%, transparent);
        border-radius: 18px;
        padding: clamp(1.5rem, 4vw, 2.2rem) clamp(1.25rem, 3vw, 2rem);
        box-shadow:
          0 24px 60px rgba(0, 0, 0, 0.45),
          0 1px 0 rgba(255, 255, 255, 0.04) inset,
          0 0 0 1px color-mix(in oklch, oklch(0.7 0.2 25) 8%, transparent) inset;
        backdrop-filter: blur(14px) saturate(140%);
        overflow: hidden;
      }
      .boundary-glow {
        position: absolute;
        inset: -40% -10% auto -10%;
        height: 70%;
        background: radial-gradient(
          ellipse at top,
          color-mix(in oklch, oklch(0.7 0.22 25) 35%, transparent) 0%,
          transparent 65%
        );
        filter: blur(40px);
        pointer-events: none;
        opacity: 0.85;
      }

      .boundary-icon {
        position: relative;
        width: 60px;
        height: 60px;
        border-radius: 16px;
        margin: 0 auto 1.1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: color-mix(in oklch, oklch(0.72 0.22 25) 14%, transparent);
        color: oklch(0.82 0.18 25);
        box-shadow:
          0 0 0 1px color-mix(in oklch, oklch(0.72 0.22 25) 25%, transparent),
          0 8px 28px color-mix(in oklch, oklch(0.5 0.22 25) 30%, transparent);
      }

      .boundary-title {
        font-family: 'Sora', system-ui, sans-serif;
        font-size: clamp(1.05rem, 1.5vw, 1.25rem);
        font-weight: 600;
        color: #fff;
        margin: 0 0 0.55rem;
        letter-spacing: -0.015em;
        text-wrap: balance;
      }
      .boundary-message {
        font-size: 0.9rem;
        color: rgba(255, 255, 255, 0.72);
        margin: 0 0 1.5rem;
        line-height: 1.55;
        text-wrap: pretty;
      }

      .boundary-actions {
        display: flex;
        gap: 0.55rem;
        justify-content: center;
        margin-bottom: 1rem;
        flex-wrap: wrap;
      }
      .boundary-btn {
        position: relative;
        padding: 0.6rem 1.15rem;
        border-radius: 10px;
        font-size: 0.84rem;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid transparent;
        transition:
          transform 160ms ease,
          filter 160ms ease,
          background 160ms ease;
        font-family: inherit;
      }
      .boundary-btn:focus-visible {
        outline: 2px solid #00E5FF;
        outline-offset: 2px;
      }
      .boundary-btn.primary {
        background: linear-gradient(135deg, #00E5FF, #00d4ff);
        color: #060610;
        box-shadow: 0 6px 18px color-mix(in oklch, oklch(0.7 0.2 195) 30%, transparent);
      }
      .boundary-btn.primary:hover {
        filter: brightness(1.08);
        transform: translateY(-1px);
      }
      .boundary-btn.primary:active {
        transform: translateY(0);
      }
      .boundary-btn.ghost {
        background: transparent;
        color: rgba(255, 255, 255, 0.88);
        border-color: rgba(255, 255, 255, 0.18);
      }
      .boundary-btn.ghost:hover {
        background: rgba(255, 255, 255, 0.07);
        border-color: rgba(255, 255, 255, 0.28);
      }

      .boundary-meta {
        font-size: 0.7rem;
        color: rgba(255, 255, 255, 0.42);
        margin: 0;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        letter-spacing: 0.02em;
      }
      .meta-label {
        color: rgba(255, 255, 255, 0.32);
      }
      .meta-sep {
        margin: 0 0.4rem;
        opacity: 0.4;
      }

      @media (prefers-reduced-motion: reduce) {
        .boundary-btn {
          transition: none;
        }
        .boundary-btn:hover {
          transform: none;
        }
      }
    `,
  ],
})
export class SectionErrorBoundaryComponent implements OnInit, OnDestroy {
  private readonly bus = inject(SectionErrorBus);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  hasError = signal(false);
  lastError = signal<SectionError | null>(null);
  errorMessage = signal(
    'We caught the crash and kept the rest of the dashboard running. Try reloading just this section.',
  );
  renderKey = signal(true);

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.bus.errors$.subscribe((err) => {
      const currentRoute = this.router.url.split('?')[0] ?? '';
      if (err.route && !currentRoute.startsWith(err.route)) return;
      this.lastError.set(err);
      this.hasError.set(true);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  reload(): void {
    this.hasError.set(false);
    this.lastError.set(null);
    this.renderKey.set(false);
    setTimeout(() => this.renderKey.set(true), 0);
  }

  /** Copy a paste-ready diagnostics block — redacted, no PII beyond user agent + route. */
  async copyDiagnostics(): Promise<void> {
    const err = this.lastError();
    const lines = [
      'ProjectSites — section error report',
      `time: ${new Date(err?.ts ?? Date.now()).toISOString()}`,
      `route: ${err?.route ?? this.router.url}`,
      `message: ${err?.message ?? 'unknown'}`,
      `userAgent: ${navigator.userAgent}`,
      err?.stack ? `stack:\n${err.stack}` : 'stack: (not captured)',
    ];
    const blob = lines.join('\n');
    try {
      await navigator.clipboard.writeText(blob);
      this.toast.success('Diagnostics copied — paste into the bug report.');
    } catch {
      this.toast.error('Could not access the clipboard. Try again or use Report.');
    }
  }

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
        keepalive: true,
      })
        .then(() => this.toast.success('Reported — thanks. We are on it.'))
        .catch(() =>
          this.toast.error('Could not reach the server. Please retry.', {
            action: { label: 'Retry', run: () => this.report() },
          }),
        );
    } catch {
      this.toast.error('Could not reach the server. Please retry.', {
        action: { label: 'Retry', run: () => this.report() },
      });
    }
  }

  formatTime(ts?: number): string {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
}
