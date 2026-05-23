import { Component, inject, signal, type OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';

/**
 * User-level settings — applies to the signed-in person, not the org or project.
 *
 * @remarks
 * Two surfaces live here:
 *
 * 1. **Theme** — `dark | light | system`. Persisted to localStorage under
 *    `ps_theme` and stamped on `<html>` immediately. The same key is read by
 *    `app.component.ts` on every page boot, so a refresh keeps the choice.
 * 2. **API keys** — programmatic access tokens for the projectsites.dev REST
 *    API. Users create their own here; the secret is only ever shown ONCE at
 *    create time. Backend endpoints `/api/admin/api-keys` (org-scoped, but the
 *    actor is the signed-in user). The same `psk_live_…` tokens authenticate
 *    via `Authorization: Bearer …`.
 *
 * @example
 * ```html
 * <a routerLink="/admin/user">User settings</a>
 * ```
 */
@Component({
  selector: 'app-user-settings',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <header>
        <h2 class="text-lg font-bold text-white m-0">User settings</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
          Preferences scoped to you — not the workspace. Signed in as
          <strong class="text-white">{{ auth.email() || '—' }}</strong>.
        </p>
      </header>

      <!-- ─────────────────── THEME ─────────────────── -->
      <section class="card">
        <h3 class="m-0 text-base font-semibold text-white mb-1">Theme</h3>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">
          Applies to your admin dashboard view (persisted per browser). System follows your OS appearance.
        </p>
        <div class="grid grid-cols-3 gap-3">
          @for (t of themes; track t.id) {
            <button class="theme-card"
                    [class.active]="themeChoice() === t.id"
                    (click)="setTheme(t.id)"
                    [attr.aria-pressed]="themeChoice() === t.id"
                    [attr.data-testid]="'theme-' + t.id">
              <div class="theme-swatch"
                   [class.dk]="t.id === 'dark'"
                   [class.lt]="t.id === 'light'"
                   [class.sy]="t.id === 'system'"></div>
              <div class="font-semibold text-white">{{ t.label }}</div>
              <div class="text-[0.7rem] text-text-secondary">{{ t.desc }}</div>
            </button>
          }
        </div>
      </section>

      <!-- ─────────────────── APPEARANCE ─────────────────── -->
      <section class="card">
        <h3 class="m-0 text-base font-semibold text-white mb-1">Appearance</h3>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">
          Tune the dashboard to your eyes — density, contrast, and motion. All persist per browser.
        </p>
        <div class="grid md:grid-cols-3 gap-3">
          <label class="block">
            <span class="muted-h">Density</span>
            <select class="input-field w-full mt-1" [ngModel]="density()" (ngModelChange)="setDensity($event)" data-testid="density-select">
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
            <span class="text-[0.62rem] text-text-secondary/60 mt-1 block">Affects card padding + row height app-wide.</span>
          </label>
          <label class="block">
            <span class="muted-h">High contrast</span>
            <div class="mt-1">
              <button class="toggle-btn"
                      [class.on]="highContrast()"
                      (click)="toggleHighContrast()"
                      [attr.aria-pressed]="highContrast()"
                      data-testid="contrast-toggle">
                <span class="toggle-dot"></span>
                {{ highContrast() ? 'On' : 'Off' }}
              </button>
            </div>
            <span class="text-[0.62rem] text-text-secondary/60 mt-1 block">Bolder text + amber focus rings for accessibility.</span>
          </label>
          <label class="block">
            <span class="muted-h">Cursor follower</span>
            <div class="mt-1">
              <button class="toggle-btn"
                      [class.on]="cursorFollower()"
                      (click)="toggleCursorFollower()"
                      [attr.aria-pressed]="cursorFollower()"
                      data-testid="cursor-toggle">
                <span class="toggle-dot"></span>
                {{ cursorFollower() ? 'On' : 'Off' }}
              </button>
            </div>
            <span class="text-[0.62rem] text-text-secondary/60 mt-1 block">Tiny floating ring that traces the cursor. Auto-off on touch.</span>
          </label>
        </div>
      </section>

      <!-- ─────────────────── API KEYS ─────────────────── -->
      <section class="card">
        <div class="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h3 class="m-0 text-base font-semibold text-white">API keys</h3>
            <p class="text-[0.7rem] text-text-secondary m-0 mt-0.5">
              Programmatic access to the projectsites.dev REST API. Send as
              <code class="font-mono">Authorization: Bearer &lt;key&gt;</code>.
              The secret is shown <strong>once</strong> — store it somewhere safe.
            </p>
          </div>
          <button class="btn-primary"
                  (click)="openCreateKey()"
                  data-testid="api-key-create"
                  title="Generate a new API key">+ Generate API key</button>
        </div>
        @if (showNewKey(); as nk) {
          <div class="card-light p-3 border border-emerald-500/40 mb-3">
            <div class="flex items-center justify-between gap-2 mb-1">
              <strong class="text-emerald-300 text-[0.78rem]">New key — copy now, never shown again</strong>
              <button class="text-text-secondary hover:text-white"
                      (click)="dismissNewKey()"
                      aria-label="Dismiss"
                      title="Dismiss">×</button>
            </div>
            <div class="flex items-center gap-2">
              <code class="flex-1 font-mono text-[0.78rem] text-white p-2 bg-black/40 rounded-lg overflow-x-auto whitespace-nowrap"
                    data-testid="api-key-secret">{{ nk.secret }}</code>
              <button class="btn-ghost" (click)="copyKey(nk.secret)" title="Copy secret to clipboard">Copy</button>
            </div>
            <div class="text-[0.66rem] text-text-secondary mt-1">
              {{ nk.name }} · expires {{ nk.expires_at ? (nk.expires_at | date:'mediumDate') : 'never' }}
            </div>
          </div>
        }
        @if (creatingKey()) {
          <div class="card-light p-3 mb-3">
            <div class="grid md:grid-cols-3 gap-2">
              <input class="input-field" placeholder="Key name (e.g. 'CI deploy')" [(ngModel)]="newKey.name" />
              <select class="input-field" [(ngModel)]="newKey.scope">
                <option value="read">read-only</option>
                <option value="write">read + write</option>
                <option value="admin">admin</option>
              </select>
              <select class="input-field" [(ngModel)]="newKey.expires">
                <option [ngValue]="0">Never expires</option>
                <option [ngValue]="30">30 days</option>
                <option [ngValue]="90">90 days</option>
                <option [ngValue]="365">1 year</option>
              </select>
            </div>
            <div class="flex justify-end gap-2 mt-2">
              <button class="btn-ghost" (click)="creatingKey.set(false)">Cancel</button>
              <button class="btn-primary"
                      (click)="generateKey()"
                      [disabled]="generatingKey()"
                      data-testid="api-key-generate"
                      title="Generate the secret now">{{ generatingKey() ? 'Generating…' : 'Generate' }}</button>
            </div>
          </div>
        }
        @if (loadingKeys() && apiKeys().length === 0) {
          <div class="space-y-2" aria-busy="true">
            @for (i of [1,2,3]; track i) {
              <div class="flex items-center gap-3 py-2 border-b border-white/[0.04]">
                <div class="skeleton h-4 w-32"></div>
                <div class="skeleton h-4 w-20"></div>
                <div class="skeleton h-4 w-24"></div>
                <div class="skeleton h-4 w-28"></div>
                <div class="flex-1"></div>
                <div class="skeleton h-4 w-14"></div>
              </div>
            }
          </div>
        } @else if (apiKeys().length === 0 && !creatingKey()) {
          <div class="empty-state">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <h4>No API keys yet</h4>
            <p>Generate a programmatic key to call the projectsites.dev REST API from CI, scripts, or external tools.</p>
            <button class="btn-primary" (click)="openCreateKey()" data-testid="api-key-empty-create" title="Generate your first API key">+ Generate your first key</button>
          </div>
        } @else {
          <table class="w-full text-[0.78rem]">
            <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
              <tr class="border-b border-white/[0.06]">
                <th class="text-left p-2 font-semibold">Name</th>
                <th class="text-left p-2 font-semibold">Prefix</th>
                <th class="text-left p-2 font-semibold">Scope</th>
                <th class="text-left p-2 font-semibold">Last used</th>
                <th class="text-left p-2 font-semibold">Expires</th>
                <th class="text-right p-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              @for (k of apiKeys(); track k.id) {
                <tr class="border-b border-white/[0.04]" [class.opacity-50]="!k.active">
                  <td class="p-2">{{ k.name }}</td>
                  <td class="p-2 font-mono text-[0.72rem]">{{ k.prefix }}…</td>
                  <td class="p-2"><span class="badge">{{ k.scopes?.join(' · ') || 'read · write' }}</span></td>
                  <td class="p-2 text-text-secondary">{{ k.last_used_at ? (k.last_used_at | date:'short') : 'never' }}</td>
                  <td class="p-2 text-text-secondary">{{ k.expires_at ? (k.expires_at | date:'mediumDate') : '—' }}</td>
                  <td class="p-2 text-right">
                    @if (k.active) {
                      <button class="text-red-400 text-[0.72rem]"
                              (click)="revokeKey(k)"
                              title="Revoke this key immediately">Revoke</button>
                    } @else {
                      <span class="text-[0.66rem] text-text-secondary/60">revoked</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; --accent: #00E5FF; }
    h2, h3 { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid color-mix(in oklch, var(--accent) 14%, transparent); border-radius: 14px; padding: 1.4rem; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02); transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease; }
    .card:hover { transform: translateY(-1px); border-color: color-mix(in oklch, var(--accent) 28%, transparent); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px -16px rgba(0,229,255,0.18); }
    .card-light { background: rgba(255,255,255,0.025); border: 1px solid color-mix(in oklch, var(--accent) 16%, transparent); border-radius: 12px; transition: transform 200ms ease, border-color 200ms ease; }
    .card-light:hover { transform: translateY(-1px); border-color: color-mix(in oklch, var(--accent) 30%, transparent); }
    .badge { font-size: 0.6rem; text-transform: uppercase; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(0,229,255,0.1); color: #00E5FF; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .input-field:focus { outline: none; border-color: rgba(0,229,255,0.45); }
    .btn-primary { padding: 0.5rem 1rem; border-radius: 8px; background: linear-gradient(135deg, #00ffc8, #00d4ff); color: #060610; font-weight: 700; border: 1px solid color-mix(in oklch, #00d4ff 40%, transparent); cursor: pointer; font-size: 0.78rem; transition: transform 200ms ease, box-shadow 200ms ease; }
    .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px -10px rgba(0,229,255,0.45); }
    .btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-ghost { padding: 0.45rem 0.95rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; transition: transform 200ms ease, border-color 200ms ease; }
    .btn-ghost:hover { transform: translateY(-1px); border-color: color-mix(in oklch, var(--accent) 30%, transparent); }
    .empty-state { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; padding: 2rem 1rem; text-align: center; }
    .empty-state .icon { width: 36px; height: 36px; opacity: 0.45; }
    .empty-state h4 { margin: 0; font-family: 'Sora', system-ui, sans-serif; font-weight: 600; color: rgba(255,255,255,0.85); font-size: 0.86rem; letter-spacing: -0.01em; }
    .empty-state p { margin: 0; font-size: 0.74rem; color: rgba(255,255,255,0.5); max-width: 32ch; }
    .skeleton { background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04)); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; border-radius: 8px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) {
      .card, .card-light, .btn-primary, .btn-ghost { transition: none; }
      .card:hover, .card-light:hover, .btn-primary:hover, .btn-ghost:hover { transform: none; box-shadow: none; }
      .skeleton { animation: none; background: rgba(255,255,255,0.06); }
    }
    @media (max-width: 640px) {
      .btn-primary, .btn-ghost { width: 100%; }
    }
    .theme-card { display: flex; flex-direction: column; align-items: flex-start; gap: 0.4rem; padding: 0.85rem; border-radius: 12px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: all 160ms ease; text-align: left; }
    .theme-card:hover { border-color: rgba(0,229,255,0.35); transform: translateY(-1px); }
    .theme-card.active { border-color: rgba(0,229,255,0.6); background: rgba(0,229,255,0.08); box-shadow: 0 0 0 3px rgba(0,229,255,0.12); }
    .theme-swatch { width: 100%; height: 44px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); }
    .theme-swatch.dk { background: linear-gradient(135deg, #06061a, #0a0a28); }
    .theme-swatch.lt { background: linear-gradient(135deg, #f8fafc, #cbd5e1); }
    .theme-swatch.sy { background: linear-gradient(135deg, #06061a 0 50%, #f8fafc 50% 100%); }
    .toggle-btn { display: inline-flex; align-items: center; gap: 8px; padding: 0.45rem 0.85rem; border-radius: 999px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.7); cursor: pointer; font-size: 0.74rem; font-weight: 600; transition: all 160ms ease; }
    .toggle-btn:hover { border-color: rgba(0,229,255,0.4); color: #fff; }
    .toggle-btn.on { background: rgba(0,229,255,0.12); color: #00E5FF; border-color: rgba(0,229,255,0.45); box-shadow: 0 0 0 3px rgba(0,229,255,0.1); }
    .toggle-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.3); transition: background 160ms ease; }
    .toggle-btn.on .toggle-dot { background: #00E5FF; box-shadow: 0 0 6px #00E5FF; }
  `],
})
export class AdminUserSettingsComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  // ── Theme ──
  readonly themes = [
    { id: 'dark',   label: 'Dark',   desc: 'High-contrast cinematic default' },
    { id: 'light',  label: 'Light',  desc: 'Daylight surface for bright rooms' },
    { id: 'system', label: 'System', desc: 'Follows your OS appearance setting' },
  ] as const;

  themeChoice = signal<'dark' | 'light' | 'system'>(((): 'dark' | 'light' | 'system' => {
    try { return (localStorage.getItem('ps_theme') as 'dark' | 'light' | 'system') || 'dark'; } catch { return 'dark'; }
  })());

  /**
   * Switch theme. Persists to localStorage AND stamps `<html data-theme>` so the
   * change applies immediately without a page reload.
   */
  setTheme(t: 'dark' | 'light' | 'system'): void {
    this.themeChoice.set(t);
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('ps_theme', t); } catch { /* private mode / quota */ }
    this.toast.info(`Theme: ${t}`);
  }

  // ── Appearance: density, contrast, cursor follower ──
  density = signal<'compact' | 'comfortable' | 'spacious'>(((): 'compact' | 'comfortable' | 'spacious' => {
    try { return (localStorage.getItem('ps_density') as 'compact' | 'comfortable' | 'spacious') || 'comfortable'; } catch { return 'comfortable'; }
  })());
  highContrast = signal<boolean>(((): boolean => {
    try { return localStorage.getItem('ps_contrast') === 'high'; } catch { return false; }
  })());
  cursorFollower = signal<boolean>(((): boolean => {
    try { return localStorage.getItem('ps_cursor') !== 'off'; } catch { return true; }
  })());

  /** Apply density immediately + persist; stamps `<html data-density>` for CSS vars. */
  setDensity(d: 'compact' | 'comfortable' | 'spacious'): void {
    this.density.set(d);
    document.documentElement.setAttribute('data-density', d);
    try { localStorage.setItem('ps_density', d); } catch { /* */ }
    this.toast.info(`Density: ${d}`);
  }

  /** Toggle WCAG-AAA-ish contrast. Stamps `<html data-contrast="high">`. */
  toggleHighContrast(): void {
    const next = !this.highContrast();
    this.highContrast.set(next);
    document.documentElement.setAttribute('data-contrast', next ? 'high' : 'normal');
    try { localStorage.setItem('ps_contrast', next ? 'high' : 'normal'); } catch { /* */ }
    this.toast.info(`High contrast ${next ? 'on' : 'off'}`);
  }

  /** Toggle the cursor-follower ring. Off persists across refresh. */
  toggleCursorFollower(): void {
    const next = !this.cursorFollower();
    this.cursorFollower.set(next);
    try { localStorage.setItem('ps_cursor', next ? 'on' : 'off'); } catch { /* */ }
    // Force-remove existing follower nodes so the change is immediate.
    if (!next) document.querySelectorAll('.cursor-follower').forEach((el) => el.remove());
    this.toast.info(`Cursor follower ${next ? 'on' : 'off'}`);
  }

  // ── API keys ──
  apiKeys = signal<{
    id: string;
    name: string;
    prefix: string;
    scopes: string[] | null;
    last_used_at: string | null;
    expires_at: string | null;
    active: boolean;
  }[]>([]);
  creatingKey = signal(false);
  generatingKey = signal(false);
  loadingKeys = signal(false);
  showNewKey = signal<{ name: string; secret: string; expires_at: string | null } | null>(null);
  newKey: { name: string; scope: 'read' | 'write' | 'admin'; expires: number } = { name: '', scope: 'write', expires: 90 };

  ngOnInit(): void {
    this.loadApiKeys();
  }

  openCreateKey(): void {
    this.creatingKey.set(true);
    this.newKey = { name: '', scope: 'write', expires: 90 };
  }

  loadApiKeys(): void {
    type ApiKeyRow = {
      id: string;
      name: string;
      prefix: string;
      scopes: string[] | null;
      last_used_at: string | null;
      expires_at: string | null;
      active: boolean;
    };
    this.loadingKeys.set(true);
    this.api.get<{ data: ApiKeyRow[] }>('/admin/api-keys').subscribe({
      next: (r) => { this.apiKeys.set(r.data ?? []); this.loadingKeys.set(false); },
      error: () => { this.apiKeys.set([]); this.loadingKeys.set(false); /* api.service already toasted */ },
    });
  }

  generateKey(): void {
    if (!this.newKey.name.trim()) { this.toast.error('Give the key a name'); return; }
    this.generatingKey.set(true);
    const scopes = this.newKey.scope === 'admin' ? ['read', 'write', 'admin']
      : this.newKey.scope === 'write' ? ['read', 'write']
      : ['read'];
    this.api.post<{ data: { name: string; secret: string; expires_at: string | null } }>('/admin/api-keys', {
      name: this.newKey.name.trim(),
      scopes,
      expires_in_days: this.newKey.expires || undefined,
    }).subscribe({
      next: (r) => {
        this.generatingKey.set(false);
        this.creatingKey.set(false);
        this.showNewKey.set({ name: r.data.name, secret: r.data.secret, expires_at: r.data.expires_at });
        this.toast.success('Saved — copy your new key now (shown once)');
        this.loadApiKeys();
      },
      error: () => { this.generatingKey.set(false); /* api.service already toasted */ },
    });
  }

  /** Copy API key to clipboard. Surface a friendly toast on clipboard-permission failure. */
  async copyKey(secret: string): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(secret);
      this.toast.success('Copied to clipboard');
    } catch (err) {
      console.warn('[user-settings] copy failed', err);
      this.toast.error('Could not copy. Select the text and press Cmd/Ctrl+C.');
    }
  }

  dismissNewKey(): void {
    this.showNewKey.set(null);
  }

  revokeKey(k: { id: string; name: string }): void {
    if (!confirm(`Revoke "${k.name}"? Any client using it will start receiving 401.`)) return;
    this.api.delete(`/admin/api-keys/${k.id}`).subscribe({
      next: () => { this.toast.success('Key revoked'); this.loadApiKeys(); },
      error: () => { /* api.service already toasted */ },
    });
  }
}
