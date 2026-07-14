/**
 * `SectionSkeletonComponent` — a shimmer placeholder rendered while a lazy-loaded
 * admin section chunk downloads. Reuses the _polish.scss `.skeleton` keyframes.
 *
 * Usage: drop `<app-section-skeleton />` next to `<router-outlet>` so it shows
 * during route transitions. The routed component replaces it once the chunk loads.
 *
 * Supports `height` and `lines` inputs so callers can match the expected content
 * density (compact table vs rich card grid).
 */
import { Component, Input, type OnInit } from '@angular/core';

@Component({
  selector: 'app-section-skeleton',
  standalone: true,
  template: `
    <div
      class="flex flex-col gap-4 animate-[fadeIn_200ms_ease-out]"
      [style.min-height.px]="height"
      role="status"
      aria-label="Loading section content"
    >
      <!-- Header shimmer -->
      <div class="skeleton skeleton--h w-[220px] max-w-[60%]"></div>
      <!-- Body lines -->
      @for (i of lineRange; track i) {
        <div class="skeleton skeleton--body" [style.width]="lineWidth(i)"></div>
      }
      @if (lines > 4) {
        <div class="skeleton skeleton--body w-[40%]"></div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .skeleton {
        border-radius: 6px;
        background: linear-gradient(
          90deg,
          rgba(255, 255, 255, 0.03) 25%,
          rgba(255, 255, 255, 0.06) 50%,
          rgba(255, 255, 255, 0.03) 75%
        );
        background-size: 200% 100%;
        animation: skeleton-shimmer 1.5s ease-in-out infinite;
      }
      .skeleton--h { height: 28px; }
      .skeleton--body { height: 14px; }
      @keyframes skeleton-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `,
  ],
})
export class SectionSkeletonComponent implements OnInit {
  /** Minimum height in px for the skeleton block. Defaults to 400. */
  @Input() height = 400;
  /** Number of body lines to render. Defaults to 8. */
  @Input() lines = 8;

  lineRange: number[] = [];

  ngOnInit(): void {
    this.lineRange = Array.from({ length: this.lines }, (_, i) => i);
  }

  /** Vary line widths so the skeleton looks natural. */
  lineWidth(i: number): string {
    const widths = ['100%', '92%', '85%', '95%', '70%', '88%', '78%', '60%'];
    return widths[i % widths.length];
  }
}
