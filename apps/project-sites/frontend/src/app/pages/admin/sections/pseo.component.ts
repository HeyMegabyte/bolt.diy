/**
 * /admin/pseo — Feature #17: pSEO Matrix Builder admin UI.
 *
 * Shows the service × city × intent × season matrix grid.
 * Per-row status badges: draft / approved / published.
 * Thin-content rows flagged in amber.
 * Rolling counter for totals.
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../../services/api.service';
import { firstValueFrom } from 'rxjs';
import { AdminStateService } from '../admin-state.service';
import { ToastService } from '../../../services/toast.service';
import { HlmTablistDirective } from '../../../ui';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { ErrorCardComponent } from '../../../components/states';

interface PseoPage {
  id: string;
  service: string;
  city: string;
  intent: string;
  season: string;
  route_slug: string;
  word_count: number | null;
  image_count: number | null;
  internal_links: number | null;
  has_local_biz_jsonld: number;
  slop_hits: number;
  thin_content: number;
  status: 'draft' | 'approved' | 'published' | 'rejected';
  created_at: string;
}

interface PagesResponse {
  pages: PseoPage[];
  total: number;
  page: number;
  limit: number;
}

interface MatrixStats {
  total: number;
  draft: number;
  approved: number;
  published: number;
  rejected: number;
  thinContent: number;
}

type StatusFilter = 'all' | PseoPage['status'];

@Component({
  selector: 'app-admin-pseo',
  standalone: true,
  imports: [CommonModule, RollingCounterComponent, HlmTablistDirective, ErrorCardComponent],
  template: `
    <div class="ps-page" data-testid="pseo-section">

      <!-- Header -->
      <header class="ps-header">
        <div>
          <span class="ps-eyebrow">SEO</span>
          <h1 class="ps-h1">pSEO Matrix</h1>
          <p class="ps-sub">
            service × city × intent × season — up to 200 programmatic pages per site.
          </p>
        </div>
        <div class="ps-header-actions">
          @if (selectedSiteId()) {
            <button class="ps-btn-primary" (click)="generate()" [disabled]="generating()">
              @if (generating()) { ⟳ Queuing… } @else { ⊕ Generate matrix }
            </button>
          }
          <button class="ps-btn-outline" (click)="loadPages()" [disabled]="loading()">↻ Refresh</button>
        </div>
      </header>

      <!-- Stats strip -->
      @if (stats()) {
        <div class="ps-stats-strip">
          <div class="ps-stat">
            <app-rolling-counter [value]="stats()!.total" />
            <span class="ps-stat-label">total</span>
          </div>
          <div class="ps-stat">
            <app-rolling-counter [value]="stats()!.approved" />
            <span class="ps-stat-label">approved</span>
          </div>
          <div class="ps-stat ps-stat-pub">
            <app-rolling-counter [value]="stats()!.published" />
            <span class="ps-stat-label">published</span>
          </div>
          <div class="ps-stat ps-stat-warn">
            <app-rolling-counter [value]="stats()!.thinContent" />
            <span class="ps-stat-label">thin</span>
          </div>
        </div>
      }

      <!-- Status filter pills -->
      <div class="ps-pills" role="tablist" hlmTablist aria-label="Filter pages">
        @for (s of statusFilters; track s) {
          <button
            class="ps-pill"
            [class.ps-pill-active]="statusFilter() === s"
            (click)="statusFilter.set(s); loadPages()"
            role="tab"
            [attr.aria-selected]="statusFilter() === s">
            {{ s }}
          </button>
        }
      </div>

      @if (loading()) {
        <div class="ps-skel" role="status" aria-busy="true" aria-label="Loading pages">
          @for (i of [0,1,2,3,4,5,6]; track i) {
            <span class="glow-skel ps-skel-bar" aria-hidden="true"></span>
          }
        </div>
      }

      @if (error()) {
        <app-error-card
          title="Couldn't load the pSEO matrix"
          [message]="error()!"
          hint="Select a site, then retry. If it keeps failing, copy the reference for support."
          (retry)="loadPages()" />
      }

      @if (!loading() && !error() && pages().length === 0) {
        <div class="ps-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity=".3"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          <p>No pages yet. Select a site and click "Generate matrix" to build the grid.</p>
        </div>
      }

      @if (!loading() && pages().length > 0) {
        <div class="ps-table-wrap" role="region">
          <table class="ps-table" aria-label="pSEO matrix pages">
            <thead>
              <tr>
                <th scope="col">Route</th>
                <th scope="col">Service</th>
                <th scope="col">City</th>
                <th scope="col">Intent</th>
                <th scope="col">Season</th>
                <th scope="col" class="ps-th-num">Words</th>
                <th scope="col" class="ps-th-num">Imgs</th>
                <th scope="col">Status</th>
                <th scope="col" class="ps-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (p of pages(); track p.id; let i = $index) {
                <tr class="ps-row" [class.ps-row-thin]="p.thin_content === 1" [style.animation-delay.ms]="i * 30">
                  <td class="ps-cell-route">
                    <span class="ps-route-slug" [attr.title]="p.route_slug">{{ p.route_slug }}</span>
                  </td>
                  <td class="ps-cell-text">{{ p.service }}</td>
                  <td class="ps-cell-text">{{ p.city }}</td>
                  <td>
                    <span class="ps-intent-pill" [attr.data-intent]="p.intent">{{ p.intent }}</span>
                  </td>
                  <td class="ps-cell-text">{{ p.season }}</td>
                  <td class="ps-cell-num">{{ p.word_count ?? '—' }}</td>
                  <td class="ps-cell-num">{{ p.image_count ?? '—' }}</td>
                  <td>
                    <span class="ps-status-pill" [attr.data-status]="p.status">
                      {{ p.status }}
                      @if (p.thin_content === 1) { <span class="ps-thin-flag" title="Thin content">⚠</span> }
                    </span>
                  </td>
                  <td class="ps-cell-actions">
                    @if (p.status === 'approved') {
                      <button class="ps-act-publish" (click)="publishPage(p)" [disabled]="acting().has(p.id)" aria-label="Publish {{ p.route_slug }}">Publish</button>
                    } @else if (p.status === 'draft' && p.word_count) {
                      <button class="ps-act-approve" (click)="approvePage(p)" [disabled]="acting().has(p.id)" aria-label="Approve {{ p.route_slug }}">Approve</button>
                      <button class="ps-act-reject" (click)="rejectPage(p)" [disabled]="acting().has(p.id)" aria-label="Reject {{ p.route_slug }}">Reject</button>
                    } @else {
                      <span class="ps-act-done">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (total() > limit) {
          <div class="ps-pagination">
            <button class="ps-btn-outline" [disabled]="page() <= 1" (click)="prevPage()">← Prev</button>
            <span class="ps-page-info">{{ page() }} / {{ totalPages() }}</span>
            <button class="ps-btn-outline" [disabled]="page() >= totalPages()" (click)="nextPage()">Next →</button>
          </div>
        }
      }

    </div>
  `,
  styles: [`
    :host { --ease: cubic-bezier(0.4,0,0.2,1); display: block; }

    .ps-page { padding: 1.75rem; max-width: 1200px; animation: fadeUp 420ms var(--ease); }
    @keyframes fadeUp { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform:none; } }

    .ps-header { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; flex-wrap:wrap; margin-bottom:1rem; }
    .ps-header-actions { display:flex; gap:.5rem; align-items:center; flex-shrink:0; }
    .ps-eyebrow { font-size:.65rem; letter-spacing:.1em; color:var(--ps-accent); text-transform:uppercase; font-weight:700; display:block; margin-bottom:.25rem; }
    .ps-h1 { font-size:1.25rem; font-weight:700; color:#fff; margin:0 0 .25rem; }
    .ps-sub { font-size:.75rem; color:rgba(244,244,255,.55); margin:0; }

    .ps-btn-primary {
      font-size:.72rem; font-weight:700; padding:.4rem 1rem;
      border-radius:8px; border:none; background:var(--ps-accent); color:#060610; cursor:pointer;
      transition:opacity 200ms;
    }
    .ps-btn-primary:hover:not(:disabled) { opacity:.85; }
    .ps-btn-primary:disabled { opacity:.4; cursor:not-allowed; }

    .ps-btn-outline {
      font-size:.72rem; font-weight:600; padding:.35rem .75rem;
      border:1px solid rgba(0,229,255,.3); border-radius:8px;
      background:transparent; color:var(--ps-accent); cursor:pointer;
      transition:border-color 200ms var(--ease), background 200ms var(--ease);
    }
    .ps-btn-outline:hover:not(:disabled) { background:rgba(0,229,255,.08); border-color:rgba(0,229,255,.6); }
    .ps-btn-outline:disabled { opacity:.45; cursor:not-allowed; }

    .ps-stats-strip {
      display:flex; gap:1.25rem; flex-wrap:wrap; margin-bottom:1rem;
      background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.06);
      border-radius:12px; padding:.75rem 1.25rem;
    }
    .ps-stat { display:flex; flex-direction:column; align-items:flex-start; gap:.15rem; }
    .ps-stat-label { font-size:.62rem; color:rgba(244,244,255,.45); font-weight:600; text-transform:uppercase; letter-spacing:.06em; }
    .ps-stat-pub { color:#4ade80; }
    .ps-stat-warn { color:#fbbf24; }

    .ps-pills { display:flex; gap:.375rem; flex-wrap:wrap; margin-bottom:1rem; }
    .ps-pill {
      font-size:.65rem; font-weight:700; padding:.2rem .6rem;
      border-radius:9999px; border:1px solid rgba(255,255,255,.1);
      background:transparent; color:rgba(244,244,255,.55);
      cursor:pointer; text-transform:capitalize; transition:all 180ms var(--ease);
    }
    .ps-pill:hover { color:var(--ps-accent); border-color:rgba(0,229,255,.3); }
    .ps-pill-active { background:rgba(0,229,255,.12); color:var(--ps-accent); border-color:rgba(0,229,255,.35); }

    .ps-empty { text-align:center; padding:2.5rem 1rem; color:rgba(244,244,255,.45); font-size:.8rem; display:flex; flex-direction:column; align-items:center; gap:.75rem; }
    .ps-skel { display:flex; flex-direction:column; gap:8px; padding:.5rem 0; }
    .ps-skel-bar { display:block; width:100%; height:34px; border-radius:8px; }

    .ps-table-wrap { border:1px solid rgba(255,255,255,.06); border-radius:12px; overflow:hidden; }
    .ps-table { width:100%; border-collapse:collapse; font-size:.72rem; }
    .ps-table th {
      background:rgba(255,255,255,.03); padding:.5rem .75rem;
      color:rgba(244,244,255,.5); font-weight:600; font-size:.65rem;
      text-transform:uppercase; letter-spacing:.06em; text-align:left;
      border-bottom:1px solid rgba(255,255,255,.06);
    }
    .ps-th-num { text-align:right; }
    .ps-th-actions { text-align:right; }

    .ps-row {
      border-bottom:1px solid rgba(255,255,255,.04);
      transition:background 180ms var(--ease);
      animation:fadeUp 300ms var(--ease) both;
    }
    .ps-row:last-child { border-bottom:none; }
    .ps-row:hover { background:rgba(255,255,255,.025); }
    .ps-row-thin { background:rgba(234,179,8,.04); }
    .ps-row-thin:hover { background:rgba(234,179,8,.07); }

    .ps-table td { padding:.42rem .75rem; vertical-align:middle; max-height:36px; }

    .ps-cell-route .ps-route-slug {
      font-family:'JetBrains Mono',monospace; font-size:.65rem;
      color:rgba(244,244,255,.75); max-width:200px;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block;
    }
    .ps-cell-text { color:rgba(244,244,255,.8); font-size:.72rem; }
    .ps-cell-num { text-align:right; font-variant-numeric:tabular-nums; color:rgba(244,244,255,.65); }
    .ps-cell-actions { text-align:right; white-space:nowrap; }

    .ps-intent-pill {
      font-size:.6rem; font-weight:700; padding:.1rem .45rem;
      border-radius:9999px; text-transform:uppercase; letter-spacing:.04em;
    }
    .ps-intent-pill[data-intent='price'] { background:rgba(0,229,255,.1); border:1px solid rgba(0,229,255,.3); color:var(--ps-accent); }
    .ps-intent-pill[data-intent='how-to'] { background:rgba(34,197,94,.1); border:1px solid rgba(34,197,94,.3); color:#4ade80; }
    .ps-intent-pill[data-intent='diagnostic'] { background:rgba(168,85,247,.1); border:1px solid rgba(168,85,247,.3); color:#c084fc; }
    .ps-intent-pill[data-intent='emergency'] { background:rgba(248,113,113,.1); border:1px solid rgba(248,113,113,.3); color:#f87171; }

    .ps-status-pill {
      font-size:.6rem; font-weight:700; padding:.1rem .5rem;
      border-radius:9999px; text-transform:uppercase; letter-spacing:.04em;
      display:inline-flex; align-items:center; gap:.25rem;
    }
    .ps-status-pill[data-status='draft'] { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); color:rgba(244,244,255,.6); }
    .ps-status-pill[data-status='approved'] { background:rgba(0,229,255,.1); border:1px solid rgba(0,229,255,.35); color:var(--ps-accent); }
    .ps-status-pill[data-status='published'] { background:rgba(34,197,94,.12); border:1px solid rgba(34,197,94,.35); color:#4ade80; }
    .ps-status-pill[data-status='rejected'] { background:rgba(248,113,113,.1); border:1px solid rgba(248,113,113,.3); color:#f87171; }
    .ps-thin-flag { color:#fbbf24; font-size:.7rem; }

    .ps-act-approve {
      font-size:.62rem; font-weight:700; padding:.18rem .5rem;
      border-radius:6px; border:1px solid rgba(0,229,255,.3);
      background:rgba(0,229,255,.08); color:var(--ps-accent); cursor:pointer;
      transition:background 180ms; margin-right:.25rem;
    }
    .ps-act-approve:hover:not(:disabled) { background:rgba(0,229,255,.18); }
    .ps-act-approve:disabled { opacity:.4; cursor:not-allowed; }

    .ps-act-publish {
      font-size:.62rem; font-weight:700; padding:.18rem .5rem;
      border-radius:6px; border:1px solid rgba(34,197,94,.35);
      background:rgba(34,197,94,.1); color:#4ade80; cursor:pointer;
      transition:background 180ms; margin-right:.25rem;
    }
    .ps-act-publish:hover:not(:disabled) { background:rgba(34,197,94,.2); }
    .ps-act-publish:disabled { opacity:.4; cursor:not-allowed; }

    .ps-act-reject {
      font-size:.62rem; font-weight:700; padding:.18rem .5rem;
      border-radius:6px; border:1px solid rgba(248,113,113,.3);
      background:rgba(248,113,113,.07); color:#f87171; cursor:pointer;
      transition:background 180ms;
    }
    .ps-act-reject:hover:not(:disabled) { background:rgba(248,113,113,.15); }
    .ps-act-reject:disabled { opacity:.4; cursor:not-allowed; }

    .ps-act-done { color:rgba(244,244,255,.25); font-size:.68rem; }

    .ps-pagination { display:flex; align-items:center; justify-content:center; gap:.75rem; margin-top:1rem; font-size:.72rem; }
    .ps-page-info { color:rgba(244,244,255,.5); }
  `],
})
export class AdminPseoComponent implements OnInit {
  private api = inject(ApiService);
  private adminState = inject(AdminStateService);
  private toast = inject(ToastService);

  readonly statusFilters: StatusFilter[] = ['all', 'draft', 'approved', 'published', 'rejected'];
  readonly limit = 50;

  loading = signal(false);
  generating = signal(false);
  error = signal<string | null>(null);
  pages = signal<PseoPage[]>([]);
  total = signal(0);
  page = signal(1);
  statusFilter = signal<StatusFilter>('all');
  stats = signal<MatrixStats | null>(null);
  acting = signal<Set<string>>(new Set());

  readonly selectedSiteId = computed(() => this.adminState.selectedSite()?.id ?? null);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));

  ngOnInit(): void {
    this.loadStats();
    this.loadPages();
  }

  async loadStats(): Promise<void> {
    const siteId = this.selectedSiteId();
    if (!siteId) return;
    try {
      const resp = await firstValueFrom(this.api.get<{ stats: MatrixStats }>(`/pseo/${siteId}`));
      this.stats.set(resp.stats);
    } catch {
      /* silent — stats are informational */
    }
  }

  async loadPages(): Promise<void> {
    const siteId = this.selectedSiteId();
    if (!siteId) return;
    this.loading.set(true);
    this.error.set(null);
    const statusParam = this.statusFilter() !== 'all' ? `&status=${this.statusFilter()}` : '';
    try {
      const resp = await firstValueFrom(
        this.api.get<PagesResponse>(`/pseo/${siteId}/pages?page=${this.page()}${statusParam}`),
      );
      this.pages.set(resp.pages);
      this.total.set(resp.total);
    } catch {
      this.error.set('Failed to load pSEO pages.');
    } finally {
      this.loading.set(false);
    }
  }

  async generate(): Promise<void> {
    const siteId = this.selectedSiteId();
    if (!siteId) return;
    this.generating.set(true);
    try {
      await firstValueFrom(this.api.post(`/pseo/${siteId}/generate`, {}));
      this.toast.success('Matrix generation queued — pages appear in the grid as they build.');
      // Reload after a brief pause to let the workflow kick off
      setTimeout(() => { this.loadStats(); this.loadPages(); }, 2000);
    } catch (e) {
      this.toast.error((e as { error?: { error?: string } })?.error?.error ?? 'Could not start matrix generation. Try again.');
    } finally {
      this.generating.set(false);
    }
  }

  async approvePage(p: PseoPage): Promise<void> {
    const siteId = this.selectedSiteId();
    if (!siteId) return;
    this.acting.update((s) => new Set([...s, p.id]));
    try {
      await firstValueFrom(this.api.post(`/pseo/${siteId}/pages/${p.id}/approve`, {}));
      this.pages.update((list) => list.map((row) => row.id === p.id ? { ...row, status: 'approved' as const } : row));
      this.toast.success(`Approved ${p.route_slug}`);
    } catch (e) {
      this.toast.error((e as { error?: { error?: string } })?.error?.error ?? `Could not approve ${p.route_slug}. Try again.`);
    } finally {
      this.acting.update((s) => { const n = new Set(s); n.delete(p.id); return n; });
    }
  }

  async publishPage(p: PseoPage): Promise<void> {
    const siteId = this.selectedSiteId();
    if (!siteId) return;
    this.acting.update((s) => new Set([...s, p.id]));
    try {
      await firstValueFrom(this.api.post(`/pseo/${siteId}/pages/${p.id}/publish`, {}));
      this.pages.update((list) => list.map((row) => row.id === p.id ? { ...row, status: 'published' as const } : row));
      this.toast.success(`Published ${p.route_slug}`);
      this.loadStats();
    } catch (e) {
      this.toast.error((e as { error?: { error?: string } })?.error?.error ?? `Could not publish ${p.route_slug}. Try again.`);
    } finally {
      this.acting.update((s) => { const n = new Set(s); n.delete(p.id); return n; });
    }
  }

  async rejectPage(p: PseoPage): Promise<void> {
    const siteId = this.selectedSiteId();
    if (!siteId) return;
    this.acting.update((s) => new Set([...s, p.id]));
    try {
      await firstValueFrom(this.api.post(`/pseo/${siteId}/pages/${p.id}/reject`, {}));
      this.pages.update((list) => list.map((row) => row.id === p.id ? { ...row, status: 'rejected' as const } : row));
      this.toast.success(`Rejected ${p.route_slug}`);
    } catch (e) {
      this.toast.error((e as { error?: { error?: string } })?.error?.error ?? `Could not reject ${p.route_slug}. Try again.`);
    } finally {
      this.acting.update((s) => { const n = new Set(s); n.delete(p.id); return n; });
    }
  }

  prevPage(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.loadPages(); } }
  nextPage(): void { if (this.page() < this.totalPages()) { this.page.update((p) => p + 1); this.loadPages(); } }
}
