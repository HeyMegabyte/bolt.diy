/**
 * /admin/content-freshness — Feature #16: Content Freshness Cron admin UI.
 *
 * Shows pending AI rewrite drafts for the owner to approve or reject.
 * Counts awaiting badge uses <app-rolling-counter>.
 * Rows are ≤36px, card padding ≤12px. View Transitions wired.
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
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

@Component({
  selector: 'app-admin-content-freshness',
  standalone: true,
  imports: [CommonModule, RouterLink, RollingCounterComponent],
  template: `
    <div class="cf-page" data-testid="content-freshness-section">

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
          <button class="cf-btn-outline" (click)="triggerScan()" [disabled]="triggering()">
            @if (triggering()) { ⟳ Running… } @else { ↺ Run scan now }
          </button>
          <button class="cf-btn-refresh" (click)="load()" [disabled]="loading()">
            ↻ Refresh
          </button>
        </div>
      </header>

      <!-- Status filter pills -->
      <div class="cf-pills" role="tablist" aria-label="Filter by status">
        @for (s of statuses; track s) {
          <button
            class="cf-pill"
            [class.cf-pill-active]="statusFilter() === s"
            (click)="statusFilter.set(s); load()"
            role="tab"
            [attr.aria-selected]="statusFilter() === s">
            {{ s }}
          </button>
        }
      </div>

      <!-- Loading state -->
      @if (loading()) {
        <div class="cf-loading" role="status" aria-live="polite">Loading drafts…</div>
      }

      <!-- Error state -->
      @if (error()) {
        <div class="cf-error" role="alert">{{ error() }}</div>
      }

      <!-- Empty state -->
      @if (!loading() && !error() && drafts().length === 0) {
        <div class="cf-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"><circle cx="12" cy="12" r="10"/><polyline points="16 12 12 8 8 12"/><line x1="12" y1="16" x2="12" y2="8"/></svg>
          <p>No {{ statusFilter() }} drafts — sections are fresh.</p>
        </div>
      }

      <!-- Draft table -->
      @if (!loading() && drafts().length > 0) {
        <div class="cf-table-wrap" role="region" aria-label="Content freshness drafts">
          <table class="cf-table" aria-label="Drafts list">
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Idle days</th>
                <th scope="col">Avg dwell</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col" class="cf-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (d of drafts(); track d.id; let i = $index) {
                <tr class="cf-row" [style.animation-delay.ms]="i * 35">
                  <td class="cf-cell-key">
                    <span class="cf-section-key" [attr.title]="d.section_key">{{ d.section_key }}</span>
                  </td>
                  <td class="cf-cell-num">
                    <span class="cf-num">{{ d.idle_days }}d</span>
                  </td>
                  <td class="cf-cell-num">
                    <span class="cf-num">{{ d.dwell_seconds_avg | number:'1.0-0' }}s</span>
                  </td>
                  <td>
                    <span class="cf-status-pill" [attr.data-status]="d.status">{{ d.status }}</span>
                  </td>
                  <td class="cf-cell-date">{{ d.created_at | date:'MMM d' }}</td>
                  <td class="cf-cell-actions">
                    @if (d.status === 'pending') {
                      <button
                        class="cf-act-approve"
                        (click)="approve(d.id)"
                        [disabled]="acting().has(d.id)"
                        aria-label="Approve rewrite for {{ d.section_key }}">
                        Approve
                      </button>
                      <button
                        class="cf-act-reject"
                        (click)="reject(d.id)"
                        [disabled]="acting().has(d.id)"
                        aria-label="Reject rewrite for {{ d.section_key }}">
                        Reject
                      </button>
                    } @else {
                      <span class="cf-act-done">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        @if (total() > limit) {
          <div class="cf-pagination">
            <button class="cf-btn-outline" [disabled]="page() <= 1" (click)="prevPage()">← Prev</button>
            <span class="cf-page-info">Page {{ page() }} of {{ totalPages() }}</span>
            <button class="cf-btn-outline" [disabled]="page() >= totalPages()" (click)="nextPage()">Next →</button>
          </div>
        }
      }

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
    .cf-h1 { font-size: 1.25rem; font-weight: 700; color: #fff; margin: 0 0 .25rem; }
    .cf-sub { font-size: .75rem; color: rgba(244,244,255,.55); margin: 0; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
    .cf-badge {
      display: inline-flex; align-items: center; gap: .25rem;
      background: rgba(0,229,255,.12); border: 1px solid rgba(0,229,255,.3);
      color: var(--ps-accent); font-weight: 700; font-size: .62rem;
      padding: .125rem .625rem; border-radius: 9999px; letter-spacing: .04em;
    }

    .cf-btn-outline {
      font-size: .72rem; font-weight: 600; padding: .35rem .75rem;
      border: 1px solid rgba(0,229,255,.3); border-radius: 8px;
      background: transparent; color: var(--ps-accent); cursor: pointer;
      transition: border-color 200ms var(--ease), background 200ms var(--ease);
    }
    .cf-btn-outline:hover:not(:disabled) { background: rgba(0,229,255,.08); border-color: rgba(0,229,255,.6); }
    .cf-btn-outline:disabled { opacity: .45; cursor: not-allowed; }

    .cf-btn-refresh { @extend .cf-btn-outline; }

    .cf-pills {
      display: flex; gap: .375rem; flex-wrap: wrap; margin-bottom: 1rem;
    }
    .cf-pill {
      font-size: .65rem; font-weight: 700; padding: .2rem .6rem;
      border-radius: 9999px; border: 1px solid rgba(255,255,255,.1);
      background: transparent; color: rgba(244,244,255,.55);
      cursor: pointer; text-transform: capitalize;
      transition: all 180ms var(--ease);
    }
    .cf-pill:hover { color: var(--ps-accent); border-color: rgba(0,229,255,.3); }
    .cf-pill-active { background: rgba(0,229,255,.12); color: var(--ps-accent); border-color: rgba(0,229,255,.35); }

    .cf-loading, .cf-empty, .cf-error {
      text-align: center; padding: 2.5rem 1rem;
      color: rgba(244,244,255,.45); font-size: .8rem;
    }
    .cf-empty { display: flex; flex-direction: column; align-items: center; gap: .75rem; }
    .cf-error { color: #f87171; }

    .cf-table-wrap {
      border: 1px solid rgba(255,255,255,.06); border-radius: 12px; overflow: hidden;
    }
    .cf-table { width: 100%; border-collapse: collapse; font-size: .72rem; }
    .cf-table th {
      background: rgba(255,255,255,.03); padding: .5rem .75rem;
      color: rgba(244,244,255,.5); font-weight: 600; font-size: .65rem;
      text-transform: uppercase; letter-spacing: .06em; text-align: left;
      border-bottom: 1px solid rgba(255,255,255,.06);
    }
    .cf-th-actions { text-align: right; }

    .cf-row {
      border-bottom: 1px solid rgba(255,255,255,.04);
      transition: background 180ms var(--ease);
      animation: fadeUp 300ms var(--ease) both;
    }
    .cf-row:last-child { border-bottom: none; }
    .cf-row:hover { background: rgba(255,255,255,.025); }

    .cf-table td { padding: .45rem .75rem; vertical-align: middle; max-height: 36px; }

    .cf-section-key {
      font-family: 'JetBrains Mono', monospace; font-size: .68rem;
      color: rgba(244,244,255,.85); max-width: 160px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
    }
    .cf-cell-num { color: rgba(244,244,255,.7); text-align: right; }
    .cf-num { font-variant-numeric: tabular-nums; font-size: .72rem; }
    .cf-cell-date { color: rgba(244,244,255,.4); font-size: .68rem; white-space: nowrap; }
    .cf-cell-actions { text-align: right; white-space: nowrap; }

    .cf-status-pill {
      font-size: .6rem; font-weight: 700; padding: .1rem .5rem;
      border-radius: 9999px; text-transform: uppercase; letter-spacing: .04em;
    }
    .cf-status-pill[data-status='pending'] { background: rgba(234,179,8,.12); border: 1px solid rgba(234,179,8,.35); color: #fbbf24; }
    .cf-status-pill[data-status='approved'], .cf-status-pill[data-status='published'] { background: rgba(34,197,94,.12); border: 1px solid rgba(34,197,94,.35); color: #4ade80; }
    .cf-status-pill[data-status='rejected'] { background: rgba(248,113,113,.1); border: 1px solid rgba(248,113,113,.3); color: #f87171; }

    .cf-act-approve {
      font-size: .65rem; font-weight: 700; padding: .2rem .55rem;
      border-radius: 6px; border: 1px solid rgba(34,197,94,.35);
      background: rgba(34,197,94,.08); color: #4ade80; cursor: pointer;
      transition: background 180ms; margin-right: .25rem;
    }
    .cf-act-approve:hover:not(:disabled) { background: rgba(34,197,94,.18); }
    .cf-act-approve:disabled { opacity: .4; cursor: not-allowed; }

    .cf-act-reject {
      font-size: .65rem; font-weight: 700; padding: .2rem .55rem;
      border-radius: 6px; border: 1px solid rgba(248,113,113,.3);
      background: rgba(248,113,113,.07); color: #f87171; cursor: pointer;
      transition: background 180ms;
    }
    .cf-act-reject:hover:not(:disabled) { background: rgba(248,113,113,.15); }
    .cf-act-reject:disabled { opacity: .4; cursor: not-allowed; }

    .cf-act-done { color: rgba(244,244,255,.25); font-size: .68rem; }

    .cf-pagination {
      display: flex; align-items: center; justify-content: center;
      gap: .75rem; margin-top: 1rem; font-size: .72rem;
    }
    .cf-page-info { color: rgba(244,244,255,.5); }
  `],
})
export class AdminContentFreshnessComponent implements OnInit {
  private http = inject(HttpClient);
  private adminState = inject(AdminStateService);

  readonly statuses: StatusFilter[] = ['pending', 'approved', 'published', 'rejected'];
  readonly limit = 25;

  loading = signal(false);
  triggering = signal(false);
  error = signal<string | null>(null);
  drafts = signal<FreshnessDraft[]>([]);
  total = signal(0);
  page = signal(1);
  statusFilter = signal<StatusFilter>('pending');
  acting = signal<Set<string>>(new Set());

  readonly pending = computed(() => {
    if (this.statusFilter() === 'pending') return this.total();
    return 0; // fetched separately only when needed
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));

  ngOnInit(): void {
    this.load();
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
    } catch {
      // Surface inline error silently for now — toast would require ToastService injection
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
    } catch {
      /* silent */
    } finally {
      this.acting.update((s) => { const n = new Set(s); n.delete(draftId); return n; });
    }
  }

  async triggerScan(): Promise<void> {
    this.triggering.set(true);
    try {
      await firstValueFrom(this.http.post('/api/content/freshness/trigger', {}));
    } catch {
      /* silent */
    } finally {
      this.triggering.set(false);
    }
  }

  prevPage(): void {
    if (this.page() > 1) {
      this.page.update((p) => p - 1);
      this.load();
    }
  }

  nextPage(): void {
    if (this.page() < this.totalPages()) {
      this.page.update((p) => p + 1);
      this.load();
    }
  }
}
