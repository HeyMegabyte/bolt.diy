import { Component, signal, computed, inject, effect, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../../services/api.service';
import { AdminStateService } from '../admin-state.service';
import { ReadinessBadgeComponent } from './readiness-badge.component';

/** One stored analytics event row (from `/api/analytics-data`). */
interface LiveEvent {
  id: string;
  eventId: string;
  eventType: string;
  userId?: string | null;
  timestamp: number;
  payload?: unknown;
  status?: string;
}
interface AnalyticsDataResponse {
  events?: LiveEvent[];
  count?: number;
  has_more?: boolean;
  note?: string;
}
interface DebugResponse {
  circuits?: Record<string, string>;
  queueDepth?: number;
  note?: string;
}

/**
 * Live Events — the operator view of the Unified Analytics ingestion plane
 * (Plane H). Reads the durable `/api/analytics-data` feed + the dispatcher's
 * `/api/analytics-debug` circuit state for the selected site, and offers a
 * "Send test event" button (`/api/test-event`) to confirm the pipeline end to
 * end without waiting for real traffic. Separate from the aggregate Analytics
 * tab: this is the raw event stream + per-provider delivery health.
 */
@Component({
  selector: 'app-admin-analytics-live',
  standalone: true,
  imports: [ReadinessBadgeComponent],
  template: `
    <div class="px-6 pt-5 pb-8 max-md:px-4" data-testid="analytics-live">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 class="text-[1.35rem] font-extrabold text-white tracking-tight m-0">Live Events</h1>
          <p class="text-[0.82rem] text-text-secondary mt-1 mb-0">
            Raw analytics event stream + per-provider delivery health for this site.
          </p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <app-readiness-badge [siteId]="siteRecordId()" />
          <span class="px-3 py-1 rounded-full text-[0.78rem] font-semibold bg-white/[0.04] text-text-secondary tabular-nums">
            {{ events().length }} event{{ events().length === 1 ? '' : 's' }}
          </span>
          <button
            type="button"
            data-testid="al-test"
            class="px-3.5 py-1.5 rounded-lg text-[0.8rem] font-semibold bg-primary text-dark transition-all cursor-pointer disabled:opacity-50"
            [disabled]="!siteId() || testing()"
            (click)="sendTest()">
            {{ testing() ? 'Sending…' : 'Send test event' }}
          </button>
          <button
            type="button"
            data-testid="al-refresh"
            class="px-3.5 py-1.5 rounded-lg text-[0.8rem] font-semibold border border-white/[0.08] text-text-secondary hover:text-white transition-all cursor-pointer disabled:opacity-50"
            [disabled]="!siteId() || loading()"
            (click)="reload()">
            Refresh
          </button>
        </div>
      </div>

      <!-- Per-provider circuit state -->
      @if (circuitList().length) {
        <div class="flex items-center gap-2 flex-wrap mt-4" aria-label="Provider delivery status">
          @for (c of circuitList(); track c.provider) {
            <span
              class="px-3 py-1 rounded-full text-[0.75rem] font-semibold border"
              [class.text-emerald-300]="c.state === 'closed'"
              [class.border-emerald-400_30]="c.state === 'closed'"
              [class.text-amber-300]="c.state === 'half_open'"
              [class.text-rose-300]="c.state === 'open'">
              {{ c.provider }}: {{ c.state }}
            </span>
          }
        </div>
      }

      @if (loading()) {
        <div class="mt-6 text-[0.85rem] text-text-secondary" data-testid="al-loading">Loading recent events…</div>
      } @else if (error()) {
        <div class="mt-6 text-[0.85rem] text-rose-300" role="alert" data-testid="al-error">
          Couldn't load events. {{ error() }}
        </div>
      } @else if (!siteId()) {
        <div class="mt-6 text-[0.85rem] text-text-secondary" data-testid="al-nosite">
          Select a site to view its live events.
        </div>
      } @else if (!events().length) {
        <div class="mt-6 text-[0.85rem] text-text-secondary" data-testid="al-empty">
          No events yet. Click <strong>Send test event</strong> to confirm the pipeline, or wait for real traffic.
        </div>
      } @else {
        <div class="mt-5 overflow-x-auto rounded-xl border border-white/[0.06]" data-testid="al-table">
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
              @for (e of events(); track e.id) {
                <tr class="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td class="px-3 py-2 text-white font-medium">{{ e.eventType }}</td>
                  <td class="px-3 py-2 text-text-secondary tabular-nums" [attr.title]="e.timestamp">{{ fmt(e.timestamp) }}</td>
                  <td class="px-3 py-2 text-text-secondary">{{ e.userId || '—' }}</td>
                  <td class="px-3 py-2 text-text-secondary">{{ e.status || 'ingested' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AdminAnalyticsLiveComponent {
  private readonly api = inject(ApiService);
  private readonly state = inject(AdminStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly events = signal<LiveEvent[]>([]);
  readonly circuits = signal<Record<string, string>>({});
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly testing = signal(false);

  /** The selected site's slug — the key analytics events are stored under. */
  readonly siteId = computed<string | null>(() => this.state.selectedSite()?.slug ?? null);

  /** Site RECORD id (sites.id) — readiness is keyed by id, analytics by slug. */
  readonly siteRecordId = computed<string | null>(() => this.state.selectedSite()?.id ?? null);

  readonly circuitList = computed(() =>
    Object.entries(this.circuits()).map(([provider, state]) => ({ provider, state })),
  );

  constructor() {
    // Reload whenever the selected site changes.
    effect(() => {
      const id = this.siteId();
      if (id) this.load(id);
      else this.events.set([]);
    });
  }

  reload(): void {
    const id = this.siteId();
    if (id) this.load(id);
  }

  private load(siteId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .get<AnalyticsDataResponse>('/analytics-data', { siteId, limit: '100' }, { silent: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.events.set(res?.events ?? []);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(String((err as { message?: string })?.message ?? 'request failed'));
          this.loading.set(false);
        },
      });
    // Circuit state is best-effort — never blocks the table.
    this.api
      .get<DebugResponse>('/analytics-debug', { siteId }, { silent: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.circuits.set(res?.circuits ?? {}),
        error: () => this.circuits.set({}),
      });
  }

  sendTest(): void {
    const id = this.siteId();
    if (!id || this.testing()) return;
    this.testing.set(true);
    this.api
      .post<unknown>(`/test-event?siteId=${encodeURIComponent(id)}`, undefined, { silent: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.testing.set(false);
          this.reload();
        },
        error: () => this.testing.set(false),
      });
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
