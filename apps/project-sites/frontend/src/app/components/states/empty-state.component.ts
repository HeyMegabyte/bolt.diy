import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';

/**
 * `app-empty-state` — friendly, on-brand "nothing here yet" surface. One of the
 * three Cockpit-v2 state primitives. Per the extra-mile mandate, a "no results"
 * empty state should make the CTA the *first-result action* ("Create your first
 * site"), never a dead-end "No data" line.
 *
 * @remarks
 * - Cockpit-v2 design tokens only (`--ps-*` with safe fallbacks). No hardcoded hex.
 * - `role="status"` so AT announces the empty condition once.
 * - CTA is a real `<button>` with `:focus-visible` ring + ≥24px tap target.
 * - Title uses `text-wrap: balance`, message `text-wrap: pretty`.
 * - Optional `icon` slot (emoji or short glyph); decorative, `aria-hidden`.
 *
 * @example
 * ```html
 * <app-empty-state
 *   icon="🌐"
 *   title="No sites yet"
 *   message="Spin up your first AI-built site to see it here."
 *   ctaLabel="Create your first site"
 *   (ctaClick)="goCreate()" />
 * ```
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-live': 'polite', role: 'status' },
  selector: 'app-empty-state',
  standalone: true,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
      .es {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        text-align: center;
        padding: 44px 24px;
        border: 1px dashed var(--ps-hairline, rgba(255, 255, 255, 0.08));
        border-radius: var(--ps-radius-lg, 16px);
        background: var(--ps-surface-1, rgba(255, 255, 255, 0.02));
      }
      .es-icon {
        font-size: 2rem;
        line-height: 1;
        opacity: 0.9;
        filter: drop-shadow(0 0 14px var(--ps-accent-soft, rgba(0, 229, 255, 0.14)));
      }
      .es-title {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 600;
        color: var(--ps-ink, #f4f4ff);
        text-wrap: balance;
      }
      .es-msg {
        margin: 0;
        max-width: 42ch;
        font-size: 0.85rem;
        line-height: 1.5;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 62%, transparent);
        text-wrap: pretty;
      }
      .es-cta {
        margin-top: 6px;
        min-height: 24px;
        min-width: 24px;
        padding: 9px 18px;
        font-size: 0.82rem;
        font-weight: 600;
        color: var(--ps-bg, #060610);
        background: var(--ps-accent, #00e5ff);
        border: 1px solid var(--ps-accent, #00e5ff);
        border-radius: var(--ps-radius-md, 12px);
        cursor: pointer;
        transition:
          transform var(--ps-dur-fast, 140ms) var(--ps-ease-out, ease),
          box-shadow var(--ps-dur-fast, 140ms) var(--ps-ease-out, ease);
      }
      .es-cta:hover {
        transform: translateY(-1px);
        box-shadow: 0 0 24px var(--ps-accent-soft, rgba(0, 229, 255, 0.14));
      }
      .es-cta:focus-visible {
        outline: 3px solid var(--ps-accent, #00e5ff);
        outline-offset: var(--ps-ring-focus-offset, 2px);
      }
      @media (prefers-reduced-motion: reduce) {
        .es-cta {
          transition: none;
        }
        .es-cta:hover {
          transform: none;
        }
      }
    `,
  ],
  template: `
    <div class="es" data-testid="empty-state">
      @if (icon) {
        <div class="es-icon" aria-hidden="true">{{ icon }}</div>
      }
      <h3 class="es-title" data-testid="empty-title">{{ title }}</h3>
      @if (message) {
        <p class="es-msg">{{ message }}</p>
      }
      @if (ctaLabel) {
        <button
          type="button"
          class="es-cta"
          data-testid="empty-cta"
          (click)="ctaClick.emit()"
        >
          {{ ctaLabel }}
        </button>
      }
    </div>
  `,
})
export class EmptyStateComponent {
  /** Optional decorative glyph / emoji shown above the title. */
  @Input() icon = '';

  /** Headline — what's missing. Required for a meaningful empty state. */
  @Input({ required: true }) title = '';

  /** Supporting one-liner explaining the empty condition. */
  @Input() message = '';

  /** CTA label. When set, renders the first-result action button. */
  @Input() ctaLabel = '';

  /** Fires when the CTA button is activated. */
  @Output() ctaClick = new EventEmitter<void>();
}
