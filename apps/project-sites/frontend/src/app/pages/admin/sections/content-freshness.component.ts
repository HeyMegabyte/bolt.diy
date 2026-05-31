/**
 * /admin/content-freshness — Feature #16: Content Freshness Cron admin UI.
 *
 * Shows pending AI rewrite drafts for the owner to approve or reject.
 * Counts awaiting badge uses <app-rolling-counter>.
 *
 * ── PrimeNG reference migration ──────────────────────────────────────────
 * This section is the canonical "table-heavy" PrimeNG migration example for
 * the cockpit (see `PRIMENG_MIGRATION.md`). It maps the former hand-rolled
 * patterns onto PrimeNG components, all themed black+cyan via `CockpitPreset`:
 *   - hand-rolled `<table>`  → `p-table` (built-in sort + paginator + rows-per-page)
 *   - status `<span>` pill   → `p-tag` (severity-driven, cockpit-tinted)
 *   - filter `<button>` pills→ `p-selectButton` (single-select segmented control)
 *   - action `<button>`s     → `p-button` (severity success/danger, sm, text)
 *   - silent error swallow   → `p-toast` + `MessageService` (the prior code had a
 *                              "toast would require ToastService injection" gap —
 *                              now closed with PrimeNG's MessageService).
 * Every PrimeNG surface inherits the cockpit cyan/near-black tokens; the
 * `:host ::ng-deep` block only fine-tunes density to the cockpit's 13px/compact
 * rhythm — no color overrides needed (the preset handles those).
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { AdminStateService } from '../admin-state.service';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';

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

/** PrimeNG `p-tag` severity per draft status (drives the tag's color band). */
type TagSeverity = 'success' | 'info' | 'warn' | 'danger' | 'secondary';

