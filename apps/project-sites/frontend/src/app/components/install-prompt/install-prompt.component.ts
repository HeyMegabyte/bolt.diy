import {
  Component,
  HostListener,
  signal,
  computed,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * The Chromium `beforeinstallprompt` event — not in the standard DOM lib.
 * @see https://developer.mozilla.org/docs/Web/API/BeforeInstallPromptEvent
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'ps_pwa_install_dismissed';

/**
 * Add-to-Home-Screen (A2HS) install prompt — backlog #25.
 *
 * @remarks
 * Captures the browser's `beforeinstallprompt`, suppresses the default mini-bar,
 * and surfaces our own branded, dismissible chip ONLY when the app is genuinely
 * installable. Deferred-ask doctrine (per `always.md` § PWA): never nags — a
 * dismissal is remembered in localStorage, and the chip never shows when the app
 * is already running standalone or already installed. Pure enhancement: it has
 * no critical path, so app.component defers it off the initial bundle.
 *
 * @example
 * <app-install-prompt />
 */
@Component({
  selector: 'app-install-prompt',
  standalone: true,
  template: `
    @if (visible()) {
      <div class="install-chip" role="dialog" aria-label="Install Project Sites" data-testid="install-prompt">
        <span class="install-chip__icon" aria-hidden="true">⤓</span>
        <div class="install-chip__text">
          <strong>Install Project Sites</strong>
          <span>Add it to your home screen — launches like a native app, works offline.</span>
        </div>
        <div class="install-chip__actions">
          <button type="button" class="install-chip__cta" data-testid="install-accept" (click)="install()">
            Install
          </button>
          <button type="button" class="install-chip__dismiss" aria-label="Dismiss install prompt" data-testid="install-dismiss" (click)="dismiss()">
            ✕
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    @keyframes install-in {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .install-chip {
      position: fixed;
      left: 20px;
      bottom: 20px;
      z-index: 9990;
      max-width: 360px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 14px 14px 16px;
      border-radius: 16px;
      background: color-mix(in oklch, var(--ps-bg, #060610) 92%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(0, 229, 255, 0.22);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(0, 229, 255, 0.05);
      animation: install-in 360ms cubic-bezier(0.22, 0.9, 0.3, 1) both;
    }
    .install-chip__icon {
      font-size: 1.3rem;
      line-height: 1;
      color: var(--ps-accent, #00e5ff);
      margin-top: 2px;
      flex-shrink: 0;
    }
    .install-chip__text { display: flex; flex-direction: column; gap: 3px; }
    .install-chip__text strong { font-size: 0.9rem; font-weight: 700; color: var(--ps-ink, #f4f4ff); }
    .install-chip__text span { font-size: 0.78rem; line-height: 1.45; color: #94a3b8; }
    .install-chip__actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 2px; }
    .install-chip__cta {
      font-size: 0.8rem;
      font-weight: 700;
      padding: 7px 14px;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      color: var(--ps-bg, #060610);
      background: var(--ps-accent, #00e5ff);
      transition: filter 0.333s ease, transform 0.333s ease;
    }
    .install-chip__cta:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .install-chip__cta:focus-visible { outline: 2px solid var(--ps-ink, #f4f4ff); outline-offset: 2px; }
    .install-chip__dismiss {
      font-size: 0.85rem;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      color: #94a3b8;
      background: rgba(255, 255, 255, 0.04);
      transition: color 0.333s ease, background 0.333s ease;
    }
    .install-chip__dismiss:hover { color: var(--ps-ink, #f4f4ff); background: rgba(255, 255, 255, 0.08); }
    .install-chip__dismiss:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }

    @media (max-width: 480px) {
      .install-chip { left: 12px; right: 12px; bottom: 12px; max-width: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .install-chip { animation: none; }
      .install-chip__cta { transition: none; }
      .install-chip__cta:hover { transform: none; }
    }
  `],
})
export class InstallPromptComponent {
  private readonly platformId = inject(PLATFORM_ID);

  /** The captured, still-usable install event (single-use; cleared after prompt). */
  private readonly deferred = signal<BeforeInstallPromptEvent | null>(null);
  /** User dismissed this session, OR a prior dismissal is remembered. */
  private readonly dismissed = signal<boolean>(false);

  /** True only when installable, not already installed, and not dismissed. */
  readonly visible = computed(() => this.deferred() !== null && !this.dismissed());

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    // Already installed / running standalone → never offer install.
    if (this.isStandalone() || this.wasDismissed()) this.dismissed.set(true);
  }

  @HostListener('window:beforeinstallprompt', ['$event'])
  onBeforeInstall(e: Event): void {
    // Suppress Chrome's default mini-infobar; we render our own branded chip.
    e.preventDefault();
    if (this.dismissed()) return;
    this.deferred.set(e as BeforeInstallPromptEvent);
  }

  @HostListener('window:appinstalled')
  onInstalled(): void {
    this.deferred.set(null);
    this.dismissed.set(true);
    this.remember();
  }

  async install(): Promise<void> {
    const evt = this.deferred();
    if (!evt) return;
    this.deferred.set(null); // single-use — drop before awaiting so the chip hides immediately
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      // If they declined the native sheet, don't re-nag this session.
      if (choice?.outcome === 'dismissed') this.remember();
    } catch {
      /* prompt() can reject if already consumed — safe to ignore */
    }
  }

  dismiss(): void {
    this.dismissed.set(true);
    this.remember();
  }

  private isStandalone(): boolean {
    try {
      return (
        window.matchMedia?.('(display-mode: standalone)').matches === true ||
        // iOS Safari exposes navigator.standalone instead of display-mode.
        (navigator as unknown as { standalone?: boolean }).standalone === true
      );
    } catch {
      return false;
    }
  }

  private wasDismissed(): boolean {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  }

  private remember(): void {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode / quota — non-fatal */
    }
  }
}
