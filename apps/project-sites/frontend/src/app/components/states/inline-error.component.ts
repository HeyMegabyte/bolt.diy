import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * @module components/states/inline-error
 *
 * Compact inline error/warning chip with an optional Retry — the lightweight
 * tier below {@link ErrorCardComponent}. Use it for SECONDARY feeds where a
 * full error card would dominate (e.g. a stale connection-state banner above a
 * list of cards), where the surrounding content still renders.
 *
 * @remarks
 * Amber by default (a "this may be out of date" warning, not a hard failure);
 * pass `tone="error"` for a red hard-error treatment. `role="alert"` so the
 * message is announced. Put any `data-testid` on the host — it forwards.
 *
 * @example
 * ```html
 * <app-inline-error
 *   message="Couldn't load connection states — badges may be out of date."
 *   (retry)="reload()" />
 * ```
 */
@Component({
  selector: 'app-inline-error',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ie" [class.ie--error]="tone() === 'error'" role="alert">
      <span class="ie-msg">{{ message() }}</span>
      @if (showRetry()) {
        <button type="button" class="ie-retry" (click)="retry.emit()" data-testid="inline-error-retry">{{ retryLabel() }}</button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ie {
      display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.25rem 0.5rem;
      font-size: 0.72rem; line-height: 1.4;
      padding: 6px 10px; border-radius: 8px;
      color: oklch(0.82 0.16 75);
      background: color-mix(in oklch, oklch(0.82 0.16 75) 8%, transparent);
      border: 1px solid color-mix(in oklch, oklch(0.82 0.16 75) 28%, transparent);
    }
    .ie--error {
      color: oklch(0.72 0.19 25);
      background: color-mix(in oklch, oklch(0.72 0.19 25) 8%, transparent);
      border-color: color-mix(in oklch, oklch(0.72 0.19 25) 30%, transparent);
    }
    .ie-msg { flex: 1 1 auto; min-width: 0; }
    .ie-retry {
      flex: 0 0 auto; background: none; border: none; cursor: pointer;
      color: var(--ps-accent, #00E5FF); font-size: 0.72rem; font-weight: 600; padding: 0;
    }
    .ie-retry:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; border-radius: 3px; }
  `],
})
export class InlineErrorComponent {
  /** The message to show. */
  readonly message = input.required<string>();
  /** Retry button label. */
  readonly retryLabel = input('Retry');
  /** Whether to render the Retry button. */
  readonly showRetry = input(true);
  /** 'warn' (amber, default) for stale/out-of-date; 'error' (red) for a hard failure. */
  readonly tone = input<'warn' | 'error'>('warn');
  readonly retry = output<void>();
}
