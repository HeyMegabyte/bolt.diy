/**
 * @module components/fullscreen-overlay
 *
 * @description
 * Full-screen "takeover" surface — used by the Forms page Prompt Designer,
 * the AI Endpoints "Open IDE" affordance, and any future immersive workflow
 * that needs to dominate the screen.
 *
 * Differences from `app-side-panel`:
 *  - Fills the entire viewport (no fractional width)
 *  - Single mandatory close affordance in the top-right
 *  - Optional split-pane body via the `[overlaySplit]` projection slot
 *
 * @example
 * ```html
 * <app-fullscreen-overlay [open]="ideOpen()" (closed)="ideOpen.set(false)" ariaLabel="Web IDE">
 *   <span overlayTitle>Web IDE — /api/quote</span>
 *   <my-monaco-editor />
 * </app-fullscreen-overlay>
 * ```
 */

import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  type OnDestroy,
  ElementRef,
} from '@angular/core';
import { A11yModule, ConfigurableFocusTrapFactory, type ConfigurableFocusTrap } from '@angular/cdk/a11y';

@Component({
  selector: 'app-fullscreen-overlay',
  standalone: true,
  imports: [A11yModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div
        class="fo-root"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="ariaLabel()"
      >
        <div class="fo-shell">
          <header class="fo-head">
            <div class="fo-head-text">
              <div class="fo-title"><ng-content select="[overlayTitle]"></ng-content></div>
              <div class="fo-sub"><ng-content select="[overlaySubtitle]"></ng-content></div>
            </div>
            <div class="fo-head-actions">
              <ng-content select="[overlayActions]"></ng-content>
              <button
                type="button"
                class="fo-close"
                aria-label="Close overlay"
                (click)="close()"
                data-testid="fullscreen-overlay-close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                </svg>
              </button>
            </div>
          </header>
          <div class="fo-body">
            <ng-content></ng-content>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    /*
     * Overlay roots as an "almost full-screen modal":
     *  - .fo-root is the FIXED backdrop (dark + blurred) that covers the
     *    underlying chrome — sidebar, top bar, toasts, network banner,
     *    user-menu popover — by virtue of --ps-z-overlay-takeover (100000).
     *  - .fo-shell is the inner card that floats inside that backdrop with
     *    breathing room on every side, rounded corners, and a modal shadow.
     */
    .fo-root {
      position: fixed; inset: 0;
      z-index: var(--ps-z-overlay-takeover, 100000);
      display: flex;
      padding: clamp(12px, 2.5vw, 32px);
      background:
        radial-gradient(ellipse at top, rgba(0, 229, 255, 0.05), transparent 60%),
        rgba(2, 2, 12, 0.78);
      backdrop-filter: blur(18px) saturate(140%);
      -webkit-backdrop-filter: blur(18px) saturate(140%);
      animation: fo-in var(--ps-dur-slow, 380ms) var(--ps-ease-emphasized, cubic-bezier(0.16, 1, 0.3, 1)) both;
    }

    .fo-shell {
      flex: 1; min-width: 0; min-height: 0;
      display: flex; flex-direction: column;
      background:
        radial-gradient(ellipse at top, rgba(0, 229, 255, 0.05), transparent 60%),
        var(--ps-surface-3, rgba(8, 8, 32, 0.98));
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: var(--ps-radius-xl, 22px);
      box-shadow: var(--ps-shadow-modal, 0 24px 64px rgba(0, 0, 0, 0.55), 0 0 80px rgba(0, 229, 255, 0.04));
      overflow: hidden;
    }

    .fo-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px;
      padding: 14px 22px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(12px) saturate(140%);
      -webkit-backdrop-filter: blur(12px) saturate(140%);
      flex-shrink: 0;
    }
    .fo-head-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .fo-title {
      font-family: 'Sora', system-ui, sans-serif;
      font-weight: 600; letter-spacing: -0.02em;
      font-size: 1.05rem; color: #fff;
      text-wrap: balance;
    }
    .fo-sub {
      font-size: 0.78rem;
      color: rgba(255, 255, 255, 0.6);
      line-height: 1.4;
    }
    .fo-sub:empty { display: none; }

    .fo-head-actions { display: flex; align-items: center; gap: 8px; }
    .fo-close {
      width: 38px; height: 38px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.8);
      border-radius: var(--ps-radius-sm, 8px);
      cursor: pointer;
      transition:
        background var(--ps-dur-fast, 140ms),
        color var(--ps-dur-fast, 140ms),
        border-color var(--ps-dur-fast, 140ms);
    }
    .fo-close:hover {
      background: rgba(255, 255, 255, 0.09);
      color: #fff;
      border-color: rgba(255, 255, 255, 0.18);
    }
    .fo-close:focus-visible {
      outline: var(--ps-ring-focus, 2px solid #00ffc8);
      outline-offset: var(--ps-ring-focus-offset, 2px);
    }

    .fo-body {
      flex: 1; min-height: 0;
      overflow: hidden;
      display: flex;
    }

    @keyframes fo-in {
      from { opacity: 0; transform: scale(0.985) translateY(8px); }
      to   { opacity: 1; transform: scale(1)     translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .fo-root { animation: none; }
    }
  `],
})
export class FullscreenOverlayComponent implements OnDestroy {
  private readonly el = inject(ElementRef);
  private readonly focusTrapFactory = inject(ConfigurableFocusTrapFactory);
  private readonly injector = inject(Injector);
  private focusTrap?: ConfigurableFocusTrap;
  /**
   * The `.fo-root` element teleported to `document.body` so it escapes any
   * ancestor stacking context (the admin top bar's `backdrop-blur` and the
   * persistent bolt iframe's `view-transition-name` both create one, and
   * even `z-index: 2147483647` can't escape a parent's stacking context).
   * Kept here so we can restore it on destroy.
   */
  private teleportedRoot: HTMLElement | null = null;

  /** Element focused before the overlay opened — restored on close (WCAG 2.4.3). */
  private previouslyFocused: HTMLElement | null = null;

  readonly open = input<boolean>(false);
  readonly closed = output<void>();
  readonly ariaLabel = input<string>('Fullscreen overlay');

  constructor() {
    // Drive teleport from the open() signal, NOT from a MutationObserver.
    // The earlier observer-based approach infinite-looped: appendChild
    // to body mutated the subtree, fired the observer, which saw root
    // missing from the host subtree, called restoreFromBody, which moved
    // it back, which fired the observer again. Forever.
    //
    // The signal effect runs exactly once per open()-state transition.
    effect(() => {
      const isOpen = this.open();
      if (isOpen) {
        // Capture the trigger BEFORE the focus trap moves focus into the overlay
        // (the trap focuses async via afterNextRender), so we can restore it on close.
        if (!this.previouslyFocused && typeof document !== 'undefined') {
          this.previouslyFocused = document.activeElement as HTMLElement | null;
        }
        // Wait for Angular to actually render `.fo-root` into the host
        // subtree before we move it.
        afterNextRender({ read: () => this.teleportToBody() }, { injector: this.injector });
      } else {
        this.cleanupTeleport();
        this.restoreFocus();
      }
    });
  }

  /** Return focus to the element that opened the overlay (WCAG 2.4.3). */
  private restoreFocus(): void {
    const el = this.previouslyFocused;
    this.previouslyFocused = null;
    if (el && typeof el.focus === 'function') {
      try { el.focus({ preventScroll: true }); } catch { /* detached/unfocusable — ignore */ }
    }
  }

  ngOnDestroy(): void {
    this.cleanupTeleport();
    this.focusTrap?.destroy();
    this.restoreFocus();
  }

  close(): void {
    this.closed.emit();
  }

  /**
   * Move `.fo-root` from its Angular-rendered slot to `document.body` so it
   * escapes every ancestor stacking context. Sets up the focus trap on the
   * newly-positioned element. Idempotent — safe to call multiple times.
   */
  private teleportToBody(): void {
    if (this.teleportedRoot && document.body.contains(this.teleportedRoot)) {
      return; // already in body
    }
    const root = this.el.nativeElement.querySelector('.fo-root') as HTMLElement | null;
    if (!root) return; // Angular hasn't rendered yet — skip silently
    document.body.appendChild(root);
    this.teleportedRoot = root;
    this.focusTrap?.destroy();
    this.focusTrap = this.focusTrapFactory.create(root);
    this.focusTrap.focusInitialElementWhenReady();
  }

  /**
   * Remove the teleported root from `document.body` so Angular can clean it
   * up. We delete the element outright — Angular's `@if (open())` will
   * re-create a fresh `.fo-root` the next time `open()` flips true.
   */
  private cleanupTeleport(): void {
    if (this.teleportedRoot) {
      this.teleportedRoot.remove();
      this.teleportedRoot = null;
    }
    this.focusTrap?.destroy();
    this.focusTrap = undefined;
  }
}
