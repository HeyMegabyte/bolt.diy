/**
 * @module components/side-panel
 *
 * @description
 * Standardized right-side drawer used across the admin overhaul. One component
 * for every "slide in from the right, dim the background, smooth animation"
 * surface — the Editor's Ask AI panel, future filter drawers, etc.
 *
 * Slots:
 *  - `[panelTitle]` — bold header text
 *  - `[panelSubtitle]` — optional sub-line
 *  - `[panelActions]` — header-right action row (icons/buttons)
 *  - default `<ng-content>` — body
 *  - `[panelFooter]` — sticky bottom bar (Save / Cancel)
 *
 * @example
 * ```html
 * <app-side-panel [open]="askOpen()" widthFraction="0.5" (closed)="askOpen.set(false)">
 *   <span panelTitle>Ask AI</span>
 *   <span panelSubtitle>This site's chat context is loaded</span>
 *   <!-- body -->
 *   <my-chat-form />
 *   <div panelFooter><button>Send</button></div>
 * </app-side-panel>
 * ```
 */

import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  input,
  output,
  type AfterViewInit,
  type OnDestroy,
  ElementRef,
} from '@angular/core';
import { A11yModule, ConfigurableFocusTrapFactory, type ConfigurableFocusTrap } from '@angular/cdk/a11y';

