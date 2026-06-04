import { Component, input } from '@angular/core';

/**
 * @module components/mini-empty
 *
 * @description
 * Compact cyan empty-state for SUB-PANELS (a card's inner list/table that has no
 * rows yet) — calmer than the full-page `<app-empty-state>` / `.empty-state-pretty`
 * hero, but cohesive with the cockpit accent language. An accent-tinted glyph disc
 * (caller projects the icon SVG) above a muted one-line message.
 *
 * Use for secondary/sub-list empties (analytics top-pages, log results, …); use
 * the larger primitives for a section's primary empty state.
 *
 * @example
 * ```html
 * <app-mini-empty text="No logs match your filters.">
 *   <svg viewBox="0 0 24 24" …></svg>
 * </app-mini-empty>
 * ```
 *
 * @remarks role=status so the empty condition is announced once; the projected
 * glyph is decorative (`aria-hidden`) — the text carries the meaning.
 *
 * @packageDocumentation
 */
@Component({
  selector: 'app-mini-empty',
  standalone: true,
  template: `
    <div class="mini-empty" role="status">
      <span class="mini-empty-glyph" aria-hidden="true"><ng-content></ng-content></span>
      <p class="mini-empty-tx m-0">{{ text() }}</p>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .mini-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 22px 0; text-align: center; }
    .mini-empty-glyph {
      width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%;
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 8%, transparent);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 22%, transparent);
      color: var(--ps-accent, #00E5FF);
    }
    .mini-empty-tx { color: rgba(244,244,255,0.6); font-size: 0.8rem; }
  `],
})
export class MiniEmptyComponent {
  /** The one-line empty message (carries the accessible meaning). */
  readonly text = input.required<string>();
}
