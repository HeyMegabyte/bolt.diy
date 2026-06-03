import { Component, inject } from '@angular/core';
import { ToastService, type Toast } from '../../services/toast.service';
import { toastSlide } from '../../animations/motion';

@Component({
  selector: 'app-toast',
  standalone: true,
  animations: [toastSlide],
  template: `
    <div class="toast-container" aria-live="polite" aria-atomic="false">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          @toastSlide
          class="toast"
          [class]="'toast-' + toast.type"
          [attr.role]="toast.type === 'error' || toast.action ? 'alert' : 'status'"
          data-testid="toast-item"
          [attr.data-toast-type]="toast.type"
          tabindex="0"
          (click)="dismissUnlessAction($event, toast)"
          (keydown.escape)="toastService.dismiss(toast.id)"
        >
          <span class="toast-icon" aria-hidden="true">
            @switch (toast.type) {
              @case ('error') {
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>
                </svg>
              }
              @case ('warning') {
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              }
              @case ('success') {
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
                </svg>
              }
              @default {
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
                </svg>
              }
            }
          </span>

          <span class="toast-body">
            <span class="toast-text">{{ toast.message }}</span>
            @if (toast.correlationId) {
              <span class="toast-correlation" title="Request ID — copy for support">
                ref&nbsp;{{ toast.correlationId.slice(0, 8) }}
              </span>
            }
          </span>

          @if (toast.action) {
            <button
              class="toast-action"
              type="button"
              (click)="$event.stopPropagation(); runAction(toast)"
            >{{ toast.action.label }}</button>
          }

          <button
            class="toast-close"
            type="button"
            (click)="$event.stopPropagation(); toastService.dismiss(toast.id)"
            aria-label="Dismiss notification"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { position: fixed; inset: 0; pointer-events: none; z-index: var(--z-toast, 9999); }

    .toast-container {
      position: fixed;
      top: clamp(64px, 8vw, 96px);
      right: clamp(12px, 3vw, 28px);
      display: flex; flex-direction: column; gap: 10px;
      max-width: min(420px, calc(100vw - 24px));
      pointer-events: none;
    }

    .toast {
      position: relative;
      pointer-events: auto;
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: center;
      gap: 12px;
      padding: 13px 15px;
      border-radius: 14px;
      font-size: 0.875rem;
      font-weight: 500;
      font-family: 'Space Grotesk', system-ui, sans-serif;
      line-height: 1.35;
      letter-spacing: -0.005em;
      cursor: pointer;
      backdrop-filter: blur(22px) saturate(170%);
      -webkit-backdrop-filter: blur(22px) saturate(170%);
      box-shadow:
        0 14px 44px rgba(0, 0, 0, 0.58),
        0 0 0 1px color-mix(in oklch, currentColor 22%, transparent),
        0 0 60px color-mix(in oklch, currentColor 8%, transparent),
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        inset 0 -1px 0 rgba(0, 0, 0, 0.25);
      transition:
        transform 220ms var(--ps-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)),
        box-shadow 220ms;
      will-change: transform;
      isolation: isolate;
    }
    /* Gradient rim-highlight along the leading edge — type-color tinted. */
    .toast::before {
      content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg,
        transparent,
        color-mix(in oklch, currentColor 80%, transparent) 30%,
        color-mix(in oklch, currentColor 60%, transparent) 70%,
        transparent);
      opacity: 0.55;
      pointer-events: none;
      border-radius: 14px 14px 0 0;
    }
    .toast:hover {
      transform: translateX(-4px) translateY(-1px);
      box-shadow:
        0 18px 52px rgba(0, 0, 0, 0.62),
        0 0 0 1px color-mix(in oklch, currentColor 38%, transparent),
        0 0 80px color-mix(in oklch, currentColor 16%, transparent),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }
    .toast:focus-visible {
      outline: 2px solid color-mix(in oklch, currentColor 60%, transparent);
      outline-offset: 2px;
    }

    .toast-icon { display: flex; align-items: center; }
    .toast-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .toast-text {
      overflow-wrap: anywhere;
      text-wrap: pretty;
    }
    .toast-correlation {
      font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
      font-size: 0.68rem;
      opacity: 0.55;
      letter-spacing: 0.02em;
    }

    .toast-action {
      pointer-events: auto;
      font: inherit;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 8px;
      background: color-mix(in oklch, currentColor 14%, transparent);
      border: 1px solid color-mix(in oklch, currentColor 28%, transparent);
      color: inherit;
      cursor: pointer;
      transition: background 160ms, transform 160ms;
      white-space: nowrap;
    }
    .toast-action:hover { background: color-mix(in oklch, currentColor 22%, transparent); }
    .toast-action:active { transform: translateY(1px); }
    .toast-action:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }

    .toast-close {
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      background: transparent; border: 0; color: inherit;
      cursor: pointer; padding: 0; opacity: 0.55;
      border-radius: 6px;
      transition: opacity 140ms, background 140ms;
    }
    .toast-close:hover { opacity: 1; background: color-mix(in oklch, currentColor 14%, transparent); }
    .toast-close:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; opacity: 1; }

    /* Type variants — OKLCH brand-locked, WCAG AA-safe on dark canvas. */
    .toast-error {
      color: oklch(0.78 0.18 25);
      background:
        linear-gradient(180deg, oklch(0.32 0.14 25 / 0.32), oklch(0.18 0.09 25 / 0.92)),
        rgba(8, 8, 18, 0.92);
      border: 1px solid color-mix(in oklch, oklch(0.7 0.2 25) 38%, transparent);
    }
    .toast-warning {
      color: oklch(0.86 0.16 78);
      background:
        linear-gradient(180deg, oklch(0.34 0.12 78 / 0.32), oklch(0.18 0.08 78 / 0.92)),
        rgba(8, 8, 18, 0.92);
      border: 1px solid color-mix(in oklch, oklch(0.78 0.18 78) 36%, transparent);
    }
    .toast-success {
      color: oklch(0.86 0.18 162);
      background:
        linear-gradient(180deg, oklch(0.32 0.14 162 / 0.32), oklch(0.18 0.08 162 / 0.92)),
        rgba(8, 8, 18, 0.92);
      border: 1px solid color-mix(in oklch, oklch(0.78 0.2 162) 36%, transparent);
    }
    .toast-info {
      color: oklch(0.88 0.15 220);
      background:
        linear-gradient(180deg, oklch(0.32 0.14 220 / 0.34), oklch(0.18 0.08 220 / 0.92)),
        rgba(8, 8, 18, 0.92);
      border: 1px solid color-mix(in oklch, oklch(0.82 0.18 220) 38%, transparent);
    }

    @media (max-width: 480px) {
      .toast-container { left: 12px; right: 12px; max-width: none; }
      .toast { grid-template-columns: auto 1fr auto; }
      .toast-action { grid-column: 1 / -1; justify-self: start; margin-top: 4px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .toast { transition: none; }
      .toast:hover { transform: none; }
    }
  `],
})
export class ToastComponent {
  readonly toastService = inject(ToastService);

  /** Clicking the toast surface dismisses it — except when the click came from the action button. */
  dismissUnlessAction(event: MouseEvent, toast: Toast): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.toast-action, .toast-close')) return;
    this.toastService.dismiss(toast.id);
  }

  runAction(toast: Toast): void {
    try {
      toast.action?.run(toast.id);
    } finally {
      this.toastService.dismiss(toast.id);
    }
  }
}
