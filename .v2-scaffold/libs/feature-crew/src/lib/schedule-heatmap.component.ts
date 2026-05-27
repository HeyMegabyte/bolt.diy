/**
 * `ScheduleHeatmapComponent` — historical 7×24 heatmap (backlog #41).
 *
 * @remarks
 *  Pure-CSS grid; intensity 0..1 maps to background opacity. No charting
 *  library — the surface is too small to justify the bytes. RxJS-first per
 *  `[[rxjs-first-angular]]`. The data is a cheap SQL count rollup served by
 *  `/api/crew/:id/schedule-heatmap`.
 */
import { CommonModule, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, of, switchMap } from 'rxjs';
import { CardModule } from 'primeng/card';
import {
  ScheduleService,
  type ScheduleHeatmap,
  type ScheduleHeatmapCell,
} from '@org/data-access';

const DAY_LABELS: ReadonlyArray<string> = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

@Component({
  selector: 'lib-schedule-heatmap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, CardModule, DecimalPipe],
  template: `
    <p-card class="schedule-heatmap" data-testid="schedule-heatmap">
      <ng-template pTemplate="header">
        <header class="hdr">
          <h3>Historical busy windows</h3>
          <small>{{ heatmap()?.window_days }} days · {{ heatmap()?.total_bookings | number }} completed</small>
        </header>
      </ng-template>

      <div class="grid" role="grid" aria-label="7-day by 24-hour completed-booking heatmap">
        <div class="corner" aria-hidden="true"></div>
        @for (h of hours; track h) {
          <div class="hour-label" role="columnheader">
            {{ h % 6 === 0 ? (h.toString().padStart(2, '0') + 'h') : '' }}
          </div>
        }
        @for (d of days; track d) {
          <div class="day-label" role="rowheader">{{ dayLabel(d) }}</div>
          @for (h of hours; track h) {
            <div
              class="cell"
              [class.cell--busy]="cellAt(d, h).intensity > 0.6"
              [style.background-color]="cellBg(cellAt(d, h).intensity)"
              [title]="cellTitle(d, h)"
              role="gridcell"
              [attr.data-testid]="'heatmap-cell-' + d + '-' + h"
              [attr.aria-label]="cellTitle(d, h)"
            ></div>
          }
        }
      </div>

      <footer class="legend">
        <span>0</span>
        @for (step of legendSteps; track step) {
          <span class="swatch" [style.background-color]="cellBg(step)"></span>
        }
        <span>{{ heatmap()?.max_count | number }}</span>
      </footer>
    </p-card>
  `,
  styles: [
    `
      .schedule-heatmap { padding: 0; }
      .hdr { display: flex; align-items: baseline; justify-content: space-between; padding: 1rem; gap: .5rem; }
      .hdr h3 { margin: 0; font-size: 1rem; }
      .hdr small { color: var(--text-color-secondary, #8a8a98); }
      .grid {
        display: grid;
        grid-template-columns: 44px repeat(24, 1fr);
        gap: 2px;
        padding: 0 1rem 1rem;
      }
      .corner { }
      .hour-label, .day-label { font-size: .7rem; color: var(--text-color-secondary, #8a8a98); display: flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
      .day-label { justify-content: flex-end; padding-right: .5rem; }
      .cell { aspect-ratio: 1 / 1; min-height: 16px; border-radius: 3px; background-color: rgba(99, 102, 241, 0.06); transition: transform 120ms ease; }
      .cell:hover { transform: scale(1.06); }
      .cell--busy { outline: 1px solid rgba(99, 102, 241, 0.4); }
      .legend { display: flex; align-items: center; gap: .25rem; padding: 0 1rem 1rem; font-size: .75rem; color: var(--text-color-secondary, #8a8a98); }
      .swatch { width: 14px; height: 14px; border-radius: 2px; }
    `,
  ],
})
export class ScheduleHeatmapComponent {
  @Input({ required: true }) set crewId(value: string) {
    this.crewId$.next(value);
  }

  private readonly schedule = inject(ScheduleService);
  private readonly crewId$ = new BehaviorSubject<string>('');

  readonly days: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun visually
  readonly hours: ReadonlyArray<number> = Array.from({ length: 24 }, (_, i) => i);
  readonly legendSteps: ReadonlyArray<number> = [0.1, 0.25, 0.5, 0.75, 1];

  protected readonly heatmap = toSignal<ScheduleHeatmap | null>(
    this.crewId$.pipe(
      switchMap((id) =>
        id ? this.schedule.heatmap$(id, 12) : of<ScheduleHeatmap | null>(null),
      ),
    ),
    { initialValue: null },
  );

  private readonly byKey = computed(() => {
    const map = new Map<string, ScheduleHeatmapCell>();
    const h = this.heatmap();
    if (!h) return map;
    for (const cell of h.cells) {
      map.set(`${cell.day}:${cell.hour}`, cell);
    }
    return map;
  });

  cellAt(day: number, hour: number): ScheduleHeatmapCell {
    return (
      this.byKey().get(`${day}:${hour}`) ?? {
        day,
        hour,
        intensity: 0,
        count: 0,
      }
    );
  }

  cellBg(intensity: number): string {
    const i = Math.max(0, Math.min(1, intensity));
    const alpha = 0.06 + i * 0.74; // 0.06 → 0.80
    return `rgba(99, 102, 241, ${alpha.toFixed(3)})`;
  }

  cellTitle(day: number, hour: number): string {
    const c = this.cellAt(day, hour);
    return `${DAY_LABELS[day]} ${hour.toString().padStart(2, '0')}:00 — ${c.count} completed`;
  }

  dayLabel(day: number): string {
    return DAY_LABELS[day] ?? '';
  }
}
