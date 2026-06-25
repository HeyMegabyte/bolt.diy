/**
 * S3 — vision radar. Draws the 6-axis Llama-4 Scout visual score
 * (layout / typography / color / imagery / whitespace / distinctiveness) that
 * snapshot-quality already STORES per capture (`vision_scores_json`) but never
 * drew. Dependency-free inline SVG — no ECharts — so it stays lean and adds zero
 * bundle weight. Scores are 0–10; pass the parsed axes in via `[scores]`.
 */
import { Component, input, computed } from '@angular/core';

export interface VisionAxis {
  axis: string;
  value: number;
}

/** Parse a `vision_scores_json` blob into ordered radar axes (null on bad input). */
export function parseVisionScores(json: string | null | undefined): VisionAxis[] | null {
  if (!json) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const order: Array<[string, string]> = [
    ['layout', 'Layout'],
    ['typography', 'Type'],
    ['color', 'Color'],
    ['imagery', 'Imagery'],
    ['whitespace', 'Space'],
    ['distinctiveness', 'Distinct'],
  ];
  const axes = order
    .filter(([k]) => typeof o[k] === 'number' && Number.isFinite(o[k] as number))
    .map(([k, label]) => ({ axis: label, value: Math.max(0, Math.min(10, o[k] as number)) }));
  return axes.length >= 3 ? axes : null; // need ≥3 axes to make a polygon
}

const SIZE = 160;
const CENTER = SIZE / 2;
const RADIUS = 60;

@Component({
  selector: 'app-vision-radar',
  standalone: true,
  template: `
    @if (points(); as pts) {
      <figure class="vr" data-testid="vision-radar">
        <svg
          [attr.viewBox]="'0 0 ' + size + ' ' + size"
          width="160"
          height="160"
          role="img"
          [attr.aria-label]="ariaLabel()">
          <!-- concentric rings -->
          @for (r of rings; track r) {
            <polygon class="vr-ring" [attr.points]="ringPoints(r)" />
          }
          <!-- spokes -->
          @for (a of pts.axes; track a.axis; let i = $index) {
            <line class="vr-spoke" [attr.x1]="center" [attr.y1]="center" [attr.x2]="a.x" [attr.y2]="a.y" />
          }
          <!-- data polygon -->
          <polygon class="vr-area" [attr.points]="pts.poly" />
          <!-- axis labels -->
          @for (a of pts.axes; track a.axis) {
            <text class="vr-label" [attr.x]="a.lx" [attr.y]="a.ly" text-anchor="middle">{{ a.axis }}</text>
          }
        </svg>
        <figcaption class="vr-cap">Visual score {{ avg() }}/10</figcaption>
      </figure>
    }
  `,
  styles: [
    `
      .vr {
        margin: 0;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 0.2rem;
      }
      .vr-ring {
        fill: none;
        stroke: rgba(255, 255, 255, 0.07);
        stroke-width: 1;
      }
      .vr-spoke {
        stroke: rgba(255, 255, 255, 0.07);
        stroke-width: 1;
      }
      .vr-area {
        fill: color-mix(in oklch, var(--ps-accent, #00e5ff) 28%, transparent);
        stroke: var(--ps-accent, #00e5ff);
        stroke-width: 1.5;
      }
      .vr-label {
        fill: var(--text-secondary, #9aa);
        font-size: 9px;
        font-weight: 600;
      }
      .vr-cap {
        font-size: 0.68rem;
        color: var(--ps-accent, #00e5ff);
        font-weight: 700;
      }
    `,
  ],
})
export class VisionRadarComponent {
  readonly scores = input.required<VisionAxis[]>();
  readonly max = input(10);

  readonly size = SIZE;
  readonly center = CENTER;
  readonly rings = [0.33, 0.66, 1];

  readonly avg = computed(() => {
    const s = this.scores();
    if (!s.length) return '0';
    return (s.reduce((a, b) => a + b.value, 0) / s.length).toFixed(1);
  });

  readonly ariaLabel = computed(
    () => 'Visual quality radar: ' + this.scores().map((a) => `${a.axis} ${a.value}`).join(', '),
  );

  /** Pre-compute the polygon + per-axis spoke ends + label anchors. */
  readonly points = computed(() => {
    const s = this.scores();
    if (s.length < 3) return null;
    const n = s.length;
    const axes = s.map((a, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n; // start at top, clockwise
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const rData = (Math.max(0, Math.min(this.max(), a.value)) / this.max()) * RADIUS;
      return {
        axis: a.axis,
        // spoke end (full radius)
        x: CENTER + cos * RADIUS,
        y: CENTER + sin * RADIUS,
        // data vertex
        dx: CENTER + cos * rData,
        dy: CENTER + sin * rData,
        // label just outside the ring
        lx: CENTER + cos * (RADIUS + 12),
        ly: CENTER + sin * (RADIUS + 12) + 3,
      };
    });
    const poly = axes.map((a) => `${a.dx.toFixed(1)},${a.dy.toFixed(1)}`).join(' ');
    return { axes, poly };
  });

  /** A concentric ring polygon at fraction `f` of the radius. */
  ringPoints(f: number): string {
    const s = this.scores();
    const n = Math.max(3, s.length);
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      pts.push(
        `${(CENTER + Math.cos(ang) * RADIUS * f).toFixed(1)},${(CENTER + Math.sin(ang) * RADIUS * f).toFixed(1)}`,
      );
    }
    return pts.join(' ');
  }
}
