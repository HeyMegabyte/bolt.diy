import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';
import { DialogShellComponent } from '../../../components/dialog-shell/dialog-shell.component';

/** Row shape returned by `GET /admin/api-keys` and rendered in the keys table. */
interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[] | null;
  last_used_at: string | null;
  expires_at: string | null;
  active: boolean;
}

/** Payload returned by `POST /admin/api-keys` — secret is the one-time reveal. */
interface ApiKeyCreateResponse {
  id?: string;
  name: string;
  secret: string;
  prefix?: string;
  scopes?: string[] | null;
  expires_at: string | null;
}

/**
 * User-level settings — applies to the signed-in person, not the org or project.
 *
 * @remarks
 * Two surfaces live here:
 *
 * 1. **Theme** — `dark | light | system`. Persisted to localStorage under
 *    `ps_theme` and stamped on `<html data-theme>` immediately. The same key
 *    is read by `app.component.ts` on every page boot, so a refresh keeps
 *    the choice. Toast wording is the explicit "Theme changed to {x}" copy
 *    so the change is unambiguous when the visual diff is subtle.
 * 2. **API keys** — programmatic access tokens for the projectsites.dev REST
 *    API. Users create their own here via the standardized `DialogShell`
 *    modal; the secret is only ever shown ONCE at create time inside the
 *    modal's success step. Backend endpoints `/api/admin/api-keys` (org-scoped,
 *    but the actor is the signed-in user). The same `psk_live_…` tokens
 *    authenticate via `Authorization: Bearer …`.
 *
 * Appearance options (density, bolder-text, amber focus rings, cursor follower)
 * were removed in Turn 3 — only the theme picker remains as a visual control.
 *
 * @example
 * ```html
 * <a routerLink="/admin/user">User settings</a>
 * ```
 */
