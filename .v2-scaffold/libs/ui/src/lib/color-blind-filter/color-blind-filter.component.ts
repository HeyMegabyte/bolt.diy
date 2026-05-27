/**
 * ColorBlindFilterComponent — renders the SVG `<filter>` defs needed for a
 * designer-mode "View as" dropdown.
 *
 * Per Brettel et al. (1997) "Computerized simulation of color appearance for
 * dichromats" + Machado et al. (2009) "A Physiologically-based Model for
 * Simulation of Color Vision Deficiency". The matrices below are the standard
 * 3×3 RGB transforms used by browser devtools (Chrome's Rendering panel uses
 * the same Machado coefficients at severity 1.0).
 *
 * The host emits SVG `<filter id="...">` definitions; consumers point
 * `filter: url(#cbf-deutan)` at any iframe / element they want simulated.
 *
 * @example
 * ```html
 * <lib-color-blind-filter />
 * <iframe [style.filter]="mode() === 'normal' ? null : 'url(#cbf-' + mode() + ')'"></iframe>
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type ColorBlindMode =
  | 'normal'
  | 'deuteranopia'
  | 'protanopia'
  | 'tritanopia'
  | 'achromatopsia';

interface FilterDef {
  readonly id: ColorBlindMode;
  readonly label: string;
  /** Row-major 4×5 matrix — first three rows = RGB transform, alpha row pass-through. */
  readonly matrix: readonly number[];
}

/**
 * Machado et al. 2009 matrices at severity 1.0, plus the standard
 * luminance-preserving achromatopsia (full grey-scale) matrix. Sources:
 *   - Machado, G.M., Oliveira, M.M., & Fernandes, L.A.F. (2009). "A
 *     Physiologically-based Model for Simulation of Color Vision Deficiency."
 *     IEEE Transactions on Visualization and Computer Graphics, 15(6).
 *   - Brettel, H., Viénot, F., & Mollon, J.D. (1997). "Computerized simulation
 *     of color appearance for dichromats." J. Opt. Soc. Am. A 14, 2647-2655.
 *
 * Chrome devtools' Rendering panel uses the same severity-1.0 Machado values;
 * the matrices below are reproduced verbatim so the simulator output matches
 * what a designer sees in devtools.
 */
export const COLOR_BLIND_MATRICES: readonly FilterDef[] = [
  {
    id: 'deuteranopia',
    label: 'Deuteranopia (red-green, missing M cones)',
    matrix: [
      0.367,  0.861, -0.228, 0, 0,
      0.280,  0.673,  0.047, 0, 0,
     -0.012,  0.043,  0.969, 0, 0,
      0,      0,      0,     1, 0,
    ],
  },
  {
    id: 'protanopia',
    label: 'Protanopia (red-green, missing L cones)',
    matrix: [
      0.152,  1.053, -0.205, 0, 0,
      0.115,  0.786,  0.099, 0, 0,
     -0.004, -0.048,  1.052, 0, 0,
      0,      0,      0,     1, 0,
    ],
  },
  {
    id: 'tritanopia',
    label: 'Tritanopia (blue-yellow, missing S cones)',
    matrix: [
      1.255, -0.077, -0.178, 0, 0,
     -0.078,  0.931,  0.148, 0, 0,
      0.005,  0.691,  0.304, 0, 0,
      0,      0,      0,     1, 0,
    ],
  },
  {
    id: 'achromatopsia',
    label: 'Achromatopsia (no color)',
    matrix: [
      0.299, 0.587, 0.114, 0, 0,
      0.299, 0.587, 0.114, 0, 0,
      0.299, 0.587, 0.114, 0, 0,
      0,     0,     0,     1, 0,
    ],
  },
];

@Component({
  selector: 'lib-color-blind-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- Visually-hidden SVG defs registering each filter id. -->
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style="position:absolute;width:0;height:0;overflow:hidden"
    >
      <defs>
        @for (f of filters; track f.id) {
          <filter [attr.id]="'cbf-' + f.id" color-interpolation-filters="sRGB">
            <feColorMatrix
              type="matrix"
              [attr.values]="matrixToString(f.matrix)"
            />
          </filter>
        }
      </defs>
    </svg>

    @if (showSelector) {
      <label class="cbf__selector" data-testid="cbf-selector">
        <span class="cbf__label">View as</span>
        <select
          [ngModel]="mode"
          (ngModelChange)="onModeChange($event)"
          [attr.aria-label]="'Simulate color vision deficiency'"
          data-testid="cbf-select"
        >
          <option value="normal">Normal vision</option>
          @for (f of filters; track f.id) {
            <option [value]="f.id">{{ f.label }}</option>
          }
        </select>
      </label>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .cbf__selector {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        font: inherit;
      }
      .cbf__label {
        font-size: 0.78rem;
        opacity: 0.75;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .cbf__selector select {
        appearance: none;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: inherit;
        padding: 6px 10px;
        border-radius: 10px;
        font: inherit;
      }
    `,
  ],
})
export class ColorBlindFilterComponent {
  @Input() mode: ColorBlindMode = 'normal';
  @Input() showSelector = true;
  @Output() readonly modeChange = new EventEmitter<ColorBlindMode>();

  readonly filters = COLOR_BLIND_MATRICES;

  /** Returns the CSS `filter` value for a given mode, or `null` for normal. */
  static cssFilterFor(mode: ColorBlindMode): string | null {
    return mode === 'normal' ? null : `url(#cbf-${mode})`;
  }

  protected matrixToString(m: readonly number[]): string {
    return m.map((n) => n.toFixed(4)).join(' ');
  }

  protected onModeChange(next: ColorBlindMode): void {
    this.mode = next;
    this.modeChange.emit(next);
  }
}
