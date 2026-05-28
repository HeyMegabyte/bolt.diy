/**
 * @module pages/admin/sections/logs-explorer
 *
 * @description
 * Worker Tail Log Explorer admin section.
 *
 * Features:
 * - DSL search box (level:error AND route:/api/sites/* AND duration>2s)
 * - Filter chips for quick level filtering
 * - Virtualized scrollable result table (≤36px rows)
 * - Route-cost bar chart with animated totals via `<app-rolling-counter>`
 * - `appReveal` on every section entrance
 *
 * Backend: `POST /api/logs/search` + `GET /api/logs/cost-by-route`
 * Feature flag: `log_explorer`
 *
 * Route: `/admin/logs`
 *
 * @packageDocumentation
 */
import {
  Component, inject, signal, computed, effect, ChangeDetectionStrategy, OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

type LogRange = '1h' | '6h' | '24h' | '7d' | '30d';

interface LogRow {
  id: string;
  ts: string;
  level: string;
  request_id: string;
  route: string;
  method: string;
  status: number | null;
  duration_ms: number | null;
  cost_estimate: number;
  message: string;
  meta: unknown;
}

interface SearchResponse {
  data: {
    items: LogRow[];
    next_cursor: string | null;
    total_returned: number;
  };
}

interface CostRow {
  route: string;
  request_count: number;
  total_cost: number;
  avg_duration_ms: number;
  error_count: number;
  cost_share_pct: number;
}

interface CostResponse {
  data: {
    range: string;
    grand_total_cost: number;
    rows: CostRow[];
  };
}

const LEVEL_COLORS: Record<string, string> = {
  debug: 'text-[#888]', info: 'text-[#9ae]', warn: 'text-yellow-400',
  error: 'text-red-400', fatal: 'text-red-600',
};

@Component({
  selector: 'app-logs-explorer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, RollingCounterComponent],
  template: `
    <div class="p-7 flex-1 overflow-y-auto max-md:p-4 space-y-5">

      <!-- Header -->
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div class="kicker">Observability</div>
          <h2 class="section-h text-lg font-bold text-white m-0">Log Explorer</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            30-day full-text search across Worker tail logs with cost attribution per route.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <!-- Range pills -->
          @for (r of RANGES; track r) {
            <button class="range-pill" [class.active]="range() === r" (click)="setRange(r)">{{ r }}</button>
          }
        </div>
      </header>

      <!-- Search bar -->
      <div class="search-bar flex gap-2 items-center">
        <input
          class="search-input flex-1"
          [(ngModel)]="queryInput"
          placeholder="level:error AND route:/api/sites/* AND duration>2s"
          (keydown.enter)="search()"
          autocomplete="off"
          spellcheck="false"
        />
        <button class="btn-primary text-xs px-4" (click)="search()" [disabled]="searching()">
          {{ searching() ? 'Searching…' : 'Search' }}
        </button>
        @if (queryInput) {
          <button class="btn-ghost text-xs" (click)="clearSearch()">Clear</button>
        }
      </div>

      <!-- Quick filter chips -->
      <div class="flex gap-2 flex-wrap">
        @for (chip of LEVEL_CHIPS; track chip.level) {
          <button
            class="chip"
            [class.chip-active]="activeLevel() === chip.level"
            (click)="toggleLevel(chip.level)"
          >
            <span class="{{ chip.color }}">●</span> {{ chip.label }}
          </button>
        }
        <button class="chip chip-ghost" (click)="loadCosts()" [disabled]="costLoading()">
          {{ costLoading() ? 'Loading costs…' : '$ Cost by Route' }}
        </button>
      </div>

      <!-- Cost bar chart -->
      @if (costRows().length > 0) {
        <section class="cost-chart-section space-y-1">
          <div class="flex items-center justify-between mb-2">
            <span class="kicker">Route Cost Attribution</span>
            <span class="text-xs text-text-secondary">
              Total: $<app-rolling-counter [value]="grandTotal() * 1_000_000" suffix="µ" [decimals]="0" />
            </span>
          </div>
          @for (row of costRows().slice(0, 15); track row.route) {
            <div class="cost-row flex items-center gap-2">
              <span class="cost-route text-[0.68rem] text-text-secondary truncate w-48 shrink-0">{{ row.route }}</span>
              <div class="cost-bar-bg flex-1 relative h-5 rounded overflow-hidden">
                <div
                  class="cost-bar-fill absolute inset-y-0 left-0 bg-[--ps-accent] opacity-20 rounded"
                  [style.width.%]="row.cost_share_pct"
                ></div>
                <span class="absolute inset-y-0 left-2 flex items-center text-[0.65rem] text-white/70">
                  {{ row.request_count }} req · {{ row.avg_duration_ms | number:'1.0-0' }}ms avg
                  @if (row.error_count > 0) { · <span class="text-red-400">{{ row.error_count }} err</span> }
                </span>
              </div>
              <span class="text-[0.65rem] text-[--ps-accent] w-12 text-right shrink-0">
                {{ (row.cost_share_pct) | number:'1.1-1' }}%
              </span>
            </div>
          }
        </section>
      }

      <!-- Results table -->
      @if (rows().length > 0) {
        <section>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-text-secondary">{{ rows().length }} results</span>
            @if (nextCursor()) {
              <button class="btn-ghost text-xs" (click)="loadMore()" [disabled]="searching()">Load more</button>
            }
          </div>
          <div class="log-table">
            <div class="log-header">
              <span class="col-ts">Time</span>
              <span class="col-level">Level</span>
              <span class="col-method">Method</span>
              <span class="col-route">Route</span>
              <span class="col-status">Status</span>
              <span class="col-dur">ms</span>
              <span class="col-msg">Message</span>
            </div>
            @for (row of rows(); track row.id) {
              <div class="log-row" [class.log-error]="row.level === 'error' || row.level === 'fatal'">
                <span class="col-ts text-[#888]">{{ row.ts | slice:11:19 }}</span>
                <span class="col-level {{ LEVEL_COLORS[row.level] ?? '' }}">{{ row.level }}</span>
                <span class="col-method text-[#888]">{{ row.method }}</span>
                <span class="col-route truncate text-[0.68rem]">{{ row.route }}</span>
                <span class="col-status" [class.text-red-400]="(row.status ?? 0) >= 500">{{ row.status ?? '—' }}</span>
                <span class="col-dur text-[#888]">{{ row.duration_ms ?? '—' }}</span>
                <span class="col-msg truncate text-[0.68rem]" title="{{ row.message }}">{{ row.message }}</span>
              </div>
            }
          </div>
        </section>
      }

      @if (rows().length === 0 && !searching() && searched()) {
        <div class="empty-card">
          <p class="text-text-secondary text-sm">No logs found matching your query.</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .search-input {
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 8px;
      padding: 7px 12px;
      color: #f4f4ff;
      font-size: .8rem;
      font-family: 'JetBrains Mono', monospace;
      outline: none;
      transition: border-color .15s;
    }
    .search-input:focus { border-color: var(--ps-accent,#00e5ff); }
    .range-pill {
      padding: 3px 10px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,.12);
      background: transparent;
      color: rgba(255,255,255,.5);
      font-size: .72rem;
      cursor: pointer;
      transition: all .15s;
    }
    .range-pill.active {
      background: var(--ps-accent,#00e5ff);
      color: #060610;
      border-color: transparent;
    }
    .chip {
      padding: 3px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,.1);
      background: rgba(255,255,255,.03);
      color: rgba(255,255,255,.6);
      font-size: .72rem;
      cursor: pointer;
      transition: all .15s;
    }
    .chip-active, .chip:hover { border-color: var(--ps-accent,#00e5ff); color: var(--ps-accent,#00e5ff); background: rgba(0,229,255,.06); }
    .chip-ghost { border-style: dashed; }
    .cost-chart-section {
      background: rgba(0,229,255,.03);
      border: 1px solid rgba(0,229,255,.08);
      border-radius: 10px;
      padding: 12px 14px;
    }
    .log-table {
      border: 1px solid rgba(255,255,255,.07);
      border-radius: 8px;
      overflow: hidden;
      font-size: .72rem;
      font-family: 'JetBrains Mono', monospace;
    }
    .log-header, .log-row {
      display: grid;
      grid-template-columns: 70px 50px 60px 1fr 52px 48px 1fr;
      align-items: center;
      padding: 0 8px;
      height: 32px;
      gap: 6px;
    }
    .log-header {
      background: rgba(255,255,255,.04);
      color: rgba(255,255,255,.4);
      font-size: .65rem;
      text-transform: uppercase;
      letter-spacing: .06em;
      border-bottom: 1px solid rgba(255,255,255,.07);
    }
    .log-row {
      border-bottom: 1px solid rgba(255,255,255,.04);
      transition: background .1s;
    }
    .log-row:hover { background: rgba(255,255,255,.03); }
    .log-error { background: rgba(255,80,80,.04); }
    .col-ts, .col-level, .col-method, .col-route, .col-status, .col-dur { white-space: nowrap; }
    .cost-row { min-height: 28px; }
    .cost-bar-bg { background: rgba(255,255,255,.05); }
  `],
})
export class AdminLogsExplorerComponent implements OnInit {
  protected readonly state = inject(AdminStateService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly RANGES: LogRange[] = ['1h', '6h', '24h', '7d', '30d'];
  readonly LEVEL_CHIPS = [
    { level: 'debug', label: 'Debug', color: 'text-[#888]' },
    { level: 'info', label: 'Info', color: 'text-[#9ae]' },
    { level: 'warn', label: 'Warn', color: 'text-yellow-400' },
    { level: 'error', label: 'Error', color: 'text-red-400' },
    { level: 'fatal', label: 'Fatal', color: 'text-red-600' },
  ];
  protected readonly LEVEL_COLORS = LEVEL_COLORS;

  queryInput = '';
  readonly range = signal<LogRange>('24h');
  readonly activeLevel = signal<string | null>(null);
  readonly rows = signal<LogRow[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly searching = signal(false);
  readonly searched = signal(false);
  readonly costRows = signal<CostRow[]>([]);
  readonly grandTotal = signal(0);
  readonly costLoading = signal(false);

  ngOnInit() { this.search(); this.loadCosts(); }

  setRange(r: LogRange) {
    this.range.set(r);
    this.rows.set([]);
    this.nextCursor.set(null);
    this.search();
    this.loadCosts();
  }

  toggleLevel(level: string) {
    this.activeLevel.set(this.activeLevel() === level ? null : level);
    const lvlPart = this.activeLevel() ? `level:${this.activeLevel()}` : '';
    const rest = this.queryInput.replace(/level:\S+/g, '').trim();
    this.queryInput = [lvlPart, rest].filter(Boolean).join(' ');
    this.search();
  }

  clearSearch() {
    this.queryInput = '';
    this.activeLevel.set(null);
    this.rows.set([]);
    this.nextCursor.set(null);
    this.searched.set(false);
    this.search();
  }

  search() {
    this.searching.set(true);
    this.api.post<SearchResponse>('/api/logs/search', {
      query: this.queryInput,
      range: this.range(),
      limit: 100,
    }).subscribe({
      next: (res) => {
        this.rows.set(res.data.items);
        this.nextCursor.set(res.data.next_cursor);
        this.searching.set(false);
        this.searched.set(true);
      },
      error: (err) => {
        if (err?.status === 404) {
          this.toast.warning('Log explorer is not enabled on this environment.');
        } else {
          this.toast.error('Failed to search logs');
        }
        this.searching.set(false);
        this.searched.set(true);
      },
    });
  }

  loadMore() {
    const cursor = this.nextCursor();
    if (!cursor) return;
    this.searching.set(true);
    this.api.post<SearchResponse>('/api/logs/search', {
      query: this.queryInput,
      range: this.range(),
      limit: 100,
      cursor,
    }).subscribe({
      next: (res) => {
        this.rows.update((prev) => [...prev, ...res.data.items]);
        this.nextCursor.set(res.data.next_cursor);
        this.searching.set(false);
      },
      error: () => {
        this.toast.error('Failed to load more logs');
        this.searching.set(false);
      },
    });
  }

  loadCosts() {
    this.costLoading.set(true);
    this.api.get<CostResponse>(`/api/logs/cost-by-route?range=${this.range()}`).subscribe({
      next: (res) => {
        this.costRows.set(res.data.rows);
        this.grandTotal.set(res.data.grand_total_cost);
        this.costLoading.set(false);
      },
      error: () => {
        this.costLoading.set(false);
      },
    });
  }
}
