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
import { RouterLink } from '@angular/router';
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
  imports: [CommonModule, FormsModule, RouterLink, RollingCounterComponent, RevealDirective, HlmButtonDirective, HlmInputDirective],
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
          <label class="flex flex-col gap-1.5" for="deliverability-domain">
            <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">Sending domain (optional — defaults to the site's custom domain)</span>
            <input
              hlmInput
              id="deliverability-domain"
              data-testid="deliverability-domain"
              placeholder="e.g. mail.example.com"
              autocomplete="off"
              spellcheck="false"
              class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
              [(ngModel)]="domainModel"
              [attr.aria-invalid]="domainInvalid() ? 'true' : null"
              [attr.aria-describedby]="domainInvalid() ? 'deliverability-domain-hint' : null"
            />
            @if (domainInvalid()) {
              <span id="deliverability-domain-hint" data-testid="deliverability-domain-hint" class="text-[0.7rem] text-red-300/90">
                Enter a bare domain like <code class="text-red-200">mail.example.com</code> — no <code class="text-red-200">https://</code>, paths, or spaces.
              </span>
            }
          </label>
          <div class="flex items-center gap-3">
            <button
              hlmBtn
              data-testid="deliverability-check-btn"
              class="min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
              [disabled]="loading() || domainInvalid() || flagDisabled()"
              [attr.aria-busy]="loading()"
              (click)="check()"
            >
              {{ loading() ? 'Checking DNS…' : 'Check deliverability' }}
            </button>
            <span class="text-[0.72rem] text-text-secondary">Live DNS lookup — read-only.</span>
          </div>
        </div>
      }

      @if (flagDisabled()) {
        <!-- Flag OFF (404) → calm cohesive cyan notice (NOT alarming red), inline Feature-Flags link. -->
        <div data-testid="deliverability-flag-gate" role="status" class="mt-5 rounded-xl border border-[#00E5FF]/15 bg-[#00E5FF]/[0.04] p-4 text-sm text-text-secondary">
          The deliverability wizard is behind the <code class="text-[#00E5FF]">email_deliverability_wizard</code> feature flag (currently disabled). Enable it in
          <a routerLink="/admin/feature-flags" class="text-[#00E5FF] underline underline-offset-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] rounded-sm">Feature&nbsp;Flags</a>.
        </div>
      } @else if (error()) {
        <div data-testid="deliverability-error" role="alert" class="mt-5 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-300">
          {{ error() }}
        </div>
      }

      @if (report(); as r) {
        <div data-testid="deliverability-result" class="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5" appReveal>
          <div
            class="flex items-baseline gap-2"
            role="img"
            [attr.aria-label]="'Deliverability score ' + r.score + ' out of 100 for ' + r.domain"
          >
            <app-rolling-counter data-testid="deliverability-score" [value]="r.score" [class]="scoreClass(r.score)" />
            <span class="text-text-secondary text-sm">/ 100 deliverability for <strong class="text-light">{{ r.domain }}</strong></span>
          </div>

          <!-- Cyan score meter: visualizes 0-100 as a filled cyan rail. -->
          <div
            class="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]"
            role="progressbar"
            aria-label="Deliverability score meter"
            [attr.aria-valuenow]="r.score"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              data-testid="deliverability-meter"
              class="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none"
              [style.width.%]="r.score"
            ></div>
          </div>

          <div class="mt-4 grid gap-2">
            <div data-testid="deliverability-spf" class="flex items-center justify-between gap-3 text-sm rounded-lg bg-white/[0.03] px-3 py-2">
              <span class="text-light">SPF</span>
              <span class="inline-flex items-center gap-1.5" [class]="r.spf.present ? 'text-primary' : 'text-amber-300'">
                <span aria-hidden="true">{{ r.spf.present ? '✓' : '!' }}</span>{{ r.spf.present ? 'Configured' : 'Missing' }}
              </span>
            </div>
            <div data-testid="deliverability-dmarc" class="flex items-center justify-between gap-3 text-sm rounded-lg bg-white/[0.03] px-3 py-2">
              <span class="text-light">DMARC <span class="text-text-secondary text-[0.72rem]">{{ r.dmarc.policy ? '(p=' + r.dmarc.policy + ')' : '' }}</span></span>
              <span class="inline-flex items-center gap-1.5" [class]="r.dmarc.present ? 'text-primary' : 'text-amber-300'">
                <span aria-hidden="true">{{ r.dmarc.present ? '✓' : '!' }}</span>{{ r.dmarc.present ? 'Configured' : 'Missing' }}
              </span>
            </div>
            <div data-testid="deliverability-dkim" class="flex items-center justify-between gap-3 text-sm rounded-lg bg-white/[0.03] px-3 py-2">
              <span class="text-light">DKIM</span>
              <span class="inline-flex items-center gap-1.5" [class]="r.dkim.present ? 'text-primary' : 'text-amber-300'">
                <span aria-hidden="true">{{ r.dkim.present ? '✓' : '!' }}</span>{{ r.dkim.present ? 'Configured' : 'Not found' }}
              </span>
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
  /** Flag OFF (check 404 = email_deliverability_wizard disabled) → calm cyan Feature-Flags notice, NOT a red error. */
  readonly flagDisabled = signal(false);
  readonly report = signal<DeliverabilityReport | null>(null);

  /** The domain override is OPTIONAL (empty → the site's own domain). When the
   *  operator DOES type something, validate the bare-hostname format client-side
   *  so junk (https://…, paths, spaces, single-label) gets instant feedback
   *  instead of a DNS-lookup round-trip → server error. */
  private isValidDomain(raw: string): boolean {
    return /^[a-z0-9][a-z0-9-]*\.[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(raw);
  }
  readonly domainInvalid = computed(() => {
    const d = this.domainModel().trim();
    return d.length > 0 && !this.isValidDomain(d);
  });

  scoreClass(score: number): string {
    if (score >= 80) return 'text-primary';
    if (score >= 40) return 'text-amber-300';
    return 'text-red-400';
  }

  check(): void {
    const s = this.site();
    if (!s || this.loading()) return;
    if (this.domainInvalid()) {
      this.error.set('Enter a bare domain like mail.example.com — no https://, paths, or spaces.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.flagDisabled.set(false);

    const domain = this.domainModel().trim();
    const params = domain ? { domain } : undefined;

    this.api.get<DeliverabilityResponse>(`/sites/${s.id}/deliverability`, params, { silent: true }).subscribe({
      next: (res) => {
        this.report.set(res.report);
        this.loading.set(false);
      },
      error: (err: { status?: number; error?: { error?: { message?: string } } }) => {
        // 404 = email_deliverability_wizard flag OFF (permanent → calm cyan
        // Feature-Flags notice, NOT alarming red; a worker SPA-fallthrough 200+HTML
        // is remapped to 404 by ApiService so it lands here as the calm gate too).
        // Anything else = transient (→ honest red "try again"; re-running is one
        // click on the Check button, so no separate Retry control is needed).
        if (err?.status === 404) {
          this.flagDisabled.set(true);
        } else {
          // Inline error banner (in the result panel where the user just clicked
          // "Check") is the UX — no transient toast on top, and the read is {silent}
          // so the generic ApiService toast doesn't fire either (was triple feedback).
          this.error.set(err?.error?.error?.message ?? 'Deliverability check failed — please try again.');
        }
        this.loading.set(false);
      },
    });
  }
}
