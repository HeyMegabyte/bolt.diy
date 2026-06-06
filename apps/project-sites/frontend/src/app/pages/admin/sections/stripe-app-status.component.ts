/**
 * @module pages/admin/sections/stripe-app-status
 *
 * @description
 * Stripe App Marketplace install-analytics surface — idea #36 admin slice.
 *
 * Mounted at `/admin/stripe-app-status`. Reads
 *   GET /api/stripe-app/summary
 *   GET /api/stripe-app/installs
 *
 * The marketplace listing manifest itself (stripe-app.json + OAuth
 * callback) is owned by the growth agent. This surface backs the
 * admin dashboard with install lifecycle events.
 *
 * @packageDocumentation
 */
import {
  Component,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { InlineErrorComponent } from '../../../components/states';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';
import { RevealDirective } from '../../../directives/reveal.directive';

type InstallSource = 'marketplace' | 'direct' | 'referral';
type InstallStatus = 'installed' | 'uninstalled' | 'paused';

interface Install {
  id: string;
  org_id: string | null;
  stripe_account: string;
  install_source: InstallSource;
  status: InstallStatus;
  installed_at: string;
  uninstalled_at: string | null;
  last_event_at: string | null;
}

interface Summary {
  total_installs: number;
  active_installs: number;
  uninstalled: number;
  paused: number;
  by_source: Record<InstallSource, number>;
  last_event_at: string | null;
}

@Component({
  selector: 'app-admin-stripe-app-status',
  standalone: true,
  imports: [RevealDirective, CommonModule, RouterLink, RollingCounterComponent, DatePipe, InlineErrorComponent],
  template: `
    <div class="p-7 flex-1 overflow-y-auto max-md:p-4 space-y-6">
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div class="kicker">Stripe App Marketplace</div>
          <h2 class="section-h text-lg font-bold text-white m-0">
            Installation analytics
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Lifecycle events flow in from the marketplace OAuth callback
            (owned by the growth agent) to
            <code>POST /api/stripe-app/lifecycle</code>.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <a routerLink="/admin" class="btn-ghost text-xs">← Admin</a>
          <button class="btn-ghost text-xs" (click)="refresh()" [disabled]="loading()">
            {{ loading() ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
      </header>

      @if (notFound()) {
        <div class="empty-card">
          <p class="text-text-secondary text-sm">
            Stripe App marketplace status is disabled. Enable
            <code>stripe_app_status</code> in
            <a routerLink="/admin/feature-flags" class="text-[#00E5FF] underline underline-offset-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] rounded-sm">Feature&nbsp;Flags</a>.
          </p>
        </div>
      }

      @if (loadError() && !loading()) {
        <app-inline-error tone="error" data-testid="stripe-app-load-error" [message]="loadError()!" (retry)="refresh()" />
      }

      @if (!notFound() && summary()) {
        <section class="grid grid-cols-2 md:grid-cols-4 gap-3" appReveal>
          <div class="kpi">
            <div class="kpi-label">Total installs</div>
            <div class="kpi-value"><app-rolling-counter [value]="summary()!.total_installs" /></div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Active</div>
            <div class="kpi-value"><app-rolling-counter [value]="summary()!.active_installs" /></div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Uninstalled</div>
            <div class="kpi-value"><app-rolling-counter [value]="summary()!.uninstalled" /></div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Paused</div>
            <div class="kpi-value"><app-rolling-counter [value]="summary()!.paused" /></div>
          </div>
        </section>

        <section class="card" appReveal>
          <h3 class="card-h">By source</h3>
          <ul class="source-list">
            @for (s of sourceRows(); track s.source) {
              <li>
                <span class="cap">{{ s.source }}</span>
                <span class="bar"><span class="bar-fill" [style.width.%]="s.pct"></span></span>
                <span class="count"><app-rolling-counter [value]="s.count" /></span>
              </li>
            }
          </ul>
          @if (summary()!.last_event_at) {
            <p class="hint">Last event {{ summary()!.last_event_at | date: 'medium' }}.</p>
          }
        </section>

        <section class="card" appReveal>
          <h3 class="card-h">Recent installs</h3>
          @if (installsError() && installs().length === 0) {
            <app-inline-error tone="error" data-testid="stripe-installs-error" [message]="installsError()!" (retry)="refresh()" />
          } @else if (installs().length === 0) {
            <p class="hint">No installs yet.</p>
          }
          @if (installs().length > 0) {
            <table class="installs">
              <thead>
                <tr>
                  <th scope="col">Stripe account</th>
                  <th scope="col">Status</th>
                  <th scope="col">Source</th>
                  <th scope="col">Installed</th>
                  <th scope="col">Last event</th>
                </tr>
              </thead>
              <tbody>
                @for (row of installs(); track row.id) {
                  <tr>
                    <td class="font-mono text-[0.72rem]">{{ row.stripe_account }}</td>
                    <td><span class="status status-{{ row.status }}">{{ row.status }}</span></td>
                    <td>{{ row.install_source }}</td>
                    <td>{{ row.installed_at | date: 'short' }}</td>
                    <td>{{ (row.last_event_at ?? row.installed_at) | date: 'short' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      .card { background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06); border-radius: 14px; padding: 16px 18px; }
      .card-h { font-size: 0.92rem; color: var(--ps-ink, #f4f4ff); margin: 0 0 10px; font-weight: 600; }
      .hint { font-size: 0.72rem; color: rgba(244,244,255,.55); margin: 10px 0 0; }
      .kpi { background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06); border-radius: 12px; padding: 14px 16px; }
      .kpi-label { font-size: 0.7rem; color: rgba(244,244,255,.55); }
      .kpi-value { font-size: 1.15rem; color: var(--ps-ink, #f4f4ff); font-weight: 600; margin-top: 4px; }
      .empty-card { background: rgba(255,255,255,.02); border: 1px dashed rgba(255,255,255,.08); border-radius: 12px; padding: 16px 18px; }
      .source-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
      .source-list li { display: grid; grid-template-columns: 100px 1fr 60px; gap: 12px; align-items: center; font-size: 0.78rem; color: rgba(244,244,255,.7); }
      .cap { text-transform: capitalize; }
      .bar { height: 8px; background: rgba(255,255,255,.06); border-radius: 999px; overflow: hidden; }
      .bar-fill { display: block; height: 100%; background: var(--ps-accent, #00e5ff); }
      .count { text-align: right; font-variant-numeric: tabular-nums; color: var(--ps-ink, #f4f4ff); }
      .installs { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
      .installs th, .installs td { padding: 6px 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,.05); color: rgba(244,244,255,.7); }
      .installs th { color: rgba(244,244,255,.55); font-weight: 500; }
      .status { font-size: 0.68rem; padding: 2px 8px; border-radius: 999px; }
      .status-installed   { background: rgba(0,229,255,.12); color: var(--ps-accent, #00e5ff); }
      .status-uninstalled { background: rgba(255,80,80,.12); color: #f87171; }
      .status-paused      { background: rgba(255,200,0,.12); color: #ffc800; }
    `,
  ],
})
export class AdminStripeAppStatusComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly flags = inject(FeatureFlagService);

  readonly summary = signal<Summary | null>(null);
  readonly installs = signal<Install[]>([]);
  /** Set when the installs feed fails so the table shows a Retry, not a fake "No installs yet". */
  readonly installsError = signal<string | null>(null);
  readonly loading = signal(false);
  /** Persistent non-404 load failure — so a failed fetch shows a retry, not a blank panel. */
  readonly loadError = signal<string | null>(null);
  // Pessimistic: assume stripe_app_status is OFF until the client-side flag
  // check confirms it's on — shows the disabled card first and prevents the
  // unconditional /stripe-app/* fetch from firing (which would auto-toast on
  // the intentional 404 of a disabled feature).
  readonly notFound = signal(true);

  constructor() {
    // Gate the org-scoped fetch on the actual flag (mirrors inbox/enterprise).
    // Flag off → keep the disabled card (notFound stays true) and never fire
    // /stripe-app/* → no spurious 404 → no error toast.
    this.flags
      .isOn('stripe_app_status')
      .pipe(takeUntilDestroyed())
      .subscribe((on) => {
        if (on) {
          this.notFound.set(false);
          this.refresh();
        }
      });
  }

  sourceRows(): Array<{ source: string; count: number; pct: number }> {
    const s = this.summary();
    if (!s) return [];
    const total = Math.max(s.total_installs, 1);
    return (Object.keys(s.by_source) as InstallSource[]).map((source) => {
      const count = s.by_source[source] ?? 0;
      return { source, count, pct: Math.round((count / total) * 100) };
    });
  }

  refresh(): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.loadError.set(null);
    this.api.get<{ data: Summary }>('/stripe-app/summary', undefined, { silent: true }).subscribe({
      next: (res) => {
        this.loadError.set(null);
        this.summary.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        if (err?.status === 404) {
          this.notFound.set(true);
        } else {
          // Persistent in-panel error + retry so a failed fetch isn't a blank panel.
          this.loadError.set("Couldn't load Stripe App status — retry.");
          this.toast.error('Failed to load Stripe App summary');
        }
        this.loading.set(false);
      },
    });

    this.installsError.set(null);
    this.api
      .get<{ data: Install[] }>('/stripe-app/installs?limit=100', undefined, { silent: true })
      .subscribe({
        // {silent} so this secondary feed's failure doesn't double-toast with the
        // summary's managed error; surface it inline on the table instead.
        next: (res) => { this.installs.set(res.data ?? []); this.installsError.set(null); },
        error: () => this.installsError.set("Couldn't load recent installs — retry."),
      });
  }
}
