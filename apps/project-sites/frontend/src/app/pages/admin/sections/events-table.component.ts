import { Component, computed, input, signal } from '@angular/core';

/** One analytics event row rendered by the table. Structurally matches the
 * `LiveEvent` shape the Live Events tab already holds (data already on the wire). */
export interface EventRow {
  id: string;
  eventType: string;
  userId?: string | null;
  timestamp: number;
  status?: string;
}

/**
 * AN55 — Live Events table with client-side search, type filter, and pagination.
 *
 * @remarks
 * Pure presentational/logic component over an already-loaded event list — no
 * network. The parent ({@link AdminAnalyticsLiveComponent}) passes the rows it
 * already fetched from `/api/analytics-data`; this component slices them into
 * pages and narrows by a free-text query + an event-type dropdown. Changing the
 * query or type resets to page 1 so the operator never lands on an empty page.
 *
 * @example
 * <app-events-table [events]="events()" />
 */
@Component({
  selector: 'app-events-table',
  standalone: true,
  template: `
    <div class="mt-5">
      <div class="flex items-center gap-2 flex-wrap mb-3">
        <input
          type="search"
          data-testid="et-search"
          [value]="query()"
          (input)="setQuery($any($event.target).value)"
          placeholder="Search type, user, status…"
          aria-label="Search events"
          class="px-3 py-1.5 rounded-lg text-[0.8rem] bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-text-secondary focus:outline-none focus:border-primary/60 min-w-[14rem]" />
        <select
          data-testid="et-type"
          [value]="typeFilter()"
          (change)="setType($any($event.target).value)"
          aria-label="Filter by event type"
          class="px-3 py-1.5 rounded-lg text-[0.8rem] bg-white/[0.04] border border-white/[0.08] text-white focus:outline-none focus:border-primary/60">
          <option value="all">All types</option>
          @for (t of types(); track t) {
            <option [value]="t">{{ t }}</option>
          }
        </select>
        <span class="text-[0.78rem] text-text-secondary tabular-nums ml-auto" data-testid="et-count">
          {{ filtered().length }} of {{ events().length }}
        </span>
        <button
          type="button"
          data-testid="et-csv"
          class="px-3 py-1.5 rounded-lg text-[0.8rem] font-semibold border border-white/[0.08] text-text-secondary hover:text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default"
          [disabled]="!filtered().length"
          (click)="exportCsv()">
          Download CSV
        </button>
      </div>

      @if (!filtered().length) {
        <div class="text-[0.85rem] text-text-secondary py-6 text-center rounded-xl border border-white/[0.06]" data-testid="et-nomatch">
          No events match your search.
        </div>
      } @else {
        <div class="overflow-x-auto rounded-xl border border-white/[0.06]" data-testid="et-table">
          <table class="w-full text-left text-[0.82rem]">
            <thead>
              <tr class="text-text-secondary border-b border-white/[0.06]">
                <th class="px-3 py-2 font-semibold">Type</th>
                <th class="px-3 py-2 font-semibold">When</th>
                <th class="px-3 py-2 font-semibold">User</th>
                <th class="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (e of paged(); track e.id) {
                <tr class="border-b border-white/[0.03] hover:bg-white/[0.02]" data-testid="et-row">
                  <td class="px-3 py-2 text-white font-medium">{{ e.eventType }}</td>
                  <td class="px-3 py-2 text-text-secondary tabular-nums" [attr.title]="e.timestamp">{{ fmt(e.timestamp) }}</td>
                  <td class="px-3 py-2 text-text-secondary">{{ e.userId || '—' }}</td>
                  <td class="px-3 py-2 text-text-secondary">{{ e.status || 'ingested' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (totalPages() > 1) {
          <div class="flex items-center justify-end gap-3 mt-3">
            <span class="text-[0.78rem] text-text-secondary tabular-nums" data-testid="et-page">
              Page {{ page() + 1 }} of {{ totalPages() }}
            </span>
            <button
              type="button"
              data-testid="et-prev"
              class="px-3 py-1 rounded-lg text-[0.8rem] font-semibold border border-white/[0.08] text-text-secondary hover:text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default"
              [disabled]="page() === 0"
              (click)="prev()">
              Prev
            </button>
            <button
              type="button"
              data-testid="et-next"
              class="px-3 py-1 rounded-lg text-[0.8rem] font-semibold border border-white/[0.08] text-text-secondary hover:text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default"
              [disabled]="page() >= totalPages() - 1"
              (click)="next()">
              Next
            </button>
          </div>
        }
      }
    </div>
  `,
})
export class EventsTableComponent {
  /** The already-fetched event rows. */
  readonly events = input<EventRow[]>([]);

  readonly pageSize = 25;
  readonly query = signal('');
  readonly typeFilter = signal('all');
  readonly page = signal(0);

  /** Distinct event types present, sorted — drives the filter dropdown. */
  readonly types = computed(() =>
    Array.from(new Set(this.events().map((e) => e.eventType))).sort(),
  );

  /** Rows after the type filter + free-text query (case-insensitive). */
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const type = this.typeFilter();
    return this.events().filter((e) => {
      if (type !== 'all' && e.eventType !== type) return false;
      if (!q) return true;
      return (
        e.eventType.toLowerCase().includes(q) ||
        (e.userId ?? '').toLowerCase().includes(q) ||
        (e.status ?? '').toLowerCase().includes(q)
      );
    });
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize)));

  /** The current page's slice, clamped so an out-of-range page never blanks the table. */
  readonly paged = computed(() => {
    const p = Math.min(this.page(), this.totalPages() - 1);
    const start = p * this.pageSize;
    return this.filtered().slice(start, start + this.pageSize);
  });

  setQuery(value: string): void {
    this.query.set(value);
    this.page.set(0);
  }

  setType(value: string): void {
    this.typeFilter.set(value);
    this.page.set(0);
  }

  next(): void {
    this.page.update((p) => Math.min(p + 1, this.totalPages() - 1));
  }

  prev(): void {
    this.page.update((p) => Math.max(p - 1, 0));
  }

  /** Serialize the currently-filtered rows to a CSV string (AN42). */
  toCsv(): string {
    const esc = (v: string | number | null | undefined): string => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'Type,When,User,Status,Timestamp';
    const rows = this.filtered().map((e) =>
      [esc(e.eventType), esc(this.fmt(e.timestamp)), esc(e.userId), esc(e.status ?? 'ingested'), esc(e.timestamp)].join(','),
    );
    return [header, ...rows].join('\n') + '\n';
  }

  /** Download the filtered rows as a CSV file. Impure — touches the DOM/URL. */
  exportCsv(): void {
    if (!this.filtered().length) return;
    const blob = new Blob([this.toCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `events-${this.filtered().length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Human time for an epoch-ms timestamp. */
  fmt(ts: number): string {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return String(ts);
    }
  }
}
