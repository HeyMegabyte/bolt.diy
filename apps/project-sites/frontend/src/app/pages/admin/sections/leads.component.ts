import { Component, type OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { RevealDirective } from '../../../directives/reveal.directive';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/** A scanned lead row, mirroring the worker's `LeadSummary` (GET /api/admin/leads). */
interface LeadSummary {
  leadId: string;
  businessName: string;
  hasWebsite: boolean;
  leadScore: number;
  priority: boolean;
  email: string | null;
  emailStatus: string | null;
  source: string | null;
  createdAt: string;
}

/**
 * Super-Admin lead scanner (#9). Runs a Google-Places no-website scan
 * (`POST /api/admin/leads/scan`), lists scanned leads (`GET /api/admin/leads`),
 * and mints an outreach claim link per lead (`POST /api/admin/leads/:id/claim-link`)
 * copied to the clipboard. The whole surface is flag-dark (`lead_scanner`) +
 * server-side super-admin gated — this UI is the operator console for it.
 *
 * @remarks Outreach SEND is never automated here — the operator copies the claim
 * link and reaches out deliberately (compliant by construction).
 */
@Component({
  selector: 'app-admin-leads',
  standalone: true,
  imports: [FormsModule, RevealDirective, RollingCounterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-6 py-8 max-w-[1100px] mx-auto">
      <header appReveal class="mb-8">
        <h1 class="text-[clamp(1.4rem,3vw,2rem)] font-[800] tracking-tight text-white mb-2">
          Lead Scanner
        </h1>
        <p class="text-sm text-text-secondary max-w-[640px] [text-wrap:pretty]">
          Find local businesses with no website, then mint a claim link to invite them. Outreach is
          never automated — you copy the link and reach out deliberately.
        </p>
      </header>

      <!-- Scan form -->
      <form
        appReveal
        class="mb-8 flex flex-wrap items-end gap-3 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4"
        (ngSubmit)="scan()"
      >
        <label class="flex-1 min-w-[260px]">
          <span
            class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-secondary"
            >Search query</span
          >
          <input
            class="w-full rounded-lg border border-white/[0.1] bg-black/30 px-3 py-2 text-sm text-white outline-none transition-colors focus-visible:border-primary/60 focus-visible:ring-1 focus-visible:ring-primary/40"
            [(ngModel)]="query"
            name="query"
            placeholder="e.g. roofers in Newark NJ"
            data-testid="leads-scan-query"
            autocomplete="off"
          />
        </label>
        <label class="flex items-center gap-2 pb-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            [checked]="onlyNoWebsite()"
            (change)="onlyNoWebsite.set($any($event.target).checked)"
            data-testid="leads-only-no-website"
          />
          No-website only
        </label>
        <button
          type="submit"
          [disabled]="scanning() || query.trim().length < 2"
          class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-black transition-all hover:bg-primary/85 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] focus-visible:outline-offset-2"
          data-testid="leads-scan-submit"
        >
          {{ scanning() ? 'Scanning…' : 'Scan' }}
        </button>
        @if (lastScan(); as s) {
          <span class="pb-2 text-xs text-text-secondary" role="status" aria-live="polite"
            >Scanned {{ s.scanned }} · added {{ s.created }}</span
          >
        }
      </form>

      <!-- Lead count -->
      <div class="mb-4 flex items-center gap-2 text-sm text-text-secondary">
        <app-rolling-counter [value]="leads().length" />
        <span>{{ leads().length === 1 ? 'lead' : 'leads' }}</span>
      </div>

      <!-- States -->
      @if (loading()) {
        <p
          class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-sm text-text-secondary"
        >
          Loading leads…
        </p>
      } @else if (loadError()) {
        <div
          class="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-4 text-sm text-amber-200"
          role="alert"
        >
          Couldn't load leads.
          <button
            type="button"
            (click)="loadLeads()"
            class="rounded-full bg-amber-500/15 px-3 py-1 font-semibold text-amber-100 transition-all hover:bg-amber-500/25"
          >
            Retry
          </button>
        </div>
      } @else if (leads().length === 0) {
        <p
          class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-sm text-text-secondary"
          data-testid="leads-empty"
        >
          No leads yet. Run a scan above to find businesses without a website.
        </p>
      } @else {
        <div class="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table class="w-full text-left text-sm">
            <thead class="bg-white/[0.03] text-xs uppercase tracking-wider text-text-secondary">
              <tr>
                <th class="px-4 py-3">Business</th>
                <th class="px-4 py-3">Score</th>
                <th class="px-4 py-3">Signals</th>
                <th class="px-4 py-3">Email</th>
                <th class="px-4 py-3 text-right">Claim link</th>
              </tr>
            </thead>
            <tbody>
              @for (lead of leads(); track lead.leadId) {
                <tr class="border-t border-white/[0.06]">
                  <td class="px-4 py-3 font-medium text-white" [attr.title]="lead.businessName">
                    {{ lead.businessName }}
                  </td>
                  <td class="px-4 py-3">
                    <span
                      class="inline-flex min-h-[24px] items-center rounded-full bg-primary/15 px-2.5 text-xs font-semibold text-primary"
                      >{{ lead.leadScore }}</span
                    >
                  </td>
                  <td class="px-4 py-3">
                    <span class="flex flex-wrap gap-1.5">
                      @if (!lead.hasWebsite) {
                        <span
                          class="inline-flex min-h-[24px] items-center rounded-full bg-green-500/15 px-2.5 text-xs font-medium text-green-300"
                          >No website</span
                        >
                      }
                      @if (lead.priority) {
                        <span
                          class="inline-flex min-h-[24px] items-center rounded-full bg-secondary/20 px-2.5 text-xs font-medium text-secondary"
                          >Priority</span
                        >
                      }
                    </span>
                  </td>
                  <td class="px-4 py-3 text-text-secondary" [attr.title]="lead.email">
                    {{ lead.email ?? '—' }}
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button
                      type="button"
                      (click)="copyClaimLink(lead)"
                      [disabled]="isCopying(lead.leadId)"
                      class="inline-flex min-h-[24px] items-center rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary transition-all hover:bg-primary/25 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] focus-visible:outline-offset-2"
                      [attr.data-testid]="'leads-copy-link-' + lead.leadId"
                    >
                      {{ isCopying(lead.leadId) ? 'Minting…' : 'Copy claim link' }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class AdminLeadsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  query = '';
  readonly onlyNoWebsite = signal(true);
  readonly scanning = signal(false);
  readonly loading = signal(false);
  readonly loadError = signal(false);
  readonly leads = signal<LeadSummary[]>([]);
  readonly lastScan = signal<{ scanned: number; created: number } | null>(null);
  private readonly copyingIds = signal<ReadonlySet<string>>(new Set());

  /** True while this lead's claim link is being minted (per-row busy guard). */
  isCopying(id: string): boolean {
    return this.copyingIds().has(id);
  }

  ngOnInit(): void {
    this.loadLeads();
  }

  /** Load scanned leads (highest score first), honoring the no-website filter. */
  loadLeads(): void {
    this.loading.set(true);
    this.loadError.set(false);
    const query = this.onlyNoWebsite() ? '?onlyNoWebsite=true' : '';
    this.api.get<{ leads: LeadSummary[]; count: number }>(`/admin/leads${query}`).subscribe({
      next: (res) => {
        this.leads.set(res?.leads ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set(true);
        this.loading.set(false);
      },
    });
  }

  /** Run a Places no-website scan, then refresh the list. Double-submit guarded. */
  scan(): void {
    const query = this.query.trim();
    if (query.length < 2 || this.scanning()) return;
    this.scanning.set(true);
    this.api
      .post<{ summary: { scanned: number; created: number } }>('/admin/leads/scan', {
        query,
        onlyNoWebsite: this.onlyNoWebsite(),
      })
      .subscribe({
        next: (res) => {
          this.scanning.set(false);
          this.lastScan.set(res?.summary ?? null);
          this.toast.success(
            `Scanned ${res?.summary?.scanned ?? 0} · added ${res?.summary?.created ?? 0} leads.`,
          );
          this.loadLeads();
        },
        error: () => this.scanning.set(false),
      });
  }

  /** Mint a claim link for a lead and copy it to the clipboard. Per-row guarded. */
  copyClaimLink(lead: LeadSummary): void {
    if (this.isCopying(lead.leadId)) return;
    this.copyingIds.update((s) => new Set(s).add(lead.leadId));
    this.api
      .post<{
        token: string;
        claimUrl: string;
      }>(`/admin/leads/${encodeURIComponent(lead.leadId)}/claim-link`, {})
      .subscribe({
        next: (res) => {
          this.clearCopying(lead.leadId);
          if (!res?.claimUrl) return;
          void navigator.clipboard
            ?.writeText(res.claimUrl)
            .then(() => this.toast.success('Claim link copied to clipboard.'))
            .catch(() => this.toast.info(res.claimUrl));
        },
        error: () => this.clearCopying(lead.leadId),
      });
  }

  private clearCopying(id: string): void {
    this.copyingIds.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }
}
