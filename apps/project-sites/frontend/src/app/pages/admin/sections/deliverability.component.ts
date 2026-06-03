/**
 * @component AdminDeliverabilityComponent
 * @description `/admin/deliverability` — Email Deliverability Wizard (#12) surface.
 *
 * Cyan/black compact cockpit. For the selected site, checks the sending
 * domain's SPF / DKIM / DMARC via `GET /api/sites/:siteId/deliverability` and
 * renders a 0-100 score (rolling counter), per-record status, and the concrete
 * DNS fixes. Read-only (live DNS lookups only — fires on an explicit button,
 * never auto-hammered). An optional domain override checks a different sending
 * domain than the site's primary hostname.
 *
 * Backend is flag-gated (`email_deliverability_wizard`); when off it 404s and
 * this surface shows a friendly "not available" error (never leaks existence).
 */

import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { RevealDirective } from '../../../directives/reveal.directive';
import { HlmButtonDirective, HlmInputDirective } from '../../../ui';

interface DeliverabilityReport {
  domain: string;
  spf: { present: boolean; record: string | null };
  dmarc: { present: boolean; record: string | null; policy: string | null };
  dkim: { present: boolean; selectorsChecked: string[]; foundSelectors: string[] };
  score: number;
  recommendations: string[];
}
interface DeliverabilityResponse {
  ok: boolean;
  report: DeliverabilityReport;
}

@Component({
  selector: 'app-admin-deliverability',
  standalone: true,
  imports: [CommonModule, FormsModule, RollingCounterComponent, RevealDirective, HlmButtonDirective, HlmInputDirective],
  template: `
    <section class="max-w-3xl mx-auto px-5 py-7" appReveal>
      <header class="mb-6">
        <p class="font-mono uppercase tracking-wider text-[0.7rem] text-primary mb-1">Inbox placement</p>
        <h2 class="text-2xl font-semibold text-light">Email Deliverability</h2>
        <p class="text-text-secondary text-sm mt-1 max-w-prose">
          Check your sending domain's SPF, DKIM and DMARC records and get concrete fixes to stay out of spam.
        </p>
      </header>

      @if (!site()) {
        <div data-testid="deliverability-empty" class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-center">
          <p class="text-text-secondary text-sm">Select a site from <strong class="text-light">Sites</strong> to check its deliverability.</p>
        </div>
      } @else {
        <div class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col gap-4">
          <p class="text-sm text-text-secondary">
            Site: <strong class="text-light">{{ site()?.business_name || site()?.slug }}</strong>
          </p>
          <label class="flex flex-col gap-1.5">
            <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">Sending domain (optional — defaults to the site's custom domain)</span>
            <input hlmInput data-testid="deliverability-domain" placeholder="e.g. mail.example.com" [(ngModel)]="domainModel" />
          </label>
          <div class="flex items-center gap-3">
            <button hlmBtn data-testid="deliverability-check-btn" [disabled]="loading()" (click)="check()">
              {{ loading() ? 'Checking DNS…' : 'Check deliverability' }}
            </button>
            <span class="text-[0.72rem] text-text-secondary">Live DNS lookup — read-only.</span>
          </div>
        </div>
      }

      @if (error()) {
        <div data-testid="deliverability-error" role="alert" class="mt-5 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-300">
          {{ error() }}
        </div>
      }

      @if (report(); as r) {
        <div data-testid="deliverability-result" class="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5" appReveal>
          <div class="flex items-baseline gap-2">
            <app-rolling-counter data-testid="deliverability-score" [value]="r.score" [class]="scoreClass(r.score)" />
            <span class="text-text-secondary text-sm">/ 100 deliverability for <strong class="text-light">{{ r.domain }}</strong></span>
          </div>

          <div class="mt-4 grid gap-2">
            <div data-testid="deliverability-spf" class="flex items-center justify-between gap-3 text-sm rounded-lg bg-white/[0.03] px-3 py-2">
              <span class="text-light">SPF</span>
              <span [class]="r.spf.present ? 'text-primary' : 'text-amber-300/90'">{{ r.spf.present ? 'Configured' : 'Missing' }}</span>
            </div>
            <div data-testid="deliverability-dmarc" class="flex items-center justify-between gap-3 text-sm rounded-lg bg-white/[0.03] px-3 py-2">
              <span class="text-light">DMARC <span class="text-text-secondary text-[0.72rem]">{{ r.dmarc.policy ? '(p=' + r.dmarc.policy + ')' : '' }}</span></span>
              <span [class]="r.dmarc.present ? 'text-primary' : 'text-amber-300/90'">{{ r.dmarc.present ? 'Configured' : 'Missing' }}</span>
            </div>
            <div data-testid="deliverability-dkim" class="flex items-center justify-between gap-3 text-sm rounded-lg bg-white/[0.03] px-3 py-2">
              <span class="text-light">DKIM</span>
              <span [class]="r.dkim.present ? 'text-primary' : 'text-amber-300/90'">{{ r.dkim.present ? 'Configured' : 'Not found' }}</span>
            </div>
          </div>

          @if (r.recommendations.length > 0) {
            <div class="mt-4">
              <p class="text-[0.72rem] uppercase tracking-wide text-text-secondary mb-2">Fixes ({{ r.recommendations.length }})</p>
              <ul class="flex flex-col gap-1.5">
                @for (rec of r.recommendations; track rec) {
                  <li data-testid="deliverability-rec-row" class="text-[0.82rem] text-text-secondary rounded-lg bg-white/[0.03] px-3 py-2">{{ rec }}</li>
                }
              </ul>
            </div>
          } @else {
            <p class="mt-3 text-sm text-primary">All set — SPF, DKIM and DMARC look good.</p>
          }
        </div>
      }
    </section>
  `,
})
export class AdminDeliverabilityComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly state = inject(AdminStateService);

  readonly site = computed(() => this.state.selectedSite());
  readonly domainModel = signal('');

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly report = signal<DeliverabilityReport | null>(null);

  scoreClass(score: number): string {
    if (score >= 80) return 'text-primary';
    if (score >= 40) return 'text-amber-300';
    return 'text-red-400';
  }

  check(): void {
    const s = this.site();
    if (!s || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);

    const domain = this.domainModel().trim();
    const params = domain ? { domain } : undefined;

    this.api.get<DeliverabilityResponse>(`/sites/${s.id}/deliverability`, params).subscribe({
      next: (res) => {
        this.report.set(res.report);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const msg =
          (err as { error?: { error?: { message?: string } } })?.error?.error?.message ??
          'Deliverability check is not available for this site.';
        this.error.set(msg);
        this.toast.error(msg);
        this.loading.set(false);
      },
    });
  }
}
