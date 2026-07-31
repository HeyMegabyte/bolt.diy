import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { DialogShellComponent } from '../../../components/dialog-shell/dialog-shell.component';
import { ApiService, type AuditLogRow } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import {
  AuthApiService,
  type AuthSession,
  type TwoFactorEnableResult,
} from '../../auth/auth-api.service';

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
 * Also owns two live Better Auth surfaces (independent of the audit view):
 * an **active-sessions list** (`GET /api/auth/list-sessions`) with per-row
 * revoke (`POST /api/auth/revoke-session`), and the **two-factor enrollment
 * entry point** (password step of `POST /api/auth/two-factor/enable` inside a
 * `DialogShellComponent`). Both fail soft to calm states pre-cutover.
 *
 * Brand dark theme, AA contrast, 44px targets, `focus-visible` rings, `aria-*`,
 * `data-testid` hooks (`as-*`). Loading skeleton + branded retry on fetch failure.
 */
@Component({
  selector: 'app-admin-auth-security',
  standalone: true,
  imports: [FormsModule, DialogShellComponent],
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

      <!-- ── Active sessions (Better Auth GET /api/auth/list-sessions) ── -->
      <section class="mt-10 max-w-3xl" aria-labelledby="as-sessions-heading" data-testid="as-sessions">
        <div class="flex items-center justify-between gap-3 mb-3">
          <h2 id="as-sessions-heading" class="text-[1rem] font-bold m-0">
            Active sessions
            @if (!sessionsLoading() && !sessionsUnavailable()) {
              <span class="text-text-secondary font-normal" data-testid="as-sessions-count">({{ sessions().length }})</span>
            }
          </h2>
          <button
            type="button"
            (click)="loadSessions()"
            [disabled]="sessionsLoading()"
            [attr.aria-busy]="sessionsLoading()"
            data-testid="as-sessions-refresh"
            class="min-h-[36px] rounded-lg border border-white/[0.08] bg-dark-card px-3 text-[0.78rem] font-semibold text-text-secondary transition-colors hover:text-white hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        @if (sessionsLoading()) {
          <div class="flex flex-col gap-2" data-testid="as-sessions-loading" aria-hidden="true">
            @for (n of [1, 2]; track n) {
              <div class="h-[64px] rounded-lg border border-white/[0.06] bg-dark-card animate-pulse"></div>
            }
          </div>
        } @else if (sessionsUnavailable()) {
          <div class="rounded-xl border border-primary/20 bg-primary-dim px-4 py-3" role="status" data-testid="as-sessions-unavailable">
            <p class="text-[0.85rem] text-text-secondary m-0">
              Session listing activates after the Better Auth cutover. Your current sign-in is unaffected.
            </p>
          </div>
        } @else if (sessions().length === 0) {
          <p class="text-[0.85rem] text-text-secondary" data-testid="as-sessions-empty">
            No active sessions returned. Try refreshing.
          </p>
        } @else {
          <ul class="m-0 p-0 list-none flex flex-col gap-2" data-testid="as-sessions-list">
            @for (s of sessions(); track s.id) {
              <li
                class="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-dark-card px-3.5 py-2.5"
                [attr.data-testid]="'as-session-row-' + s.id"
              >
                <div class="min-w-0 flex-1">
                  <span class="block text-[0.9rem] text-white font-medium truncate" [attr.title]="s.userAgent ?? ''">
                    {{ deviceLabel(s) }}
                  </span>
                  <span class="block text-[0.74rem] text-text-secondary truncate">
                    {{ s.ipAddress || 'Unknown IP' }} · created {{ sessionTime(s) }}
                  </span>
                </div>
                <button
                  type="button"
                  (click)="revokeBaSession(s)"
                  [disabled]="isRevoking(s.id)"
                  [attr.aria-busy]="isRevoking(s.id)"
                  [attr.data-testid]="'as-session-revoke-' + s.id"
                  [attr.aria-label]="'Revoke session on ' + deviceLabel(s)"
                  class="min-h-[36px] shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-[0.78rem] font-bold text-red-200 transition-colors hover:bg-red-500/20 focus-visible:ring-2 focus-visible:ring-red-400/50 disabled:opacity-50"
                >
                  {{ isRevoking(s.id) ? 'Revoking…' : 'Revoke' }}
                </button>
              </li>
            }
          </ul>
        }
      </section>

      <!-- ── Two-factor authentication (enroll entry point) ── -->
      <section class="mt-8 max-w-3xl" aria-labelledby="as-2fa-heading" data-testid="as-2fa">
        <h2 id="as-2fa-heading" class="text-[1rem] font-bold m-0 mb-2">Two-factor authentication</h2>
        <div class="rounded-xl border border-white/[0.08] bg-dark-card px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <p class="text-[0.85rem] text-text-secondary m-0 max-w-[46ch]">
            Add a TOTP authenticator app as a second factor. Confirm your password, scan the code, then verify a 6-digit code at your next sign-in.
          </p>
          <button
            type="button"
            (click)="openTwoFa()"
            data-testid="as-2fa-enroll"
            class="min-h-[44px] rounded-lg bg-primary px-4 text-[0.85rem] font-bold text-dark transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            Enable two-factor
          </button>
        </div>
      </section>

      @if (twoFaOpen()) {
        <app-dialog-shell (closed)="closeTwoFa()">
          <span dialogTitle>Enable two-factor</span>
          <div class="px-6 py-5 flex flex-col gap-3" data-testid="as-2fa-dialog">
            @if (twoFa(); as t) {
              <p class="text-[0.85rem] text-text-secondary m-0">
                Scan this URI with your authenticator app. The next sign-in completes verification with a 6-digit code.
              </p>
              <code class="block rounded-lg bg-black/40 border border-white/[0.08] px-3 py-2 text-[0.72rem] break-all" data-testid="as-2fa-totp-uri">{{ t.totpURI }}</code>
              <p class="text-[0.78rem] text-amber-200 m-0">Store your backup codes now — they are shown once.</p>
            } @else {
              <label class="text-[0.8rem] text-text-secondary" for="as-2fa-password">
                Confirm your password to begin enrollment.
              </label>
              <input
                id="as-2fa-password"
                type="password"
                autocomplete="current-password"
                [ngModel]="twoFaPassword"
                (ngModelChange)="onTwoFaPasswordInput($event)"
                data-testid="as-2fa-password"
                class="w-full rounded-lg border border-white/[0.12] bg-black/30 px-3 py-2 text-[0.85rem] text-white focus-visible:ring-2 focus-visible:ring-primary/50"
                [attr.aria-invalid]="!!twoFaError()"
                aria-describedby="as-2fa-error"
              />
              @if (twoFaError(); as err) {
                <p id="as-2fa-error" class="text-[0.78rem] text-red-300 m-0" role="alert" aria-live="assertive" data-testid="as-2fa-error">{{ err }}</p>
              }
            }
          </div>
          <div dialogFooter class="px-6 py-4 border-t border-white/[0.06] flex justify-end gap-2">
            <button
              type="button"
              (click)="closeTwoFa()"
              data-testid="as-2fa-cancel"
              class="min-h-[40px] rounded-lg border border-white/[0.1] px-4 text-[0.82rem] font-semibold text-text-secondary transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {{ twoFa() ? 'Done' : 'Cancel' }}
            </button>
            @if (!twoFa()) {
              <button
                type="button"
                (click)="beginTwoFaEnroll()"
                [disabled]="!twoFaPassword.trim() || twoFaBusy()"
                [attr.aria-busy]="twoFaBusy()"
                data-testid="as-2fa-continue"
                class="min-h-[40px] rounded-lg bg-primary px-4 text-[0.82rem] font-bold text-dark transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50"
              >
                {{ twoFaBusy() ? 'Checking…' : 'Continue' }}
              </button>
            }
          </div>
        </app-dialog-shell>
      }
    </main>
  `,
})
export class AuthSecurityComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly authApi = inject(AuthApiService);
  private readonly toast = inject(ToastService);
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
    void this.loadSessions();
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

  // ─────────────────── Active sessions (Better Auth) ───────────────────

  /** Better Auth sessions for the signed-in user (GET /api/auth/list-sessions). */
  readonly sessions = signal<AuthSession[]>([]);
  readonly sessionsLoading = signal(true);
  /** True when the list endpoint is unreachable/dark (pre-cutover) — calm state, never an error. */
  readonly sessionsUnavailable = signal(false);
  private readonly revokingIds = signal<ReadonlySet<string>>(new Set());

  isRevoking(id: string): boolean {
    return this.revokingIds().has(id);
  }

  /**
   * Fetch the caller's active Better Auth sessions.
   *
   * @remarks Impure — network I/O via `AuthApiService` (cookie-credentialed
   * fetch, not `ApiService`). A non-array body (stale route serving SPA HTML)
   * is treated as unavailable, never as an empty list.
   */
  async loadSessions(): Promise<void> {
    this.sessionsLoading.set(true);
    this.sessionsUnavailable.set(false);
    const res = await this.authApi.listSessions();
    if (res.ok && Array.isArray(res.data)) {
      this.sessions.set(
        res.data.filter((r): r is AuthSession => !!r && typeof r === 'object' && typeof r.id === 'string'),
      );
    } else {
      this.sessions.set([]);
      this.sessionsUnavailable.set(true);
    }
    this.sessionsLoading.set(false);
  }

  /**
   * Revoke one Better Auth session (POST /api/auth/revoke-session).
   * Removes the row locally on success — no full refetch needed.
   */
  async revokeBaSession(s: AuthSession): Promise<void> {
    if (this.revokingIds().has(s.id)) return;
    this.revokingIds.update((set) => new Set(set).add(s.id));
    const res = await this.authApi.revokeSession({ token: s.token });
    this.revokingIds.update((set) => {
      const n = new Set(set);
      n.delete(s.id);
      return n;
    });
    if (res.ok) {
      this.sessions.update((list) => list.filter((x) => x.id !== s.id));
      this.toast.success('Session revoked');
    } else {
      this.toast.error('Could not revoke that session — retry shortly.');
    }
  }

  /** Human label parsed from the session's user agent, e.g. "Chrome · macOS". */
  deviceLabel(s: AuthSession): string {
    const ua = s.userAgent ?? '';
    const browser = /edg(?:e|a|ios)?\//i.test(ua)
      ? 'Edge'
      : /firefox|fxios/i.test(ua)
        ? 'Firefox'
        : /chrome|crios/i.test(ua)
          ? 'Chrome'
          : /safari/i.test(ua)
            ? 'Safari'
            : 'Unknown browser';
    const os = /iphone|ipad|ios/i.test(ua)
      ? 'iOS'
      : /android/i.test(ua)
        ? 'Android'
        : /mac os x|macintosh/i.test(ua)
          ? 'macOS'
          : /windows/i.test(ua)
            ? 'Windows'
            : /linux/i.test(ua)
              ? 'Linux'
              : 'Unknown OS';
    return `${browser} · ${os}`;
  }

  /** Locale-formatted session creation time; em dash when absent/invalid. */
  sessionTime(s: AuthSession): string {
    if (!s.createdAt) return '—';
    const d = new Date(s.createdAt);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  // ─────────────────── Two-factor enrollment entry point ───────────────────

  readonly twoFaOpen = signal(false);
  readonly twoFaBusy = signal(false);
  readonly twoFaError = signal<string | null>(null);
  /** Set once enable succeeds — holds the TOTP URI + one-time backup codes. */
  readonly twoFa = signal<TwoFactorEnableResult | null>(null);
  twoFaPassword = '';

  openTwoFa(): void {
    this.twoFaPassword = '';
    this.twoFaError.set(null);
    this.twoFa.set(null);
    this.twoFaOpen.set(true);
  }

  closeTwoFa(): void {
    this.twoFaOpen.set(false);
    this.twoFaPassword = '';
    this.twoFaError.set(null);
    this.twoFa.set(null);
    this.twoFaBusy.set(false);
  }

  onTwoFaPasswordInput(value: string): void {
    this.twoFaPassword = value;
    this.twoFaError.set(null);
  }

  /**
   * Step 1 of TOTP enrollment — confirm the password, receive the otpauth URI
   * + backup codes (POST /api/auth/two-factor/enable). Verification of the
   * 6-digit code happens at next sign-in, not here.
   */
  async beginTwoFaEnroll(): Promise<void> {
    const password = this.twoFaPassword.trim();
    if (!password || this.twoFaBusy()) return;
    this.twoFaBusy.set(true);
    this.twoFaError.set(null);
    const res = await this.authApi.enableTwoFactor({ password });
    this.twoFaBusy.set(false);
    if (res.ok && res.data?.totpURI) {
      this.twoFa.set(res.data);
    } else {
      this.twoFaError.set(
        res.ok ? 'Two-factor enrollment is not available yet.' : res.error,
      );
    }
  }
}
