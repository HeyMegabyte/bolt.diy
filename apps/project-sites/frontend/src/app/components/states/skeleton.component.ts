import {
  ChangeDetectionStrategy,
  Component,
  computed,
  Input,
  signal,
} from '@angular/core';

/** Skeleton layout variant — drives the placeholder geometry. */
export type SkeletonVariant = 'card' | 'table' | 'text' | 'chart';

/**
 * `app-skeleton` — shimmering placeholder while data loads. One of the three
 * Cockpit-v2 state primitives (skeleton / empty / error) so the 54 admin
 * sections stop hand-rolling "Loading…" divs.
 *
 * @remarks
 * - Cockpit-v2 design tokens only (`--ps-*` with safe fallbacks). No hardcoded hex.
 * - `prefers-reduced-motion: reduce` → the shimmer sweep is disabled; the bars
 *   stay as static, dimmed placeholders (never blank, never animated).
 * - `aria-busy="true"` + `role="status"` + visually-hidden "Loading" label so
 *   assistive tech announces the loading state without a spinner of text noise.
 * - SSR-safe — pure CSS, no browser APIs touched.
 *
 * @example
 * ```html
 * <app-skeleton variant="table" [rows]="6" />
 * <app-skeleton variant="card" [rows]="3" />
 * <app-skeleton variant="chart" />
 * <app-skeleton variant="text" [rows]="4" />
 * ```
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-variant]': 'variant',
    '[style.--sk-cols]': 'columns',
    'aria-busy': 'true',
    'aria-live': 'polite',
    role: 'status',
  },
  selector: 'app-skeleton',
  standalone: true,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .sk-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      /* Shimmer bar — single source of the loading look. Self-contained so it
         doesn't depend on a global @keyframes that may not be present. */
      .sk-bar {
        position: relative;
        display: block;
        height: 14px;
        border-radius: var(--ps-radius-sm, 8px);
        overflow: hidden;
        background: var(
          --ps-surface-2,
          color-mix(in oklch, var(--ps-ink, #f4f4ff) 6%, transparent)
        );
        border: 1px solid var(--ps-hairline, rgba(255, 255, 255, 0.08));
      }
      .sk-bar::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          transparent 0,
          color-mix(in oklch, var(--ps-ink, #f4f4ff) 7%, transparent) 40%,
          var(--ps-accent-soft, rgba(0, 229, 255, 0.14)) 50%,
          color-mix(in oklch, var(--ps-ink, #f4f4ff) 7%, transparent) 60%,
          transparent 100%
        );
        background-size: 200% 100%;
        animation: skShine 1.5s linear infinite;
      }

      @keyframes skShine {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }

      /* TABLE variant */
      .sk-table {
        display: flex;
        flex-direction: column;
        gap: var(--ps-gap, 10px);
        border: 1px solid var(--ps-hairline, rgba(255, 255, 255, 0.08));
        border-radius: var(--ps-radius-lg, 16px);
        background: var(--ps-surface-1, rgba(255, 255, 255, 0.02));
        padding: 16px;
      }
      .sk-row {
        display: grid;
        grid-template-columns: 1.6fr repeat(4, 1fr);
        gap: 16px;
        align-items: center;
      }
      .sk-row--head .sk-bar {
        height: 10px;
        opacity: 0.6;
      }

      /* CARD variant */
      .sk-cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--ps-gap, 14px);
      }
      .sk-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        border: 1px solid var(--ps-hairline, rgba(255, 255, 255, 0.08));
        border-radius: var(--ps-radius-lg, 16px);
        background: var(--ps-surface-1, rgba(255, 255, 255, 0.02));
        padding: 16px;
      }
      .sk-bar--media {
        height: 120px;
        border-radius: var(--ps-radius-md, 12px);
      }
      .sk-bar--title {
        height: 18px;
        width: 62%;
      }
      .sk-bar--line {
        height: 12px;
      }
      .sk-bar--short {
        width: 45%;
      }

      /* CHART variant */
      .sk-chart {
        display: flex;
        flex-direction: column;
        gap: 14px;
        border: 1px solid var(--ps-hairline, rgba(255, 255, 255, 0.08));
        border-radius: var(--ps-radius-lg, 16px);
        background: var(--ps-surface-1, rgba(255, 255, 255, 0.02));
        padding: 16px;
      }
      .sk-chart-area {
        position: relative;
        height: 180px;
        border-radius: var(--ps-radius-md, 12px);
        overflow: hidden;
        background: var(
          --ps-surface-2,
          color-mix(in oklch, var(--ps-ink, #f4f4ff) 6%, transparent)
        );
        border: 1px solid var(--ps-hairline, rgba(255, 255, 255, 0.08));
      }
      .sk-chart-area::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          transparent 0,
          var(--ps-accent-soft, rgba(0, 229, 255, 0.14)) 50%,
          transparent 100%
        );
        background-size: 200% 100%;
        animation: skShine 1.5s linear infinite;
      }
      .sk-chart-axis {
        display: grid;
        grid-template-columns: repeat(var(--sk-cols, 5), 1fr);
        gap: 10px;
      }
      .sk-bar--tick {
        height: 8px;
      }

      /* TEXT variant */
      .sk-text {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      @media (prefers-reduced-motion: reduce) {
        .sk-bar::after,
        .sk-chart-area::after {
          animation: none;
          background: none;
        }
        .sk-bar,
        .sk-chart-area {
          opacity: 0.55;
        }
      }
    `,
  ],
  template: `
    <span class="sk-sr">{{ label }}</span>

    @switch (variant) {
      @case ('table') {
        <div class="sk-table" aria-hidden="true">
          <div class="sk-row sk-row--head">
            @for (c of cols(); track c) {
              <span class="sk-bar"></span>
            }
          </div>
          @for (r of rowList(); track r) {
            <div class="sk-row">
              @for (c of cols(); track c) {
                <span class="sk-bar"></span>
              }
            </div>
          }
        </div>
      }
      @case ('card') {
        <div class="sk-cards" aria-hidden="true">
          @for (r of rowList(); track r) {
            <div class="sk-card">
              <span class="sk-bar sk-bar--media"></span>
              <span class="sk-bar sk-bar--title"></span>
              <span class="sk-bar sk-bar--line"></span>
              <span class="sk-bar sk-bar--line sk-bar--short"></span>
            </div>
          }
        </div>
      }
      @case ('chart') {
        <div class="sk-chart" aria-hidden="true">
          <span class="sk-bar sk-bar--title"></span>
          <div class="sk-chart-area"></div>
          <div class="sk-chart-axis">
            @for (c of cols(); track c) {
              <span class="sk-bar sk-bar--tick"></span>
            }
          </div>
        </div>
      }
      @default {
        <div class="sk-text" aria-hidden="true">
          @for (r of rowList(); track r; let last = $last) {
            <span class="sk-bar sk-bar--line" [class.sk-bar--short]="last"></span>
          }
        </div>
      }
    }
  `,
})
export class SkeletonComponent {
  /** Layout variant. */
  @Input()
  set variant(v: SkeletonVariant) {
    this._variant.set(v);
  }
  get variant(): SkeletonVariant {
    return this._variant();
  }
  private readonly _variant = signal<SkeletonVariant>('text');

  /** Number of placeholder rows / cards / lines to render. */
  @Input()
  set rows(n: number) {
    this._rows.set(Math.max(1, Math.floor(n)));
  }
  get rows(): number {
    return this._rows();
  }
  private readonly _rows = signal(3);

  /** Number of placeholder columns (table head + body, chart ticks). */
  @Input()
  set columns(n: number) {
    this._cols.set(Math.max(1, Math.floor(n)));
  }
  get columns(): number {
    return this._cols();
  }
  private readonly _cols = signal(5);

  /** Screen-reader label announced while loading. */
  @Input() label = 'Loading…';

  protected readonly rowList = computed(() =>
    Array.from({ length: this._rows() }, (_, i) => i),
  );
  protected readonly cols = computed(() =>
    Array.from({ length: this._cols() }, (_, i) => i),
  );
}