@Component({
  selector: 'app-side-panel',
  standalone: true,
  imports: [A11yModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div
        class="sp-root"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="ariaLabel()"
        (click)="onBackdropClick($event)"
      >
        <div class="sp-backdrop" aria-hidden="true"></div>
        <aside
          class="sp-panel"
          [style.width]="widthCss()"
          (click)="$event.stopPropagation()"
        >
          <header class="sp-head">
            <div class="sp-head-text">
              <div class="sp-title"><ng-content select="[panelTitle]"></ng-content></div>
              <div class="sp-sub"><ng-content select="[panelSubtitle]"></ng-content></div>
            </div>
            <div class="sp-head-actions">
              <ng-content select="[panelActions]"></ng-content>
              <button
                type="button"
                class="sp-close"
                aria-label="Close panel"
                (click)="close()"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                </svg>
              </button>
            </div>
          </header>
          <div class="sp-body">
            <ng-content></ng-content>
          </div>
          <footer class="sp-foot">
            <ng-content select="[panelFooter]"></ng-content>
          </footer>
        </aside>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    .sp-root {
      position: fixed; inset: 0;
      z-index: var(--ps-z-side-panel, 2050);
      display: flex;
      justify-content: flex-end;
    }
    .sp-backdrop {
      position: absolute; inset: 0;
      background:
        radial-gradient(ellipse 80% 60% at 70% 40%, rgba(0, 229, 255, 0.06), transparent 60%),
        rgba(2, 2, 10, 0.62);
      backdrop-filter: blur(14px) saturate(150%);
      -webkit-backdrop-filter: blur(14px) saturate(150%);
      animation: sp-backdrop-in var(--ps-dur-base, 220ms) var(--ps-ease-out, ease-out) both;
    }
    .sp-panel {
      position: relative;
      height: 100vh;
      max-width: 100vw;
      background:
        linear-gradient(180deg,
          var(--ps-surface-1, rgba(13, 13, 40, 0.92)),
          var(--ps-surface-2, rgba(10, 10, 30, 0.97)));
      border-left: 1px solid color-mix(in oklch, #00E5FF 24%, transparent);
      box-shadow:
        var(--ps-shadow-xl, 0 24px 64px rgba(0, 0, 0, 0.55)),
        0 0 120px rgba(0, 229, 255, 0.06),
        inset 1px 0 0 rgba(255, 255, 255, 0.04);
      display: flex; flex-direction: column;
      animation: sp-slide-in var(--ps-dur-slow, 380ms) var(--ps-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
      isolation: isolate;
    }
    /* Vertical rim-light along the leading edge. */
    .sp-panel::before {
      content: ""; position: absolute; top: 0; bottom: 0; left: -1px;
      width: 1px;
      background: linear-gradient(180deg,
        transparent 0%,
        rgba(0, 229, 255, 0.55) 18%,
        rgba(124, 58, 237, 0.42) 62%,
        transparent 100%);
      pointer-events: none;
    }

    .sp-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px;
      padding: 18px 20px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      background:
        radial-gradient(ellipse 100% 80% at 0% 0%, rgba(0, 229, 255, 0.06), transparent 60%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0));
      position: relative;
    }
    .sp-head::after {
      content: ""; position: absolute; left: 16px; right: 16px; bottom: -1px;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.30), transparent);
      pointer-events: none;
    }
    .sp-head-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .sp-title {
      font-family: 'Sora', system-ui, sans-serif;
      font-weight: 600; letter-spacing: -0.02em;
      font-size: 1rem; color: #fff;
      text-wrap: balance;
    }
    .sp-sub {
      font-size: 0.74rem;
      color: rgba(255, 255, 255, 0.6);
      line-height: 1.4;
    }
    .sp-sub:empty { display: none; }

    .sp-head-actions { display: flex; align-items: center; gap: 6px; }
    .sp-close {
      width: 32px; height: 32px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.7);
      border-radius: var(--ps-radius-sm, 8px);
      cursor: pointer;
      transition:
        background var(--ps-dur-fast, 140ms) var(--ps-ease-emphasized, cubic-bezier(0.16,1,0.3,1)),
        color var(--ps-dur-fast, 140ms),
        border-color var(--ps-dur-fast, 140ms),
        transform var(--ps-dur-fast, 140ms) var(--ps-ease-emphasized, cubic-bezier(0.16,1,0.3,1)),
        box-shadow var(--ps-dur-base, 220ms);
    }
    .sp-close:hover {
      background: rgba(0, 229, 255, 0.10);
      color: #fff;
      border-color: rgba(0, 229, 255, 0.30);
      transform: rotate(90deg) scale(1.05);
      box-shadow: 0 0 14px rgba(0, 229, 255, 0.22);
    }
    .sp-close:active { transform: rotate(90deg) scale(0.96); transition-duration: 80ms; }
    .sp-close:focus-visible {
      outline: var(--ps-ring-focus, 2px solid #00E5FF);
      outline-offset: var(--ps-ring-focus-offset, 2px);
    }

    .sp-body {
      flex: 1; min-height: 0;
      overflow-y: auto;
      padding: 16px 20px;
    }
    .sp-foot {
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .sp-foot:empty { display: none; }

    @keyframes sp-backdrop-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes sp-slide-in {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0);     opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .sp-backdrop { animation: none; }
      .sp-panel { animation: none; }
    }
  `],
})
export class SidePanelComponent implements AfterViewInit, OnDestroy {
  private readonly el = inject(ElementRef);
  private readonly focusTrapFactory = inject(ConfigurableFocusTrapFactory);
  private focusTrap?: ConfigurableFocusTrap;

  /** Controls panel visibility. */
  readonly open = input<boolean>(false);
  /** Closing the panel emits this. Parent binds `(closed)="setOpen(false)"`. */
  readonly closed = output<void>();

  /** Set to false to disable click-outside-to-close. */
  readonly closeOnBackdrop = input<boolean>(true);
  /** Width as a CSS fraction of the viewport (default half). Accepts any CSS length. */
  readonly widthFraction = input<number>(0.5);
  readonly widthCss = (): string => `min(${Math.round(this.widthFraction() * 100)}vw, 720px)`;
  /** Aria label for screen readers. */
  readonly ariaLabel = input<string>('Side panel');

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.close();
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      const panel = this.el.nativeElement.querySelector('.sp-panel');
      if (panel) {
        this.focusTrap = this.focusTrapFactory.create(panel);
        this.focusTrap.focusInitialElementWhenReady();
      }
    });
  }

  ngOnDestroy(): void {
    this.focusTrap?.destroy();
  }

  onBackdropClick(_event: MouseEvent): void {
    if (!this.closeOnBackdrop()) return;
    this.close();
  }

  close(): void {
    this.closed.emit();
  }
}
