import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService, type AuditLogRow } from '../../../services/api.service';

/**
 * `/admin/auth-security` — Auth security & health dashboard (idea #3).
 *
 * @remarks
 * FRONTEND-ONLY. Consumes the existing `GET /api/audit-logs` (limit 500, silent)
 * and filters to rows whose `action` starts with `auth.`. From those it derives:
 * total sign-ins (`auth.session.created`), anomalies (`auth.anomaly.detected`),
 * the anomaly rate %, distinct actors, a breakdown of anomaly reasons parsed from
 * the `message` text (`new_ip` / `new_device`), and a capped table of the most
 * recent suspicious sign-ins. The data is dark until the Better Auth cutover, so
 * an empty `auth.*` set renders a calm informational state — never an error.
 *
 * Brand dark theme, AA contrast, 44px targets, `focus-visible` rings, `aria-*`,
 * `data-testid` hooks. Loading skeleton + branded retry on fetch failure.
 */
@Component({
  selector: 'app-admin-auth-security',
  standalone: true,
  template: `
    <main class="bg-dark text-white px-6 py-8 max-md:px-4" data-testid="auth-security-page">
      <header class="mb-6 max-w-3xl">
        <p class="text-[0.72rem] font-bold uppercase tracking-[0.15em] text-primary m-0">Security</p>
        <h1 class="text-2xl font-extrabold tracking-tight mt-1 mb-1.5">Auth security &amp; health</h1>
        <p class="text-[0.88rem] text-text-secondary m-0">
          Sign-in volume, anomaly detection, and the most recent suspicious logins across your org.
        </p>
      </header>

      @if (loading()) {
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="auth-security-loading" aria-hidden="true">
          @for (n of [1, 2, 3, 4]; track n) {
            <div class="h-[88px] rounded-2xl border border-white/[0.06] bg-dark-card animate-pulse"></div>
          }
        </div>
      } @else if (loadError()) {
        <div
          class="max-w-3xl rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3"
          role="alert"
          data-testid="auth-security-error"
        >
          <p class="text-[0.85rem] text-red-200 m-0">Couldn't load authentication events.</p>
          <button
            type="button"
            (click)="load()"
            data-testid="auth-security-retry"
            class="mt-2 min-h-[44px] rounded-lg bg-primary px-4 text-[0.85rem] font-bold text-dark transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            Retry
          </button>
        </div>
      } @else if (authRows().length === 0) {
        <div
          class="max-w-3xl rounded-2xl border border-primary/20 bg-primary-dim px-5 py-6 text-center"
          role="status"
          data-testid="auth-security-empty"
        >
          <p class="text-[0.95rem] font-semibold text-white m-0 mb-1.5">No authentication events yet</p>
          <p class="text-[0.85rem] text-text-secondary m-0">
            This dashboard activates after the Better Auth cutover.
          </p>
        </div>
      } @else {
        <!-- Metric cards -->
        <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="auth-security-metrics">
          <div class="rounded-2xl border border-white/[0.08] bg-dark-card p-4" data-testid="metric-signins">
            <p class="text-[0.74rem] font-semibold uppercase tracking-wide text-text-secondary m-0">Sign-ins</p>
            <p class="text-2xl font-extrabold tabular-nums mt-1 mb-0">{{ signIns() }}</p>
          </div>
          <div class="rounded-2xl border border-white/[0.08] bg-dark-card p-4" data-testid="metric-anomalies">
            <p class="text-[0.74rem] font-semibold uppercase tracking-wide text-text-secondary m-0">Anomalies</p>
            <p class="text-2xl font-extrabold tabular-nums mt-1 mb-0" [class.text-amber-300]="anomalies() > 0">
              {{ anomalies() }}
            </p>
          </div>
          <div class="rounded-2xl border border-white/[0.08] bg-dark-card p-4" data-testid="metric-anomaly-rate">
            <p class="text-[0.74rem] font-semibold uppercase tracking-wide text-text-secondary m-0">Anomaly rate</p>
            <p class="text-2xl font-extrabold tabular-nums mt-1 mb-0">{{ anomalyRatePct() }}%</p>
          </div>
          <div class="rounded-2xl border border-white/[0.08] bg-dark-card p-4" data-testid="metric-actors">
            <p class="text-[0.74rem] font-semibold uppercase tracking-wide text-text-secondary m-0">Distinct actors</p>
            <p class="text-2xl font-extrabold tabular-nums mt-1 mb-0">{{ distinctActors() }}</p>
          </div>
        </section>

        <!-- Anomaly reason breakdown -->
        @if (anomalies() > 0) {
          <section class="mt-8 max-w-3xl" aria-labelledby="auth-reasons-heading" data-testid="auth-security-reasons">
            <h2 id="auth-reasons-heading" class="text-[1rem] font-bold m-0 mb-3">Why flagged</h2>
            <ul class="m-0 p-0 list-none flex flex-col gap-2">
              @for (r of reasonBreakdown(); track r.label) {
                <li
                  class="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-dark-card px-3.5 py-2.5"
                  data-testid="auth-reason-row"
                >
                  <span class="text-[0.88rem] text-white">{{ r.label }}</span>
                  <span class="text-[0.85rem] font-semibold text-amber-300 tabular-nums">{{ r.count }}</span>
                </li>
              }
            </ul>
          </section>
        }

        <!-- Recent suspicious sign-ins -->
        <section class="mt-8 max-w-3xl" aria-labelledby="auth-suspicious-heading">
          <h2 id="auth-suspicious-heading" class="text-[1rem] font-bold m-0 mb-3">
            Recent suspicious sign-ins
            <span class="text-text-secondary font-normal">({{ suspicious().length }})</span>
          </h2>
          @if (suspicious().length) {
            <ul class="m-0 p-0 list-none flex flex-col gap-2" data-testid="auth-suspicious">
              @for (row of suspicious(); track row.id) {
                <li
                  class="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] bg-dark-card px-3.5 py-2.5"
                  data-testid="auth-suspicious-row"
                >
                  <div class="min-w-0">
                    <span class="block text-[0.9rem] text-white font-medium truncate" [attr.title]="actorOf(row)">
                      {{ actorOf(row) }}
                    </span>
                    <span class="block text-[0.78rem] text-text-secondary truncate" [attr.title]="row.message ?? ''">
                      {{ row.message || 'Anomalous sign-in' }}
                    </span>
                  </div>
                  <time class="text-[0.74rem] text-text-secondary shrink-0 tabular-nums">{{ timeOf(row) }}</time>
                </li>
              }
            </ul>
          } @else {
            <p class="text-[0.85rem] text-text-secondary" data-testid="auth-suspicious-empty">
              No suspicious sign-ins detected. Good news.
            </p>
          }
        </section>
      }
    </main>
  `,
})
export class AuthSecurityComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Newest-suspicious table cap. */
  private static readonly SUSPICIOUS_CAP = 25;

  readonly loading = signal(true);
  readonly loadError = signal(false);
  /** All `auth.*` audit rows, newest first. */
  readonly authRows = signal<AuditLogRow[]>([]);

  readonly signIns = computed(
    () => this.authRows().filter((r) => r.action === 'auth.session.created').length,
  );
  readonly anomalies = computed(
    () => this.authRows().filter((r) => r.action === 'auth.anomaly.detected').length,
  );
  /** Anomalies ÷ sign-ins, as a whole-number percent. Zero when no sign-ins. */
  readonly anomalyRatePct = computed(() => {
    const denom = this.signIns();
    return denom > 0 ? Math.round((this.anomalies() / denom) * 100) : 0;
  });
  readonly distinctActors = computed(
    () => new Set(this.authRows().map((r) => r.actor_id ?? '')).size,
  );

  /** Counts of parsed anomaly reasons (`new_ip`, `new_device`), highest first. */
  readonly reasonBreakdown = computed(() => {
    let newIp = 0;
    let newDevice = 0;
    for (const r of this.authRows()) {
      if (r.action !== 'auth.anomaly.detected') continue;
      const msg = (r.message ?? '').toLowerCase();
      if (msg.includes('new_ip') || msg.includes('new ip')) newIp += 1;
      if (msg.includes('new_device') || msg.includes('new device')) newDevice += 1;
    }
    return [
      { label: 'New IP address', count: newIp },
      { label: 'New device', count: newDevice },
    ]
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  });

  /** The most recent suspicious sign-ins, newest first, capped. */
  readonly suspicious = computed(() =>
    this.authRows()
      .filter((r) => r.action === 'auth.anomaly.detected')
      .slice(0, AuthSecurityComponent.SUSPICIOUS_CAP),
  );

  ngOnInit(): void {
    this.load();
  }

  /** Fetch up to 500 audit rows (silent), keep only `auth.*`; fail-soft to a retry card. */
  load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.api
      .get<{ data: AuditLogRow[] }>('/audit-logs', { limit: '500' }, { silent: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const rows = Array.isArray(res?.data) ? res.data : [];
          this.authRows.set(rows.filter((r) => typeof r.action === 'string' && r.action.startsWith('auth.')));
          this.loading.set(false);
        },
        error: () => {
          this.authRows.set([]);
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  /** Best-available actor label for a row. */
  actorOf(row: AuditLogRow): string {
    return row.actor_id || 'Unknown actor';
  }

  /** Locale-formatted timestamp; falls back to the raw string on a bad date. */
  timeOf(row: AuditLogRow): string {
    const d = new Date(row.created_at);
    return Number.isNaN(d.getTime()) ? row.created_at : d.toLocaleString();
  }
}
