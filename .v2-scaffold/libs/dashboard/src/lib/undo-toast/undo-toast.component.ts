/**
 * `UndoToastComponent` — renders the currently-armed undo toast.
 *
 * Reads `UndoManagerService.toast` (signal). When non-null, shows the
 * label + an "Undo" button + a thin progress bar that drains over the
 * action's TTL. Dismisses automatically when the service clears.
 *
 * Mount once in the dashboard shell — never per feature.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { UndoManagerService } from '../services/undo-manager.service';

@Component({
  selector: 'lib-undo-toast',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (toast(); as t) {
      <div
        class="ps-undo-toast"
        role="status"
        aria-live="polite"
        data-testid="undo-toast"
      >
        <span class="ps-undo-toast__label">{{ t.label }}</span>
        <button
          type="button"
          class="ps-undo-toast__btn"
          (click)="trigger()"
          data-testid="undo-toast-button"
        >
          Undo
          <kbd class="ps-undo-toast__kbd">⌘Z</kbd>
        </button>
        <button
          type="button"
          class="ps-undo-toast__dismiss"
          (click)="dismiss()"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    }
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: auto 0 1.4rem 0;
        display: flex;
        justify-content: center;
        pointer-events: none;
        z-index: var(--ps-z-toast, 9999);
      }
      .ps-undo-toast {
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        gap: 0.85rem;
        padding: 0.7rem 1rem 0.7rem 1.1rem;
        background: var(--ps-elev-3, #14142a);
        color: var(--ps-ink, #f4f4ff);
        border: 1px solid var(--ps-hairline-hi, rgba(255, 255, 255, 0.14));
        border-radius: var(--ps-radius-lg, 16px);
        box-shadow: var(--ps-shadow-lg, 0 16px 40px -16px rgba(0, 0, 0, 0.55));
        max-width: min(420px, 90vw);
      }
      .ps-undo-toast__label {
        font-size: 0.88rem;
      }
      .ps-undo-toast__btn {
        appearance: none;
        background: transparent;
        color: var(--ps-ink-accent, var(--ps-accent, #00e5ff));
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 50%, transparent);
        border-radius: 0.5rem;
        padding: 0.35rem 0.65rem;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: baseline;
        gap: 0.4rem;
      }
      .ps-undo-toast__btn:hover,
      .ps-undo-toast__btn:focus-visible {
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent);
        outline: none;
      }
      .ps-undo-toast__kbd {
        font-family: var(--ps-font-mono, ui-monospace, monospace);
        font-size: 0.7rem;
        color: color-mix(in oklch, currentColor 70%, transparent);
      }
      .ps-undo-toast__dismiss {
        appearance: none;
        background: transparent;
        color: inherit;
        border: 0;
        font-size: 1.1rem;
        cursor: pointer;
        opacity: 0.55;
      }
      .ps-undo-toast__dismiss:hover,
      .ps-undo-toast__dismiss:focus-visible {
        opacity: 1;
        outline: none;
      }
      @media (prefers-reduced-motion: no-preference) {
        .ps-undo-toast {
          animation: undo-enter 180ms var(--ps-easing-out, ease-out);
        }
      }
      @keyframes undo-enter {
        from {
          transform: translateY(8px);
          opacity: 0;
        }
        to {
          transform: none;
          opacity: 1;
        }
      }
    `,
  ],
})
export class UndoToastComponent {
  private readonly undo = inject(UndoManagerService);
  readonly toast = computed(() => this.undo.toast());
  /** Reserved hook for future preview / metric counters. */
  protected readonly _hidden = signal(false);

  trigger(): void {
    void this.undo.undo();
  }

  dismiss(): void {
    this.undo.dismiss();
  }
}
