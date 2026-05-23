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
  inject,
  input,
  output,
  type AfterViewInit,
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
    }
  `,
  styles: [`
    :host { display: contents; }

    .fo-root {
      position: fixed; inset: 0;
      z-index: var(--ps-z-overlay-takeover, 2100);
      display: flex; flex-direction: column;
      background:
        radial-gradient(ellipse at top, rgba(0, 229, 255, 0.04), transparent 60%),
        var(--ps-surface-3, rgba(8, 8, 32, 0.98));
      animation: fo-in var(--ps-dur-slow, 380ms) var(--ps-ease-emphasized, cubic-bezier(0.16, 1, 0.3, 1)) both;
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
export class FullscreenOverlayComponent implements AfterViewInit, OnDestroy {
  private readonly el = inject(ElementRef);
  private readonly focusTrapFactory = inject(ConfigurableFocusTrapFactory);
  private focusTrap?: ConfigurableFocusTrap;

  readonly open = input<boolean>(false);
  readonly closed = output<void>();
  readonly ariaLabel = input<string>('Fullscreen overlay');

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.close();
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      const root = this.el.nativeElement.querySelector('.fo-root');
      if (root) {
        this.focusTrap = this.focusTrapFactory.create(root);
        this.focusTrap.focusInitialElementWhenReady();
      }
    });
  }

  ngOnDestroy(): void {
    this.focusTrap?.destroy();
  }

  close(): void {
    this.closed.emit();
  }
}
