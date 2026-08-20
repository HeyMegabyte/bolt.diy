import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RevealDirective } from '../../../directives/reveal.directive';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/**
 * The Pulse Social calendar pane — extracted from the 3.2k-line
 * `social.component.ts` god component (split slice 1 of the documented
 * 32.86KB SCSS-budget wave). Owns ONLY the month grid:
 *
 * - `posts` + `platforms` are inputs (the parent owns the data + edit flow).
 * - Month navigation + the 42-cell grid + drag-to-reschedule live here.
 * - A drop PATCHes `/social/posts/:id` and emits `rescheduled` so the
 *   parent reloads its list (the child never owns the list).
 * - Clicking an event emits `edit` — the parent opens its composer dialog.
 */

/** View shape the calendar needs — a structural subset of the parent's SocialPost. */
interface CalendarPost {
  id: string;
  content: string;
  platforms: string[];
  scheduled_at?: string;
  published_at?: string;
}

/** Platform view shape — id + brand color for the event chips. */
interface PlatformDefView {
  id: string;
  color: string;
}

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-social-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RevealDirective],
  template: `
    <div class="cal-pane" appReveal>
      <header class="cal-h">
        <button type="button" class="btn-ghost sm" (click)="calPrev()" aria-label="Previous month">‹</button>
        <h3>{{ calLabel() }}</h3>
        <button type="button" class="btn-ghost sm" (click)="calNext()" aria-label="Next month">›</button>
        <button type="button" class="btn-ghost sm" (click)="calToday()">Today</button>
      </header>
      <div class="cal-grid" role="grid" aria-label="Scheduled posts calendar">
        @for (h of weekDayHeaders; track h) {
          <div class="cal-dh">{{ h }}</div>
        }
        @for (cell of calCells(); track cell.iso) {
          <div class="cal-cell"
               [class.is-today]="cell.today"
               [class.is-out]="cell.outOfMonth"
               (dragover)="onCalDragOver($event)"
               (drop)="onCalDrop($event, cell.iso)">
            <div class="cal-num">{{ cell.day }}</div>
            @for (post of postsOnDay(cell.iso); track post.id) {
              <button
                type="button"
                class="cal-event"
                draggable="true"
                [style.--brand]="defColor(post.platforms[0])"
                (dragstart)="onCalEventDrag($event, post)"
                (click)="edit.emit(post)"
                [title]="post.content">
                <span class="cal-time">{{ post.scheduled_at | date:'shortTime' }}</span>
                <span class="cal-txt">{{ post.content }}</span>
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .cal-pane {
        background: color-mix(in oklch, var(--ps-bg, #060610) 60%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
        border-radius: var(--ps-radius-xl, 22px); padding: 14px;
        display: flex; flex-direction: column; gap: 10px;
      }
      .cal-h { display: flex; align-items: center; gap: 10px; }
      .cal-h h3 { margin: 0; font-size: 1rem; color: var(--ps-ink, #f4f4ff); flex: 1; text-align: center; }
      .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
      .cal-dh {
        text-align: center; font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent); padding: 5px;
      }
      .cal-cell {
        aspect-ratio: 1; min-height: 76px; padding: 4px; border-radius: 8px;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 3%, transparent);
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 6%, transparent);
        display: flex; flex-direction: column; gap: 3px; overflow: hidden;
      }
      .cal-cell.is-today { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent); border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent); }
      .cal-cell.is-out  { opacity: 0.35; }
      .cal-num { font-size: 0.7rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent); font-weight: 600; }
      .cal-event {
        --brand: var(--ps-accent, #00e5ff);
        border: none; cursor: grab; padding: 3px 6px; border-radius: 5px;
        background: color-mix(in oklch, var(--brand) 18%, transparent);
        color: var(--brand);
        font-size: 0.62rem; text-align: left; display: flex; gap: 4px; font-family: inherit;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .cal-event:active { cursor: grabbing; }
      .cal-time { font-weight: 700; }
      .cal-txt { opacity: 0.85; text-overflow: ellipsis; overflow: hidden; }
    `,
  ],
})
export class SocialCalendarComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  /** The posts to plot (parent-owned list; the child only READS it). */
  readonly posts = input.required<CalendarPost[]>();
  /** Platform defs for the event-chip brand colors (parent's `PLATFORMS` is readonly). */
  readonly platforms = input.required<readonly PlatformDefView[]>();

  /** Parent opens its composer/edit dialog for the clicked event. */
  readonly edit = output<CalendarPost>();
  /** A drop rescheduled a post — the parent reloads its list. */
  readonly rescheduled = output<void>();

  readonly weekDayHeaders = WEEKDAY_HEADERS;

  readonly calCursor = signal(new Date());
  private dragPostId: string | null = null;

  readonly calLabel = computed(() => {
    const d = this.calCursor();
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  });

  readonly calCells = computed(() => {
    const cursor = this.calCursor();
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const first = new Date(y, m, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const cells: { iso: string; day: number; outOfMonth: boolean; today: boolean }[] = [];
    const today = new Date();
    const todayIso = isoDay(today);
    for (let i = 0; i < 42; i++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      const iso = isoDay(dt);
      cells.push({ iso, day: dt.getDate(), outOfMonth: dt.getMonth() !== m, today: iso === todayIso });
    }
    return cells;
  });

  calPrev(): void {
    const d = new Date(this.calCursor());
    d.setMonth(d.getMonth() - 1);
    this.calCursor.set(d);
  }

  calNext(): void {
    const d = new Date(this.calCursor());
    d.setMonth(d.getMonth() + 1);
    this.calCursor.set(d);
  }

  calToday(): void {
    this.calCursor.set(new Date());
  }

  postsOnDay(iso: string): CalendarPost[] {
    return this.posts().filter((p) => {
      const at = p.scheduled_at || p.published_at;
      return at && isoDay(new Date(at)) === iso;
    });
  }

  /** The brand color for a platform id (accent fallback). */
  defColor(pid: string | undefined): string {
    return this.platforms().find((p) => p.id === pid)?.color ?? 'var(--ps-accent, #00e5ff)';
  }

  onCalEventDrag(ev: DragEvent, post: CalendarPost): void {
    this.dragPostId = post.id;
    ev.dataTransfer?.setData('text/plain', post.id);
  }

  onCalDragOver(ev: DragEvent): void {
    ev.preventDefault();
  }

  onCalDrop(ev: DragEvent, iso: string): void {
    ev.preventDefault();
    const id = this.dragPostId ?? ev.dataTransfer?.getData('text/plain');
    if (!id) return;
    const post = this.posts().find((p) => p.id === id);
    if (!post || !post.scheduled_at) return;
    const old = new Date(post.scheduled_at);
    const nextDay = new Date(iso + 'T00:00:00');
    nextDay.setHours(old.getHours(), old.getMinutes(), 0, 0);
    const newAt = nextDay.toISOString();
    this.api.patch(`/social/posts/${id}`, { scheduled_at: newAt }, { silent: true }).subscribe({
      next: () => {
        this.toast.success('Rescheduled');
        this.rescheduled.emit();
      },
      error: () => this.toast.error('Reschedule failed'),
    });
    this.dragPostId = null;
  }
}
