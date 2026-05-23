/**
 * @module components/network-status/network-status-banner
 *
 * @description
 * Persistent top-edge banner that surfaces when the browser reports
 * `navigator.onLine === false`. Wires `window.online`/`window.offline`
 * events, sits above all chrome, respects `prefers-reduced-motion`, and
 * lets the user dismiss until the next status flip.
 *
 * Mounted once at the app root (see {@link AppComponent}).
 */

import { Component, OnDestroy, OnInit, signal } from '@angular/core';

@Component({
  selector: 'app-network-status-banner',
  standalone: true,
  template: `
    @if (visible()) {
      <div
        class="netbanner"
        [class.online]="online()"
        role="status"
        aria-live="polite"
        data-testid="network-status-banner"
      >
        <span class="netbanner-dot" aria-hidden="true"></span>
        @if (online()) {
          <span>Back online. Reconnecting…</span>
        } @else {
          <span>You're offline. Changes will retry when the connection returns.</span>
        }
        <button
          type="button"
          class="netbanner-close"
          aria-label="Dismiss connection notice"
          (click)="dismiss()"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    }
  `,
  styles: [`
    :host { position: relative; z-index: 10000; }
    .netbanner {
      position: fixed; top: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 10px;
      padding: 8px clamp(12px, 3vw, 20px);
      font-size: 0.82rem;
      font-weight: 500;
      letter-spacing: -0.005em;
      background:
        linear-gradient(180deg,
          oklch(0.32 0.14 25 / 0.94),
          oklch(0.22 0.10 25 / 0.94));
      color: oklch(0.95 0.04 25);
      border-bottom: 1px solid color-mix(in oklch, oklch(0.7 0.2 25) 35%, transparent);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(14px) saturate(160%);
      animation: netbanner-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .netbanner.online {
      background:
        linear-gradient(180deg,
          oklch(0.32 0.14 162 / 0.94),
          oklch(0.22 0.10 162 / 0.94));
      color: oklch(0.95 0.04 162);
      border-bottom-color: color-mix(in oklch, oklch(0.7 0.2 162) 35%, transparent);
    }
    .netbanner-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 0 4px color-mix(in oklch, currentColor 18%, transparent);
      animation: netbanner-pulse 1.6s infinite ease-out;
    }
    .netbanner-close {
      margin-left: auto;
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      background: transparent; border: 0; color: inherit;
      cursor: pointer; padding: 0; opacity: 0.7;
      border-radius: 6px;
      transition: opacity 140ms, background 140ms;
    }
    .netbanner-close:hover { opacity: 1; background: color-mix(in oklch, currentColor 14%, transparent); }
    .netbanner-close:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; opacity: 1; }

    @keyframes netbanner-in {
      from { transform: translateY(-100%); opacity: 0; }
      to   { transform: translateY(0); opacity: 1; }
    }
    @keyframes netbanner-pulse {
      0%   { box-shadow: 0 0 0 0 color-mix(in oklch, currentColor 35%, transparent); }
      80%  { box-shadow: 0 0 0 10px color-mix(in oklch, currentColor 0%, transparent); }
      100% { box-shadow: 0 0 0 0 color-mix(in oklch, currentColor 0%, transparent); }
    }
    @media (prefers-reduced-motion: reduce) {
      .netbanner { animation: none; }
      .netbanner-dot { animation: none; }
    }
  `],
})
export class NetworkStatusBannerComponent implements OnInit, OnDestroy {
  readonly online = signal(true);
  readonly visible = signal(false);

  private dismissedAtFlip = false;
  private readonly onOnline = (): void => this.setStatus(true);
  private readonly onOffline = (): void => this.setStatus(false);

  ngOnInit(): void {
    if (typeof window === 'undefined') return;
    this.online.set(navigator.onLine);
    // Show the banner only when actually offline at mount time.
    this.visible.set(!navigator.onLine);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
  }

  ngOnDestroy(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
  }

  private setStatus(online: boolean): void {
    this.online.set(online);
    this.dismissedAtFlip = false;
    this.visible.set(true);
    if (online) {
      // Auto-hide the "back online" success state after a moment.
      setTimeout(() => {
        if (!this.dismissedAtFlip) this.visible.set(false);
      }, 3500);
    }
  }

  dismiss(): void {
    this.dismissedAtFlip = true;
    this.visible.set(false);
  }
}
