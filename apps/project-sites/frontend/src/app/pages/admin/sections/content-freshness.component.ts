/**
 * /admin/content-freshness — Feature #16: Content Freshness Cron admin UI.
 *
 * Shows pending AI rewrite drafts for the owner to approve or reject.
 * Counts awaiting badge uses <app-rolling-counter>.
 *
 * ── Spartan reference migration ──────────────────────────────────────────
 * This section is the canonical "table-heavy" Spartan-UI migration example for
 * the cockpit (Spartan is the only admin UI kit; PrimeNG was never adopted). It
 * maps the former hand-rolled patterns onto Spartan + headless primitives:
 *   - hand-rolled `<table>`  → native `<table>` + TanStack headless (client sort)
 *                              + a custom server-side prev/next pager
 *   - status `<span>` pill   → Spartan `hlmBadge` (variant-driven, cockpit-tinted)
 *   - filter `<button>` pills→ Spartan brain toggle-group (single-select segmented)
 *   - action `<button>`s     → Spartan `hlmBtn` (ghost size=sm; approve tinted
 *                              the `--ps-success` token, reject `text-destructive`)
 *   - silent error swallow   → cockpit `ToastService` (approve/reject/scan now
 *                              surface success/error via the shared toast layer).
 * Every surface inherits the cockpit cyan/near-black tokens; section CSS
 * references `--ps-*` design tokens only — zero hard-coded brand hex.
 *
 * Convergence r14: added a `psReveal` header + a cyan/black aggregate stat
 * strip (`<app-rolling-counter>` for awaiting / avg-idle / avg-dwell across the
 * fetched page), tokenized the lone approve-button hex, and hardened a11y
 * (status-region for live counts, descriptive scroll-region label).
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { firstValueFrom } from 'rxjs';
import {
  createAngularTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
} from '@tanstack/angular-table';
import { BrnToggleGroupImports } from '@spartan-ng/brain/toggle-group';
import { HlmButtonDirective, HlmBadgeDirective, type BadgeVariant } from '../../../ui';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { ErrorCardComponent } from '../../../components/states';
import { RevealDirective } from '../../../directives/reveal.directive';

interface FreshnessDraft {
  id: string;
  site_id: string;
  section_key: string;
  dwell_seconds_avg: number;
  idle_days: number;
  status: 'pending' | 'approved' | 'rejected' | 'published';
  ai_model: string;
  created_at: string;
}

interface DraftsResponse {
  drafts: FreshnessDraft[];
  total: number;
  page: number;
  limit: number;
}

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'published';

@Component({
  selector: 'app-admin-content-freshness',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RollingCounterComponent,
    ErrorCardComponent,
    RevealDirective,
    HlmButtonDirective,
    HlmBadgeDirective,
    ...BrnToggleGroupImports,
  ],
  template: `
    <div class="cf-page" data-testid="content-freshness-section" appReveal>

      <!-- Header -->
      <header class="cf-header" psReveal>
        <div>
          <span class="cf-eyebrow">Content Quality</span>
          <h1 class="cf-h1">Content Freshness</h1>
          <p class="cf-sub">
            Sections idle >90 days with low dwell are automatically rewritten by AI.
            @if (pending() > 0) {
              <span class="cf-badge">
                <app-rolling-counter [value]="pending()" suffix="" />
                awaiting approval
              </span>
            }
          </p>
        </div>
        <div class="cf-header-actions">
          <button
            hlmBtn
            variant="outline"
            size="sm"
            type="button"
            [disabled]="triggering()"
            (click)="triggerScan()">
            <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" [class.cf-spin]="triggering()"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
            {{ triggering() ? 'Scanning…' : 'Run scan now' }}
          </button>
          <button
            hlmBtn
            variant="ghost"
            size="sm"
            type="button"
            [disabled]="loading()"
            (click)="load()">
            <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" [class.cf-spin]="loading()"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            Refresh
          </button>
        </div>
      </header>

      <!-- Aggregate stat strip — cyan/black cockpit cards; every figure rolls
           via <app-rolling-counter>. aria-live so a screen reader hears the
           page totals refresh after a filter change / scan. -->
      @if (drafts().length > 0) {
        <div class="cf-stats" psReveal role="status" aria-live="polite"
             [attr.aria-label]="statTotal() + ' drafts shown, average ' + statAvgIdle() + ' idle days, average ' + statAvgDwell() + ' seconds dwell'">
          <div class="cf-stat">
            <span class="cf-stat-num"><app-rolling-counter [value]="statTotal()" /></span>
            <span class="cf-stat-label">{{ statusFilter() }} shown</span>
          </div>
          <div class="cf-stat">
            <span class="cf-stat-num"><app-rolling-counter [value]="statAvgIdle()" suffix="d" /></span>
            <span class="cf-stat-label">avg idle</span>
          </div>
          <div class="cf-stat">
            <span class="cf-stat-num"><app-rolling-counter [value]="statAvgDwell()" suffix="s" /></span>
            <span class="cf-stat-label">avg dwell</span>
          </div>
        </div>
      }

      <!-- Status filter — Spartan (brain) toggle-group, single-select segmented -->
      <div
        brnToggleGroup
        class="cf-filter"
        [value]="statusFilter()"
        (valueChange)="onFilterChange($event)"
        aria-label="Filter drafts by status">
        @for (opt of statusOptions; track opt.value) {
          <button
            brnToggleGroupItem
            [value]="opt.value"
            class="cf-toggle"
            [class.cf-toggle-active]="statusFilter() === opt.value"
            [attr.data-testid]="'cf-filter-' + opt.value">
            {{ opt.label }}
          </button>
        }
      </div>

      <!-- Error state -->
      @if (error()) {
        <app-error-card
          title="Couldn't load content freshness"
          [message]="error()!"
          hint="The freshness service didn't respond. Retry, or pick a different site."
          (retry)="load()" />
      }

      <!-- Draft table (native + TanStack headless: client-side sort on the
           fetched page; server-side paging via the pager below). -->
      <div class="overflow-x-auto" tabindex="0" role="region" aria-label="Content drafts — scroll horizontally">
      <table class="cf-grid" data-testid="cf-table" [attr.aria-busy]="loading()">
        <thead>
          <tr>
            @for (header of table.getHeaderGroups()[0].headers; track header.id) {
              @if (header.column.getCanSort()) {
                <th
                  scope="col"
                  class="cf-sortable"
                  [class.cf-num-col]="numCol[header.id]"
                  tabindex="0"
                  [attr.aria-sort]="ariaSort(header.column.getIsSorted())"
                  (click)="header.column.toggleSorting()"
                  (keydown.enter)="header.column.toggleSorting()"
                  (keydown.space)="header.column.toggleSorting(); $event.preventDefault()">
                  {{ headerLabel[header.id] }}
                  <span class="cf-sort-ind" aria-hidden="true">{{ sortGlyph(header.column.getIsSorted()) }}</span>
                </th>
              } @else {
                <th scope="col" class="cf-actions-col">{{ headerLabel[header.id] }}</th>
              }
            }
          </tr>
        </thead>
        <tbody>
          @for (row of table.getRowModel().rows; track row.original.id) {
            <tr>
              <td>
                <span class="cf-section-key" [attr.title]="row.original.section_key">{{ row.original.section_key }}</span>
              </td>
              <td class="cf-num-col"><span class="cf-num">{{ row.original.idle_days }}d</span></td>
              <td class="cf-num-col"><span class="cf-num">{{ row.original.dwell_seconds_avg | number:'1.0-0' }}s</span></td>
              <td>
                <span hlmBadge [variant]="statusBadge(row.original.status)">{{ row.original.status }}</span>
              </td>
              <td class="cf-cell-date">{{ row.original.created_at | date:'MMM d' }}</td>
              <td class="cf-actions-col">
                @if (row.original.status === 'pending') {
                  <button hlmBtn variant="ghost" size="sm" type="button" class="cf-approve"
                    [disabled]="acting().has(row.original.id)"
                    (click)="approve(row.original.id)"
                    [attr.aria-label]="'Approve rewrite for ' + row.original.section_key">
                    Approve
                  </button>
                  <button hlmBtn variant="ghost" size="sm" type="button" class="text-destructive"
                    [disabled]="acting().has(row.original.id)"
                    (click)="reject(row.original.id)"
                    [attr.aria-label]="'Reject rewrite for ' + row.original.section_key">
                    Reject
                  </button>
                } @else {
                  <span class="cf-act-done">—</span>
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6">
                <div class="cf-empty">
                  @if (loading()) {
                    <div class="cf-skel" aria-busy="true" aria-label="Loading drafts">
                      @for (i of [0,1,2,3]; track i) {
                        <span class="glow-skel cf-skel-bar" aria-hidden="true"></span>
                      }
                    </div>
                  } @else {
                    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="font-size: 1.6rem; opacity: .35"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
                    <p>No {{ statusFilter() }} drafts — sections are fresh.</p>
                  }
                </div>
              </td>
            </tr>
          }
        </tbody>
      </table>
      </div>

      <!-- Server-side pager (TanStack sort is client-side on the fetched page). -->
      @if (total() > limit) {
        <div class="cf-pager">
          <button hlmBtn variant="outline" size="sm" type="button"
            [disabled]="page() <= 1 || loading()" (click)="goToPage(page() - 1)">Previous</button>
          <span class="cf-pager-info">Page {{ page() }} of {{ pageCount() }} · {{ total() }} total</span>
          <button hlmBtn variant="outline" size="sm" type="button"
            [disabled]="page() >= pageCount() || loading()" (click)="goToPage(page() + 1)">Next</button>
        </div>
      }

    </div>
  `,
  styles: [`
    :host {
      --ease: cubic-bezier(0.4, 0, 0.2, 1);
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
    }

    .cf-page {
      padding: 1.75rem;
      max-width: 1100px;
      animation: fadeUp 420ms var(--ease);
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) { .cf-page { animation: none; } }

    .cf-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.25rem;
    }
    .cf-header-actions { display: flex; gap: .5rem; align-items: center; flex-shrink: 0; }
    .cf-eyebrow { font-size: .65rem; letter-spacing: .1em; color: var(--ps-accent); text-transform: uppercase; font-weight: 700; display: block; margin-bottom: .25rem; }
    .cf-h1 { font-size: 1.25rem; font-weight: 700; color: var(--ps-ink, #fff); margin: 0 0 .25rem; }
    .cf-sub { font-size: .75rem; color: rgba(244,244,255,.55); margin: 0; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
    .cf-badge {
      display: inline-flex; align-items: center; gap: .25rem;
      background: var(--ps-accent-soft, rgba(0,229,255,.12)); border: 1px solid var(--ps-accent-line, rgba(0,229,255,.3));
      color: var(--ps-accent); font-weight: 700; font-size: .62rem;
      padding: .125rem .625rem; border-radius: 9999px; letter-spacing: .04em;
    }

    /* Aggregate stat strip — cyan/black cockpit cards. Tabular figures roll in
       via <app-rolling-counter>; a left cyan rail keys it to the brand accent. */
    .cf-stats {
      display: flex; flex-wrap: wrap; gap: .75rem; margin-bottom: 1rem;
    }
    .cf-stat {
      flex: 1 1 7rem; min-width: 7rem;
      display: flex; flex-direction: column; gap: .15rem;
      padding: .55rem .75rem .55rem .9rem;
      background: var(--ps-accent-soft, rgba(0,229,255,.08));
      border: 1px solid var(--ps-accent-line, rgba(0,229,255,.22));
      border-left: 2px solid var(--ps-accent, #00e5ff);
      border-radius: 10px;
    }
    .cf-stat-num {
      font-size: 1.15rem; font-weight: 700; line-height: 1;
      font-variant-numeric: tabular-nums; color: var(--ps-accent, #00e5ff);
    }
    .cf-stat-label {
      font-size: .6rem; text-transform: uppercase; letter-spacing: .07em;
      color: rgba(244,244,255,.62);
    }

    /* Approve action — affirmative mint-cyan via the global --ps-success token
       (cockpit re-maps it to --ck-success). No hard-coded hex in this section. */
    .cf-approve { color: var(--ps-success, #4dffb5); }

    /* Spartan toggle-group status filter — dark+cyan-native segmented control
       (our own buttons; no ::ng-deep needed). Light ink on transparent; dark
       ink on the cyan active. */
    .cf-filter {
      display: inline-flex; flex-wrap: wrap; max-width: 100%; gap: 4px; margin-bottom: 1rem; padding: 3px;
      border-radius: 10px; background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(0, 229, 255, 0.12);
    }
    .cf-toggle {
      appearance: none; border: 0; background: transparent; cursor: pointer;
      color: var(--ps-ink, #f4f4ff); font-size: .72rem; font-weight: 600;
      padding: 5px 12px; border-radius: 7px; letter-spacing: .01em;
      transition: background .15s ease, color .15s ease;
    }
    .cf-toggle:hover { background: rgba(0, 229, 255, 0.08); }
    .cf-toggle:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 1px; }
    .cf-toggle-active, .cf-toggle-active:hover { background: var(--ps-accent, #00e5ff); color: #060610; }
    @media (prefers-reduced-motion: reduce) { .cf-toggle { transition: none; } }

    .cf-empty { display: flex; flex-direction: column; align-items: center; gap: .6rem; padding: 2rem 1rem; color: rgba(244,244,255,.62); font-size: .8rem; }
    .cf-skel { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: .25rem 0; }
    .cf-skel-bar { display: block; width: 100%; height: 30px; border-radius: 8px; }

    .cf-section-key {
      font-family: 'JetBrains Mono', monospace; font-size: .68rem;
      color: rgba(244,244,255,.85); max-width: 160px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
    }
    .cf-num { font-variant-numeric: tabular-nums; font-size: .72rem; color: rgba(244,244,255,.8); }
    .cf-num-col { text-align: right; }
    .cf-cell-date { color: rgba(244,244,255,.72); font-size: .68rem; white-space: nowrap; }
    .cf-actions-col { text-align: right; white-space: nowrap; }
    .cf-act-done { color: rgba(244,244,255,.72); font-size: .68rem; }

    /* ── Native cockpit table (TanStack headless drives sort; CSS is ours) ──── */
    .cf-grid { width: 100%; min-width: 40rem; border-collapse: collapse; background: transparent; color: var(--ps-ink, #f4f4ff); }
    .cf-grid thead > tr > th {
      font-size: .65rem; text-transform: uppercase; letter-spacing: .06em;
      padding: .5rem .75rem; font-weight: 600; text-align: left;
      background: rgba(0,229,255,0.04);
      color: rgba(244,244,255,0.6);
      border-bottom: 1px solid rgba(0,229,255,0.12);
    }
    .cf-grid tbody > tr > td {
      font-size: .72rem; padding: .45rem .75rem;
      border-bottom: 1px solid rgba(0,229,255,0.08);
    }
    .cf-grid tbody > tr:last-child > td { border-bottom: 0; }
    .cf-grid tbody > tr { transition: background 180ms var(--ease); }
    .cf-grid tbody > tr:hover > td { background: rgba(0,229,255,0.04); }
    .cf-grid th.cf-num-col, .cf-grid td.cf-num-col { text-align: right; }
    /* Sortable header affordance. */
    .cf-grid th.cf-sortable { cursor: pointer; user-select: none; }
    .cf-grid th.cf-sortable:hover { color: var(--ps-accent, #00e5ff); }
    .cf-grid th.cf-sortable:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: -2px; }
    .cf-sort-ind { margin-left: 4px; opacity: .5; font-size: .6rem; }
    .cf-grid th.cf-sortable[aria-sort="ascending"] .cf-sort-ind,
    .cf-grid th.cf-sortable[aria-sort="descending"] .cf-sort-ind { opacity: 1; color: var(--ps-accent, #00e5ff); }
    /* Server-side pager. */
    .cf-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 4px 0; }
    .cf-pager-info { font-size: .68rem; color: rgba(244,244,255,.5); }
    /* Action buttons are Spartan hlmBtn (size=sm owns its own padding/typography). */
    .cf-header-actions svg, .cf-actions-col svg { font-size: .7rem; }
    @keyframes cf-spin { to { transform: rotate(360deg); } }
    .cf-spin { display: inline-block; animation: cf-spin .8s linear infinite; }
    @media (prefers-reduced-motion: reduce) { .cf-spin { animation: none; } }
  `],
})
export class AdminContentFreshnessComponent implements OnInit {
  private api = inject(ApiService);
  private adminState = inject(AdminStateService);
  private toast = inject(ToastService);

  readonly statuses: StatusFilter[] = ['pending', 'approved', 'published', 'rejected'];
  /** Options for the toggle-group status filter (label/value pairs). */
  readonly statusOptions = this.statuses.map((s) => ({
    label: s.charAt(0).toUpperCase() + s.slice(1),
    value: s,
  }));
  readonly limit = 25;

  loading = signal(false);
  triggering = signal(false);
  error = signal<string | null>(null);
  drafts = signal<FreshnessDraft[]>([]);
  total = signal(0);
  page = signal(1);
  statusFilter = signal<StatusFilter>('pending');
  acting = signal<Set<string>>(new Set());

  /** Total server pages (custom pager is server-side; TanStack sort is client-side). */
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));

  // ── TanStack headless table (client-side sort of the fetched page) ────────
  readonly headerLabel: Record<string, string> = {
    section_key: 'Section', idle_days: 'Idle days', dwell_seconds_avg: 'Avg dwell',
    status: 'Status', created_at: 'Created', actions: 'Actions',
  };
  /** Right-aligned numeric columns (template adds .cf-num-col). */
  readonly numCol: Record<string, boolean> = { idle_days: true, dwell_seconds_avg: true };
  private readonly sorting = signal<SortingState>([]);
  private readonly columns: ColumnDef<FreshnessDraft>[] = [
    { id: 'section_key', accessorKey: 'section_key' },
    { id: 'idle_days', accessorKey: 'idle_days' },
    { id: 'dwell_seconds_avg', accessorKey: 'dwell_seconds_avg' },
    { id: 'status', accessorKey: 'status' },
    { id: 'created_at', accessorKey: 'created_at' },
    { id: 'actions', enableSorting: false },
  ];
  readonly table = createAngularTable<FreshnessDraft>(() => ({
    data: this.drafts(),
    columns: this.columns,
    state: { sorting: this.sorting() },
    onSortingChange: (updater) =>
      this.sorting.update((prev) => (typeof updater === 'function' ? updater(prev) : updater)),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  }));
  ariaSort(dir: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
    return dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';
  }
  sortGlyph(dir: false | 'asc' | 'desc'): string {
    return dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕';
  }
  /** Server-side page navigation (clamped); re-fetches via load(). */
  goToPage(p: number): void {
    const next = Math.min(Math.max(1, p), this.pageCount());
    if (next !== this.page()) {
      this.page.set(next);
      this.load();
    }
  }

  readonly pending = computed(() => {
    if (this.statusFilter() === 'pending') return this.total();
    return 0; // fetched separately only when needed
  });

  // ── Aggregate stat strip (computed over the fetched page) ─────────────────
  /** Drafts shown for the active filter (server total, not just this page). */
  readonly statTotal = computed(() => this.total());
  /** Mean idle-days across the fetched page, rounded for the rolling counter. */
  readonly statAvgIdle = computed(() => this.meanOf((d) => d.idle_days));
  /** Mean avg-dwell-seconds across the fetched page, rounded. */
  readonly statAvgDwell = computed(() => this.meanOf((d) => d.dwell_seconds_avg));

  /** Rounded arithmetic mean of a numeric draft field over the fetched page. */
  private meanOf(pick: (d: FreshnessDraft) => number): number {
    const rows = this.drafts();
    if (rows.length === 0) return 0;
    const sum = rows.reduce((acc, d) => acc + (pick(d) || 0), 0);
    return Math.round(sum / rows.length);
  }

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));

  ngOnInit(): void {
    this.load();
  }

  /**
   * Toggle-group change → swap the active status filter and reload page 1.
   * Single-select with no empty state: ignore a deselect (undefined) or an
   * unchanged value so the filter always has exactly one active status.
   */
  onFilterChange(value: unknown): void {
    const next = Array.isArray(value) ? value[0] : value;
    if (typeof next !== 'string' || next === this.statusFilter()) return;
    this.statusFilter.set(next as StatusFilter);
    this.page.set(1);
    this.load();
  }

  /** Map a draft status to a Spartan `hlmBadge` variant (cockpit-tinted). */
  statusBadge(status: FreshnessDraft['status']): BadgeVariant {
    switch (status) {
      case 'pending': return 'warning';
      case 'approved':
      case 'published': return 'success';
      case 'rejected': return 'danger';
      default: return 'neutral';
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const resp = await firstValueFrom(
        this.api.get<DraftsResponse>(
          `/content/freshness?status=${this.statusFilter()}&page=${this.page()}`,
        ),
      );
      this.drafts.set(resp.drafts);
      this.total.set(resp.total);
    } catch {
      this.error.set('Failed to load drafts. Check your connection and try again.');
    } finally {
      this.loading.set(false);
    }
  }

  async approve(draftId: string): Promise<void> {
    this.acting.update((s) => new Set([...s, draftId]));
    try {
      await firstValueFrom(this.api.post(`/content/freshness/approve/${draftId}`, {}, { silent: true }));
      this.drafts.update((list) => list.filter((d) => d.id !== draftId));
      this.total.update((t) => Math.max(0, t - 1));
      this.toast.success('Approved — rewrite queued to publish.');
    } catch {
      this.toast.error('Approve failed — try again in a moment.');
    } finally {
      this.acting.update((s) => { const n = new Set(s); n.delete(draftId); return n; });
    }
  }

  async reject(draftId: string): Promise<void> {
    this.acting.update((s) => new Set([...s, draftId]));
    try {
      await firstValueFrom(this.api.post(`/content/freshness/reject/${draftId}`, {}, { silent: true }));
      this.drafts.update((list) => list.filter((d) => d.id !== draftId));
      this.total.update((t) => Math.max(0, t - 1));
      this.toast.info('Rejected — draft discarded.');
    } catch {
      this.toast.error('Reject failed — try again in a moment.');
    } finally {
      this.acting.update((s) => { const n = new Set(s); n.delete(draftId); return n; });
    }
  }

  async triggerScan(): Promise<void> {
    this.triggering.set(true);
    try {
      await firstValueFrom(this.api.post('/content/freshness/trigger', {}, { silent: true }));
      this.toast.success('Scan started — new drafts appear shortly.');
    } catch {
      this.toast.error('Scan failed — could not start the scan.');
    } finally {
      this.triggering.set(false);
    }
  }
}