@Component({
  selector: 'app-admin-content-freshness',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RollingCounterComponent,
    TableModule,
    ButtonModule,
    TagModule,
    SelectButtonModule,
    ToastModule,
  ],
  // MessageService is the PrimeNG toast bus; provided at the component level so
  // <p-toast> in this template gets a fresh, isolated queue.
  providers: [MessageService],
  template: `
    <div class="cf-page" data-testid="content-freshness-section">

      <!-- PrimeNG toast layer (cockpit-themed via CockpitPreset). -->
      <p-toast position="bottom-right" />

      <!-- Header -->
      <header class="cf-header">
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
          <p-button
            label="Run scan now"
            icon="pi pi-sync"
            severity="secondary"
            [outlined]="true"
            size="small"
            [loading]="triggering()"
            (onClick)="triggerScan()" />
          <p-button
            label="Refresh"
            icon="pi pi-refresh"
            [text]="true"
            size="small"
            [loading]="loading()"
            (onClick)="load()" />
        </div>
      </header>

      <!-- Status filter — PrimeNG segmented single-select -->
      <p-selectButton
        class="cf-filter"
        [options]="statusOptions"
        [(ngModel)]="statusModel"
        optionLabel="label"
        optionValue="value"
        [allowEmpty]="false"
        (onChange)="onFilterChange($event.value)"
        aria-label="Filter drafts by status" />

      <!-- Error state -->
      @if (error()) {
        <div class="cf-error" role="alert">{{ error() }}</div>
      }

      <!-- Draft table (PrimeNG) -->
      <p-table
        #dt
        [value]="drafts()"
        [loading]="loading()"
        [paginator]="total() > limit"
        [rows]="limit"
        [totalRecords]="total()"
        [lazy]="true"
        (onLazyLoad)="onLazyLoad($event)"
        [first]="(page() - 1) * limit"
        dataKey="id"
        styleClass="cf-grid p-datatable-sm"
        [tableStyle]="{ 'min-width': '40rem' }"
        data-testid="cf-table">
        <ng-template #header>
          <tr>
            <th pSortableColumn="section_key">Section <p-sortIcon field="section_key" /></th>
            <th pSortableColumn="idle_days" class="cf-num-col">Idle days <p-sortIcon field="idle_days" /></th>
            <th pSortableColumn="dwell_seconds_avg" class="cf-num-col">Avg dwell <p-sortIcon field="dwell_seconds_avg" /></th>
            <th pSortableColumn="status">Status <p-sortIcon field="status" /></th>
            <th pSortableColumn="created_at">Created <p-sortIcon field="created_at" /></th>
            <th class="cf-actions-col">Actions</th>
          </tr>
        </ng-template>
        <ng-template #body let-d>
          <tr>
            <td>
              <span class="cf-section-key" [attr.title]="d.section_key">{{ d.section_key }}</span>
            </td>
            <td class="cf-num-col"><span class="cf-num">{{ d.idle_days }}d</span></td>
            <td class="cf-num-col"><span class="cf-num">{{ d.dwell_seconds_avg | number:'1.0-0' }}s</span></td>
            <td>
              <p-tag [value]="d.status" [severity]="statusSeverity(d.status)" [rounded]="true" />
            </td>
            <td class="cf-cell-date">{{ d.created_at | date:'MMM d' }}</td>
            <td class="cf-actions-col">
              @if (d.status === 'pending') {
                <p-button
                  label="Approve"
                  severity="success"
                  size="small"
                  [text]="true"
                  [loading]="acting().has(d.id)"
                  (onClick)="approve(d.id)"
                  [attr.aria-label]="'Approve rewrite for ' + d.section_key" />
                <p-button
                  label="Reject"
                  severity="danger"
                  size="small"
                  [text]="true"
                  [loading]="acting().has(d.id)"
                  (onClick)="reject(d.id)"
                  [attr.aria-label]="'Reject rewrite for ' + d.section_key" />
              } @else {
                <span class="cf-act-done">—</span>
              }
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="6">
              <div class="cf-empty">
                <i class="pi pi-check-circle" style="font-size: 1.6rem; opacity: .35"></i>
                <p>No {{ statusFilter() }} drafts — sections are fresh.</p>
              </div>
            </td>
          </tr>
        </ng-template>
      </p-table>

    </div>
  `,
  styles: [`
    :host {
      --ease: cubic-bezier(0.4, 0, 0.2, 1);
      display: block;
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

    .cf-filter { display: block; margin-bottom: 1rem; }

    .cf-error { text-align: center; padding: 1.25rem 1rem; color: #f87171; font-size: .8rem; }
    .cf-empty { display: flex; flex-direction: column; align-items: center; gap: .6rem; padding: 2rem 1rem; color: rgba(244,244,255,.45); font-size: .8rem; }

    .cf-section-key {
      font-family: 'JetBrains Mono', monospace; font-size: .68rem;
      color: rgba(244,244,255,.85); max-width: 160px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
    }
    .cf-num { font-variant-numeric: tabular-nums; font-size: .72rem; color: rgba(244,244,255,.8); }
    .cf-num-col { text-align: right; }
    .cf-cell-date { color: rgba(244,244,255,.4); font-size: .68rem; white-space: nowrap; }
    .cf-actions-col { text-align: right; white-space: nowrap; }
    .cf-act-done { color: rgba(244,244,255,.25); font-size: .68rem; }

    /* ── Cockpit density tuning for the PrimeNG table ──────────────────────
       Colors come from CockpitPreset (cyan/near-black). These rules only
       compress the rhythm to the cockpit's 13px/compact spec; the unlayered
       cascade ensures they win over PrimeNG's default sizing. */
    /* Cockpit dark surface — PrimeNG's default table theme renders light;
       force transparent/dark so it matches the dark dashboard. */
    :host ::ng-deep .cf-grid,
    :host ::ng-deep .cf-grid .p-datatable-table,
    :host ::ng-deep .cf-grid .p-datatable-tbody > tr {
      background: transparent;
      color: var(--ps-ink, #f4f4ff);
    }
    :host ::ng-deep .cf-grid .p-datatable-thead > tr > th {
      font-size: .65rem; text-transform: uppercase; letter-spacing: .06em;
      padding: .5rem .75rem; font-weight: 600;
      background: rgba(0,229,255,0.04);
      color: rgba(244,244,255,0.6);
      border-color: rgba(0,229,255,0.12);
    }
    :host ::ng-deep .cf-grid .p-datatable-tbody > tr > td {
      font-size: .72rem; padding: .45rem .75rem;
      background: transparent;
      color: var(--ps-ink, #f4f4ff);
      border-color: rgba(0,229,255,0.08);
    }
    :host ::ng-deep .cf-grid .p-datatable-tbody > tr { transition: background 180ms var(--ease); }
    :host ::ng-deep .cf-grid .p-datatable-tbody > tr:hover > td { background: rgba(0,229,255,0.04); }
    :host ::ng-deep .cf-grid .p-button-sm { padding: .2rem .55rem; font-size: .65rem; }
  `],
})
export class AdminContentFreshnessComponent implements OnInit {
  private http = inject(HttpClient);
  private adminState = inject(AdminStateService);
  private messages = inject(MessageService);

