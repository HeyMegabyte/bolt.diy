import { Component, signal, inject, type OnInit } from '@angular/core';
import { AuthApiService, type AuthSession } from './auth-api.service';

/**
 * Active-session manager — lists every live Better Auth session for the signed-in
 * user with its IP, device/user-agent, and creation time, and lets the user
 * revoke any single session or sign out of every other device at once.
 *
 * @remarks
 * Self-contained: only {@link AuthApiService}. Each revoke carries its own busy
 * guard keyed by session token so one in-flight revoke never blocks the others.
 * Brand dark theme, AA contrast, 44px targets, reduced-motion safe.
 */
@Component({
  selector: 'app-session-management',
  standalone: true,
  template: `
    <section
      class="mx-auto w-full max-w-2xl px-4 py-8 text-white"
      aria-labelledby="sessions-heading"
      data-testid="session-management"
    >
      <header class="mb-5 flex items-start justify-between gap-4 max-md:flex-col">
        <div>
          <h1 id="sessions-heading" class="text-xl font-extrabold tracking-tight m-0">
            Active sessions
          </h1>
          <p class="text-[0.82rem] text-text-secondary mt-1 mb-0">
            Devices currently signed in to your account.
          </p>
        </div>
        <button
          type="button"
          (click)="signOutEverywhere()"
          [disabled]="everywhereBusy()"
          data-testid="sessions-sign-out-everywhere"
          class="min-h-[44px] rounded-lg border border-red-500/30 bg-red-500/10 px-4 text-[0.82rem] font-semibold text-red-300 transition-colors hover:bg-red-500/20 focus-visible:ring-2 focus-visible:ring-red-500/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {{ everywhereBusy() ? 'Signing out…' : 'Sign out everywhere' }}
        </button>
      </header>

      @if (error()) {
        <div
          class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[0.82rem] text-red-300"
          role="alert"
          data-testid="sessions-error"
        >
          {{ error() }}
        </div>
      }

      @if (loading()) {
        <p class="text-[0.85rem] text-text-secondary" data-testid="sessions-loading" role="status">
          Loading sessions…
        </p>
      } @else if (sessions().length === 0) {
        <p class="text-[0.85rem] text-text-secondary" data-testid="sessions-empty">
          No active sessions found.
        </p>
      } @else {
        <ul class="flex flex-col gap-3 list-none p-0 m-0" data-testid="sessions-list">
          @for (s of sessions(); track s.token) {
            <li
              class="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-dark-card p-4 max-md:flex-col max-md:items-stretch"
              data-testid="session-row"
            >
              <div class="min-w-0">
                <p class="m-0 text-[0.85rem] font-semibold truncate" [attr.title]="s.userAgent || 'Unknown device'">
                  {{ s.userAgent || 'Unknown device' }}
                </p>
                <p class="m-0 mt-1 text-[0.75rem] text-text-secondary">
                  <span data-testid="session-ip">{{ s.ipAddress || 'IP unknown' }}</span>
                  <span aria-hidden="true"> · </span>
                  <span data-testid="session-created">{{ formatDate(s.createdAt) }}</span>
                </p>
              </div>
              <button
                type="button"
                (click)="revoke(s)"
                [disabled]="isRevoking(s.token)"
                [attr.aria-label]="'Revoke session on ' + (s.userAgent || 'unknown device')"
                data-testid="session-revoke"
                class="min-h-[44px] shrink-0 rounded-lg border border-white/[0.12] px-3.5 text-[0.8rem] font-semibold text-white transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {{ isRevoking(s.token) ? 'Revoking…' : 'Revoke' }}
              </button>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class SessionManagementComponent implements OnInit {
  private readonly authApi = inject(AuthApiService);

  readonly sessions = signal<AuthSession[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly everywhereBusy = signal(false);
  private readonly revoking = signal<Set<string>>(new Set());

  ngOnInit(): void {
    void this.load();
  }

  /** Fetch the active session list. */
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const res = await this.authApi.listSessions();
    this.loading.set(false);
    if (res.ok) {
      this.sessions.set(Array.isArray(res.data) ? res.data : []);
    } else {
      this.error.set(res.error);
      this.sessions.set([]);
    }
  }

  /** True while the given session token has a revoke in flight. */
  isRevoking(token: string): boolean {
    return this.revoking().has(token);
  }

  /** Revoke a single session, then drop it from the list on success. */
  async revoke(session: AuthSession): Promise<void> {
    if (this.isRevoking(session.token)) return;
    this.error.set(null);
    this.revoking.update((s) => new Set(s).add(session.token));

    const res = await this.authApi.revokeSession({ token: session.token });

    this.revoking.update((s) => {
      const next = new Set(s);
      next.delete(session.token);
      return next;
    });

    if (res.ok) {
      this.sessions.update((list) => list.filter((x) => x.token !== session.token));
    } else {
      this.error.set(res.error);
    }
  }

  /** Revoke every other session — sign out everywhere else, then reload. */
  async signOutEverywhere(): Promise<void> {
    if (this.everywhereBusy()) return;
    this.error.set(null);
    this.everywhereBusy.set(true);
    const res = await this.authApi.revokeOtherSessions();
    this.everywhereBusy.set(false);
    if (res.ok) {
      await this.load();
    } else {
      this.error.set(res.error);
    }
  }

  /** Render an ISO timestamp as a friendly local date, falling back gracefully. */
  formatDate(value?: string): string {
    if (!value) return 'Date unknown';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Date unknown';
    return d.toLocaleString();
  }
}