@Component({
  selector: 'app-user-settings',
  standalone: true,
  imports: [FormsModule, DatePipe, DialogShellComponent],
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
                  data-testid="apikey-create-button"
                  title="Open the create-API-key dialog">+ Generate API key</button>
        </div>

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
        } @else if (apiKeys().length === 0) {
          <div class="empty-state">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <h4>No API keys yet</h4>
            <p>Generate a programmatic key to call the projectsites.dev REST API from CI, scripts, or external tools.</p>
            <button class="btn-primary" (click)="openCreateKey()" data-testid="apikey-empty-create" title="Open the create-API-key dialog">+ Generate your first key</button>
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
                <tr class="border-b border-white/[0.04]" [class.opacity-50]="!k.active" [attr.data-testid]="'apikey-row-' + k.id">
                  <td class="p-2">{{ k.name }}</td>
                  <td class="p-2 font-mono text-[0.72rem]">{{ k.prefix }}…</td>
                  <td class="p-2"><span class="badge">{{ k.scopes?.join(' · ') || 'read · write' }}</span></td>
                  <td class="p-2 text-text-secondary">{{ k.last_used_at ? (k.last_used_at | date:'short') : 'never' }}</td>
                  <td class="p-2 text-text-secondary">{{ k.expires_at ? (k.expires_at | date:'mediumDate') : '—' }}</td>
                  <td class="p-2 text-right">
                    @if (k.active) {
                      <button class="text-red-400 text-[0.72rem]"
                              (click)="revokeKey(k)"
                              [attr.data-testid]="'apikey-revoke-' + k.id"
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

      <!-- ─────────────────── CREATE API KEY MODAL ─────────────────── -->
      @if (createOpen()) {
        <app-dialog-shell (closed)="closeCreateDialog()">
          <span dialogIcon>
            <svg class="text-primary" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          </span>
          <span dialogTitle>{{ newSecret() ? 'API key created' : 'Generate API key' }}</span>

          <!-- Step 1: name + expiration form -->
          @if (!newSecret()) {
            <div class="p-5 flex flex-col gap-4">
              <label class="block">
                <div class="flex items-baseline justify-between mb-1">
                  <span class="muted-h">Name</span>
                  <span class="char-counter" [class.char-counter--full]="nameLen() >= 40">{{ nameLen() }}/40</span>
                </div>
                <input
                  type="text"
                  placeholder="CI deploy, local dev, prod backup"
                  [ngModel]="newKey.name"
                  (ngModelChange)="newKey.name = $event"
                  class="input-field w-full"
                  maxlength="40"
                  [attr.aria-invalid]="!!nameError()"
                  aria-describedby="apikey-name-error"
                  data-testid="apikey-modal-name"
                  autofocus />
                @if (nameError(); as err) {
                  <p id="apikey-name-error" class="apikey-error" role="alert" aria-live="polite">{{ err }}</p>
                }
              </label>

              <label class="block">
                <span class="muted-h">Expiration</span>
                <select
                  class="input-field w-full mt-1"
                  [ngModel]="newKey.expires"
                  (ngModelChange)="newKey.expires = +$event"
                  data-testid="apikey-modal-expiration">
                  <option [ngValue]="30">30 days</option>
                  <option [ngValue]="90">90 days</option>
                  <option [ngValue]="365">1 year</option>
                  <!-- 5-year option (Turn 4): 1825 days = 5 × 365. Placed
                       between "1 year" and "Never" so the cadence reads
                       30d → 90d → 1y → 5y → Never (longest finite first). -->
                  <option [ngValue]="1825" data-testid="apikey-modal-exp-5y">5 years</option>
                  <option [ngValue]="0">Never</option>
                </select>
                <span class="text-[0.62rem] text-text-secondary/60 mt-1 block">Keys can be revoked at any time from the table above.</span>
              </label>

              @if (createError(); as err) {
                <p class="apikey-error" role="alert" aria-live="assertive" data-testid="apikey-modal-error">{{ err }}</p>
              }
            </div>

            <div dialogFooter class="px-5 py-4 border-t border-white/[0.06] flex items-center justify-end gap-2">
              <button class="btn-ghost" type="button" (click)="closeCreateDialog()" [disabled]="generatingKey()" data-testid="apikey-modal-cancel">Cancel</button>
              <button
                class="btn-primary"
                type="button"
                [disabled]="generatingKey() || !canCreate()"
                data-testid="apikey-modal-submit"
                (click)="generateKey()">
                {{ generatingKey() ? 'Generating…' : 'Generate' }}
              </button>
            </div>
          }

          <!-- Step 2: one-time secret reveal -->
          @if (newSecret(); as nk) {
            <div class="p-5 flex flex-col gap-3">
              <div class="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.06] p-3">
                <strong class="text-emerald-300 text-[0.78rem] block mb-1">Copy now — this secret is never shown again.</strong>
                <span class="text-[0.7rem] text-text-secondary">Store it in your password manager, CI secret store, or a sealed env vault before closing.</span>
              </div>
              <div class="flex items-center gap-2">
                <code class="flex-1 font-mono text-[0.78rem] text-white p-2 bg-black/40 rounded-lg overflow-x-auto whitespace-nowrap border border-white/[0.06]"
                      data-testid="apikey-modal-secret">{{ nk.secret }}</code>
                <button class="btn-ghost" type="button" (click)="copyKey(nk.secret)" data-testid="apikey-modal-copy-secret" title="Copy secret to clipboard">Copy</button>
              </div>
              <div class="text-[0.66rem] text-text-secondary">
                {{ nk.name }} · expires {{ nk.expires_at ? (nk.expires_at | date:'mediumDate') : 'never' }}
              </div>
            </div>

            <div dialogFooter class="px-5 py-4 border-t border-white/[0.06] flex items-center justify-end gap-2">
              <button
                class="btn-primary"
                type="button"
                data-testid="apikey-modal-saved"
                (click)="acknowledgeNewKey()">
                I've saved my key
              </button>
            </div>
          }
        </app-dialog-shell>
      }
    </div>
  `,
  styles: [`
    :host { display: block; --accent: #00E5FF; }
    h2, h3 { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid color-mix(in oklch, var(--accent) 14%, transparent); border-radius: 14px; padding: 1.4rem; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02); transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease; }
    .card:hover { transform: translateY(-1px); border-color: color-mix(in oklch, var(--accent) 28%, transparent); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px -16px rgba(0,229,255,0.18); }
    .badge { font-size: 0.6rem; text-transform: uppercase; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(0,229,255,0.1); color: #00E5FF; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .input-field:focus { outline: none; border-color: rgba(0,229,255,0.45); }
    .input-field[aria-invalid="true"] { border-color: oklch(0.78 0.18 25 / 0.75); }

    /* Translucent primary button to match the sleek dark aesthetic — no bright teal slab. */
    .btn-primary {
      padding: 0.5rem 1rem; border-radius: 8px;
      background: linear-gradient(135deg, rgba(0,229,255,0.16), rgba(124,58,237,0.16));
      color: #00E5FF;
      font-weight: 600; border: 1px solid rgba(0,229,255,0.35);
      cursor: pointer; font-size: 0.78rem;
      transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease, background 200ms ease;
    }
    .btn-primary:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: rgba(0,229,255,0.55);
      background: linear-gradient(135deg, rgba(0,229,255,0.22), rgba(124,58,237,0.22));
      box-shadow: 0 8px 24px -10px rgba(0,229,255,0.35);
    }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-ghost { padding: 0.45rem 0.95rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.75); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; transition: transform 200ms ease, border-color 200ms ease; }
    .btn-ghost:hover:not(:disabled) { transform: translateY(-1px); border-color: color-mix(in oklch, var(--accent) 30%, transparent); color: #fff; }
    .btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

    .empty-state { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; padding: 2rem 1rem; text-align: center; }
    .empty-state .icon { width: 36px; height: 36px; opacity: 0.45; }
    .empty-state h4 { margin: 0; font-family: 'Sora', system-ui, sans-serif; font-weight: 600; color: rgba(255,255,255,0.85); font-size: 0.86rem; letter-spacing: -0.01em; }
    .empty-state p { margin: 0; font-size: 0.74rem; color: rgba(255,255,255,0.5); max-width: 32ch; }

    .skeleton { background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04)); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; border-radius: 8px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .theme-card { display: flex; flex-direction: column; align-items: flex-start; gap: 0.4rem; padding: 0.85rem; border-radius: 12px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: all 160ms ease; text-align: left; }
    .theme-card:hover { border-color: rgba(0,229,255,0.35); transform: translateY(-1px); }
    .theme-card.active { border-color: rgba(0,229,255,0.6); background: rgba(0,229,255,0.08); box-shadow: 0 0 0 3px rgba(0,229,255,0.12); }
    .theme-swatch { width: 100%; height: 44px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); }
    .theme-swatch.dk { background: linear-gradient(135deg, #06061a, #0a0a28); }
    .theme-swatch.lt { background: linear-gradient(135deg, #f8fafc, #cbd5e1); }
    .theme-swatch.sy { background: linear-gradient(135deg, #06061a 0 50%, #f8fafc 50% 100%); }

    /* Shared modal helpers — mirrors snapshots.component for visual consistency. */
    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }
    .char-counter { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.65rem; color: rgba(255,255,255,0.5); letter-spacing: 0.02em; }
    .char-counter--full { color: oklch(0.78 0.18 25); }
    .apikey-error { margin: 6px 0 0; font-size: 0.72rem; color: oklch(0.78 0.18 25); line-height: 1.35; }

    @media (prefers-reduced-motion: reduce) {
      .card, .btn-primary, .btn-ghost, .theme-card { transition: none; }
      .card:hover, .btn-primary:hover, .btn-ghost:hover, .theme-card:hover { transform: none; box-shadow: none; }
      .skeleton { animation: none; background: rgba(255,255,255,0.06); }
    }
    @media (max-width: 640px) {
      .btn-primary, .btn-ghost { width: 100%; }
    }
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
   * change applies immediately without a page reload. Toast wording is the
   * explicit "Theme changed to {x}" copy so the change is unambiguous when the
   * visual diff is subtle (e.g., system following the OS already-correct theme).
   *
   * If `[data-theme="light"]` styles are missing from `_polish.scss`, the
   * attribute still lands on the DOM — surface the missing polish pass as a
   * deferred item in the changelog rather than editing styles from here.
   */
  setTheme(t: 'dark' | 'light' | 'system'): void {
    this.themeChoice.set(t);
    try { document.documentElement.setAttribute('data-theme', t); } catch { /* SSR */ }
    try { localStorage.setItem('ps_theme', t); } catch { /* private mode / quota */ }
    const msg = t === 'system' ? 'Theme set to system' : `Theme changed to ${t}`;
    this.toast.info(msg);
  }

  // ── API keys ──
  apiKeys = signal<ApiKeyRow[]>([]);
  loadingKeys = signal(false);
  createOpen = signal(false);
  generatingKey = signal(false);
  createError = signal<string | null>(null);
  /** The just-created secret + metadata for the modal's reveal step. Cleared on modal close. */
  newSecret = signal<{ name: string; secret: string; expires_at: string | null } | null>(null);
  newKey: { name: string; expires: number } = { name: '', expires: 90 };

  /** Live counter for the name field — caps at 40 per spec. */
  nameLen = computed(() => this.newKey.name.length);

  ngOnInit(): void {
    this.loadApiKeys();
  }

  /**
   * Open the create-API-key dialog. Resets the draft + any prior reveal/error
   * state so reopening after a successful create lands on the empty form.
   */
  openCreateKey(): void {
    this.newKey = { name: '', expires: 90 };
    this.newSecret.set(null);
    this.createError.set(null);
    this.createOpen.set(true);
  }

  /**
   * Close the modal. Refuses to close mid-request to avoid orphaning the
   * secret (the POST may still succeed and the user would never see it).
   * Wipes the secret state on close — the table row already carries the
   * non-secret metadata, and the secret must never persist past dismissal.
   */
  closeCreateDialog(): void {
    if (this.generatingKey()) return;
    this.createOpen.set(false);
    this.newKey = { name: '', expires: 90 };
    this.newSecret.set(null);
    this.createError.set(null);
  }

  /**
   * Validate the key name. Returns null when valid, else a user-safe error
   * rendered inline + announced via aria-live. Plain method (not `computed()`)
   * because `newKey.name` is a non-signal field — memoizing here would let
   * the error go stale between keystrokes.
   */
  nameError(): string | null {
    const raw = this.newKey.name.trim();
    if (raw.length === 0) return null;
    if (raw.length > 40) return 'Name must be 40 characters or fewer.';
    const lowered = raw.toLowerCase();
    const dup = this.apiKeys().some((k) => (k.name ?? '').trim().toLowerCase() === lowered);
    if (dup) return 'An API key with this name already exists.';
    return null;
  }

  /** Submit enabled only when there's a name AND no validation error. */
  canCreate(): boolean {
    return this.newKey.name.trim().length > 0 && this.nameError() === null;
  }

  /** Acknowledge step — user confirms they've saved the secret, modal closes. */
  acknowledgeNewKey(): void {
    this.createOpen.set(false);
    this.newSecret.set(null);
    this.newKey = { name: '', expires: 90 };
    this.createError.set(null);
  }

  loadApiKeys(): void {
    this.loadingKeys.set(true);
    this.api.get<{ data: ApiKeyRow[] }>('/admin/api-keys').subscribe({
      next: (r) => { this.apiKeys.set(r.data ?? []); this.loadingKeys.set(false); },
      error: () => { this.apiKeys.set([]); this.loadingKeys.set(false); /* api.service already toasted */ },
    });
  }

  generateKey(): void {
    if (!this.canCreate()) return;
    this.generatingKey.set(true);
    this.createError.set(null);
    // Backend currently scopes new keys to read+write; admin scope is granted
    // separately by an org owner. Keep the default here and surface scope
    // management in a dedicated future settings card.
    const scopes = ['read', 'write'];
    this.api.post<{ data: ApiKeyCreateResponse }>('/admin/api-keys', {
      name: this.newKey.name.trim(),
      scopes,
      expires_in_days: this.newKey.expires || undefined,
    }).subscribe({
      next: (r) => {
        this.generatingKey.set(false);
        const created = r.data;
        // Optimistic table update — append the new row immediately so the
        // user sees their key listed before the dialog even closes. The
        // server response carries enough metadata to render a row; if
        // anything is missing we synthesize sensible defaults.
        const optimisticRow: ApiKeyRow = {
          id: created.id ?? `temp-${Date.now()}`,
          name: created.name,
          prefix: created.prefix ?? created.secret.slice(0, 12),
          scopes: created.scopes ?? scopes,
          last_used_at: null,
          expires_at: created.expires_at,
          active: true,
        };
        this.apiKeys.update((rows) => [optimisticRow, ...rows]);
        this.newSecret.set({ name: created.name, secret: created.secret, expires_at: created.expires_at });
        this.toast.success('API key generated — copy your secret now');
        // Reload in the background to reconcile real IDs/prefixes from the server.
        this.loadApiKeys();
      },
      error: (err) => {
        this.generatingKey.set(false);
        const msg = err?.error?.error?.message || err?.error?.message || 'Could not generate API key. Try again.';
        this.createError.set(msg);
        // Modal stays open per spec — inline aria-live error carries the message.
      },
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

  revokeKey(k: { id: string; name: string }): void {
    if (!confirm(`Revoke "${k.name}"? Any client using it will start receiving 401.`)) return;
    this.api.delete(`/admin/api-keys/${k.id}`).subscribe({
      next: () => { this.toast.success('Key revoked'); this.loadApiKeys(); },
      error: () => { /* api.service already toasted */ },
    });
  }
}