  readonly statuses: StatusFilter[] = ['pending', 'approved', 'published', 'rejected'];
  /** Options for the `p-selectButton` filter (label/value pairs). */
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
  /** Plain ngModel mirror of `statusFilter` for the two-way p-selectButton bind. */
  statusModel: StatusFilter = 'pending';
  acting = signal<Set<string>>(new Set());

  readonly pending = computed(() => {
    if (this.statusFilter() === 'pending') return this.total();
    return 0; // fetched separately only when needed
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));

  ngOnInit(): void {
    this.load();
  }

  /** SelectButton change → swap the active status filter and reload page 1. */
  onFilterChange(value: StatusFilter): void {
    this.statusFilter.set(value);
    this.page.set(1);
    this.load();
  }

  /** p-table lazy paginator → translate `first` offset into our 1-based page. */
  onLazyLoad(ev: { first?: number }): void {
    const first = ev.first ?? 0;
    const nextPage = Math.floor(first / this.limit) + 1;
    if (nextPage !== this.page()) {
      this.page.set(nextPage);
      this.load();
    }
  }

  /** Map a draft status to its PrimeNG `p-tag` severity (cockpit-tinted). */
  statusSeverity(status: FreshnessDraft['status']): TagSeverity {
    switch (status) {
      case 'pending': return 'warn';
      case 'approved':
      case 'published': return 'success';
      case 'rejected': return 'danger';
      default: return 'secondary';
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const resp = await firstValueFrom(
        this.http.get<DraftsResponse>(
          `/api/content/freshness?status=${this.statusFilter()}&page=${this.page()}`,
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
      await firstValueFrom(this.http.post(`/api/content/freshness/approve/${draftId}`, {}));
      this.drafts.update((list) => list.filter((d) => d.id !== draftId));
      this.total.update((t) => Math.max(0, t - 1));
      this.messages.add({ severity: 'success', summary: 'Approved', detail: 'Rewrite queued to publish.' });
    } catch {
      this.messages.add({ severity: 'error', summary: 'Approve failed', detail: 'Try again in a moment.' });
    } finally {
      this.acting.update((s) => { const n = new Set(s); n.delete(draftId); return n; });
    }
  }

  async reject(draftId: string): Promise<void> {
    this.acting.update((s) => new Set([...s, draftId]));
    try {
      await firstValueFrom(this.http.post(`/api/content/freshness/reject/${draftId}`, {}));
      this.drafts.update((list) => list.filter((d) => d.id !== draftId));
      this.total.update((t) => Math.max(0, t - 1));
      this.messages.add({ severity: 'info', summary: 'Rejected', detail: 'Draft discarded.' });
    } catch {
      this.messages.add({ severity: 'error', summary: 'Reject failed', detail: 'Try again in a moment.' });
    } finally {
      this.acting.update((s) => { const n = new Set(s); n.delete(draftId); return n; });
    }
  }

  async triggerScan(): Promise<void> {
    this.triggering.set(true);
    try {
      await firstValueFrom(this.http.post('/api/content/freshness/trigger', {}));
      this.messages.add({ severity: 'success', summary: 'Scan started', detail: 'New drafts appear shortly.' });
    } catch {
      this.messages.add({ severity: 'error', summary: 'Scan failed', detail: 'Could not start the scan.' });
    } finally {
      this.triggering.set(false);
    }
  }
}
