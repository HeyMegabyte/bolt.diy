import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * @module components/char-count
 *
 * Reusable live character counter for any length-capped text input/textarea.
 *
 * @remarks
 * Admin has ~11 `maxlength`-capped fields that previously hit their limit
 * silently. Drop this under the control to show a cyan `N/MAX` counter that
 * turns amber as the cap nears, plus a polite screen-reader announcement that
 * fires ONLY inside the final stretch (so sighted users get the running count
 * without SR users hearing every keystroke).
 *
 * - Visual counter is `aria-hidden` (the host control's own `maxlength` is the
 *   hard guarantee; the counter is a sighted affordance).
 * - The `role="status"` live region stays empty until `remaining <= liveThreshold`,
 *   then announces "N characters left" — a heads-up near the cap, not spam.
 *
 * @example
 * ```html
 * <textarea [(ngModel)]="model" maxlength="4000"></textarea>
 * <app-char-count [value]="model" [max]="4000" />
 * ```
 */
@Component({
  selector: 'app-char-count',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cc" [class.cc-near]="near()" data-testid="char-count">{{ len() }}/{{ max() }}</div>
    <span class="cc-sr" role="status" aria-live="polite">{{ liveMsg() }}</span>
  `,
  styles: [`
    :host { display: block; }
    .cc {
      font-size: 0.62rem;
      color: rgba(255, 255, 255, 0.4);
      text-align: right;
      margin-top: 3px;
      transition: color 140ms ease;
      font-variant-numeric: tabular-nums;
    }
    .cc-near { color: oklch(0.82 0.16 75); } /* amber as the cap nears */
    .cc-sr {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }
  `],
})
export class CharCountComponent {
  /** Current field value (bind the same model the input is bound to). */
  readonly value = input<string | null | undefined>('');
  /** Hard character cap (matches the control's `maxlength`). */
  readonly max = input.required<number>();
  /** Fraction of `max` at which the counter turns amber (default 0.9). */
  readonly warnRatio = input(0.9);
  /** Announce "N characters left" once remaining drops to this or below. */
  readonly liveThreshold = input(20);

  readonly len = computed(() => (this.value() ?? '').length);
  readonly near = computed(() => this.len() >= this.max() * this.warnRatio());
  readonly liveMsg = computed(() => {
    const remaining = this.max() - this.len();
    return remaining <= this.liveThreshold() && remaining >= 0 ? `${remaining} characters left` : '';
  });
}
