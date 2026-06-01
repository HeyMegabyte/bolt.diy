import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, type CloudflareCredentialStatus } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';
import { DialogShellComponent } from '../../../components/dialog-shell/dialog-shell.component';
import { HlmInputDirective, HlmSelectDirective } from '../../../ui';
import { RevealDirective } from '../../../directives/reveal.directive';

/** Row shape returned by `GET /admin/api-keys` and rendered in the keys table. */
interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[] | null;
  last_used_at: string | null;
  expires_at: string | null;
  rotated_at?: string | null;
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

/** Row shape for the active sessions table. */
interface SessionRow {
  id: string;
  device?: string;
  browser?: string;
  os?: string;
  ip?: string;
  location?: string;
  last_active_at?: string;
  created_at?: string;
  current?: boolean;
}

/** Grouped notification preferences. */
interface NotificationPref {
  id: string;
  label: string;
  desc: string;
  enabled: boolean;
}
interface NotificationGroup {
  id: string;
  label: string;
  prefs: NotificationPref[];
}

/**
 * User-level settings — applies to the signed-in person, not the org or project.
 *
 * @remarks
 * Surfaces:
 *
 * 1. **Profile** — avatar, name/email, role pill (read-only summary).
 * 2. **Theme** — `dark | light | system`. Persisted to `ps_theme`.
 * 3. **API keys** — create + reveal-once + copy + rotate-from-modal + revoke.
 *    Stored under `/api/admin/api-keys`. Secret only ever shown ONCE.
 * 4. **Sessions** — device list with last-active + revoke per row + revoke-all.
 * 5. **Notifications** — grouped toggles (product, security, billing) persisted
 *    locally and synced to `/api/admin/notifications` when the endpoint exists.
 * 6. **Danger zone** — account delete with confirm modal.
 *
 * @example
 * ```html
 * <a routerLink="/admin/user">User settings</a>
 * ```
 */
@Component({
  selector: 'app-user-settings',
  standalone: true,
  imports: [RevealDirective, FormsModule, DatePipe, DialogShellComponent, HlmInputDirective, HlmSelectDirective],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <!-- ─────────────────── HEADER ─────────────────── -->
      <header>
        <div class="kicker">You</div>
        <h2 class="section-h text-lg font-bold text-white m-0 mt-1 flex items-center gap-2">
          User settings
        </h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1 max-w-prose leading-relaxed">
          Preferences scoped to you — not the workspace. Signed in as
          <strong class="text-white">{{ auth.email() || '—' }}</strong>.
        </p>
      </header>

      <!-- ─────────────────── PROFILE ─────────────────── -->
      <section class="card" appReveal>
        <div class="flex items-start gap-4 flex-wrap">
          <div class="profile-avatar" [attr.aria-label]="'Avatar for ' + (auth.email() || 'you')">
            <span>{{ initials() }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <h3 class="section-h m-0 text-base font-semibold text-white truncate">{{ displayName() }}</h3>
              <span class="role-pill" title="Your role on this workspace">{{ roleLabel() }}</span>
            </div>
            <p class="text-[0.74rem] text-text-secondary m-0 break-all">{{ auth.email() || '—' }}</p>
            <p class="text-[0.66rem] text-text-secondary/70 m-0 mt-2">
              Account ID: <code class="font-mono text-[0.7rem]">{{ shortId() }}</code>
            </p>
          </div>
        </div>
      </section>

      <!-- ─────────────────── THEME ─────────────────── -->
      <section class="card" appReveal>
        <div class="kicker">Appearance</div>
        <h3 class="section-h m-0 text-base font-semibold text-white mt-1 mb-1">Theme</h3>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">
          Applies to your admin dashboard view (persisted per browser). System follows your OS appearance.
        </p>
        <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          @for (t of themes; track t.id) {
            <button class="theme-card"
                    type="button"
                    [class.active]="themeChoice() === t.id"
                    (click)="setTheme(t.id)"
                    [attr.aria-pressed]="themeChoice() === t.id"
                    [attr.data-testid]="'theme-' + t.id"
                    [attr.aria-label]="'Use ' + t.label + ' theme'">
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

      <!-- ─────────────────── CLOUDFLARE CREDENTIALS ─────────────────── -->
      <section class="card" [attr.data-focus]="focusCf() ? 'cloudflare' : null" data-testid="cf-credentials-card">
        <div class="flex items-start justify-between gap-3 mb-2 flex-wrap">
          <div>
            <div class="kicker">Analytics source</div>
            <h3 class="section-h m-0 text-base font-semibold text-white mt-1 flex items-center gap-2">
              Cloudflare credentials
              <span class="status-pill"
                    [class.is-active]="credStatus()?.has_credentials"
                    [class.is-revoked]="!credStatus()?.has_credentials"
                    [title]="credBadgeTitle()">
                {{ credStatus()?.has_credentials ? 'Connected' : 'Not connected' }}
              </span>
            </h3>
            <p class="text-[0.72rem] text-text-secondary m-0 mt-1 max-w-prose leading-relaxed">
              Power per-site analytics with your Cloudflare global API key. We aggregate edge traffic across every URL bound to each site —
              <strong class="text-white">{{ credSourceLabel() }}</strong>.
              @if (credStatus()?.last_validated_at) {
                <span class="block mt-1 text-[0.66rem] text-text-secondary/70">
                  Last validated {{ credStatus()!.last_validated_at | date:'medium' }}
                  @if (credStatus()?.last_validated_account_id) {
                    · account <code class="font-mono">{{ shortCfAccount() }}</code>
                  }
                </span>
              }
            </p>
          </div>
          <div class="flex gap-2 flex-wrap">
            @if (credStatus()?.has_credentials && credStatus()?.source === 'org') {
              <button class="btn-ghost"
                      type="button"
                      (click)="validateCf()"
                      [disabled]="validatingCf()"
                      data-testid="cf-validate-button"
                      aria-label="Re-validate stored Cloudflare credentials"
                      title="Ping Cloudflare /zones to confirm the key still works">
                {{ validatingCf() ? 'Validating…' : 'Validate now' }}
              </button>
              <button class="btn-tiny-danger"
                      type="button"
                      (click)="disconnectCf()"
                      data-testid="cf-disconnect-button"
                      aria-label="Remove stored Cloudflare credentials">Disconnect</button>
            }
            <button class="btn-primary"
                    type="button"
                    (click)="openCfDialog()"
                    data-testid="cf-update-button"
                    aria-label="Update Cloudflare credentials"
                    title="Open the credential editor">
              {{ credStatus()?.source === 'org' ? 'Update credentials' : 'Connect Cloudflare' }}
            </button>
          </div>
        </div>
        <p class="text-[0.66rem] text-text-secondary/70 m-0 mt-2 max-w-prose">
          Generate a key at
          <a class="text-link"
             href="https://dash.cloudflare.com/profile/api-tokens"
             target="_blank"
             rel="noopener noreferrer">dash.cloudflare.com/profile/api-tokens</a> →
          "API Keys" → "Global API Key". This is the same credential pair (<code class="font-mono">CLOUDFLARE_API_KEY</code> + <code class="font-mono">CLOUDFLARE_EMAIL</code>) Wrangler uses for deploys.
        </p>
      </section>

      <!-- ─────────────────── API KEYS ─────────────────── -->
      <section class="card" appReveal>
        <div class="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <div class="kicker">Programmatic access</div>
            <h3 class="section-h m-0 text-base font-semibold text-white mt-1">
              API keys
              @if (activeKeyCount() > 0) {
                <span class="header-pill" aria-label="Active keys">
                  <span class="header-pill-dot" aria-hidden="true"></span>
                  {{ activeKeyCount() }} active
                </span>
              }
            </h3>
            <p class="text-[0.7rem] text-text-secondary m-0 mt-1 max-w-prose">
              Send as <code class="font-mono">Authorization: Bearer &lt;key&gt;</code>.
              The secret is shown <strong>once</strong> — store it in a password manager.
            </p>
          </div>
          <button class="btn-primary"
                  type="button"
                  (click)="openCreateKey()"
                  data-testid="apikey-create-button"
                  aria-label="Generate a new API key"
                  title="Open the create-API-key dialog">+ Generate API key</button>
        </div>

        @if (loadingKeys() && apiKeys().length === 0) {
          <div class="space-y-2" aria-busy="true" aria-label="Loading API keys">
            @for (i of [1,2,3]; track i) {
              <div class="flex items-center gap-3 py-2 border-b border-white/[0.04]">
                <div class="skel h-4 w-32 rounded"></div>
                <div class="skel h-4 w-20 rounded"></div>
                <div class="skel h-4 w-24 rounded"></div>
                <div class="skel h-4 w-28 rounded"></div>
                <div class="flex-1"></div>
                <div class="skel h-4 w-14 rounded"></div>
              </div>
            }
          </div>
        } @else if (keysError()) {
          <div class="error-tile" role="alert">
            <div>
              <strong>Couldn't load your keys.</strong>
              <span class="block text-[0.72rem] mt-0.5">{{ keysError() }}</span>
            </div>
            <button class="btn-ghost" type="button" (click)="loadApiKeys()">Retry</button>
          </div>
        } @else if (apiKeys().length === 0) {
          <div class="empty-state-pretty">
            <div class="empty-glyph" aria-hidden="true">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg>
            </div>
            <h4 class="glow-h-grad text-lg font-semibold m-0">No API keys yet</h4>
            <p class="text-[0.82rem] text-text-secondary max-w-[420px] mx-auto m-0 leading-relaxed">
              Generate a programmatic key to call the projectsites.dev REST API from CI, scripts, or external tools. Keys are scoped per-account and revocable any time.
            </p>
            <div class="flex gap-2 justify-center mt-1 flex-wrap">
              <button class="btn-primary" type="button" (click)="openCreateKey()" data-testid="apikey-empty-create" aria-label="Generate your first API key">+ Generate your first key</button>
            </div>
          </div>
        } @else {
          <div class="table-wrap">
            <table class="w-full text-[0.78rem]">
              <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
                <tr class="border-b border-white/[0.06]">
                  <th class="text-left p-2 font-semibold">Name</th>
                  <th class="text-left p-2 font-semibold">Key</th>
                  <th class="text-left p-2 font-semibold">Scope</th>
                  <th class="text-left p-2 font-semibold">Last used</th>
                  <th class="text-left p-2 font-semibold">Rotated</th>
                  <th class="text-left p-2 font-semibold">Expires</th>
                  <th class="text-right p-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                @for (k of apiKeys(); track k.id) {
                  <tr class="row" [class.is-revoked]="!k.active" [attr.data-testid]="'apikey-row-' + k.id">
                    <td class="p-2 font-medium text-white">{{ k.name }}</td>
                    <td class="p-2">
                      <div class="key-cell">
                        <code class="font-mono text-[0.72rem]">{{ revealed().has(k.id) ? k.prefix + '••••••••••' : maskedPrefix(k.prefix) }}</code>
                        <button class="icon-btn"
                                type="button"
                                (click)="toggleReveal(k.id)"
                                [attr.aria-label]="revealed().has(k.id) ? 'Hide key prefix' : 'Reveal key prefix'"
                                [title]="revealed().has(k.id) ? 'Hide' : 'Reveal'">
                          @if (revealed().has(k.id)) {
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                          } @else {
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          }
                        </button>
                        <button class="icon-btn"
                                type="button"
                                (click)="copyPrefix(k.prefix)"
                                aria-label="Copy key prefix"
                                title="Copy prefix">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                      </div>
                    </td>
                    <td class="p-2"><span class="scope-pill">{{ k.scopes?.join(' · ') || 'read · write' }}</span></td>
                    <td class="p-2 text-text-secondary">{{ k.last_used_at ? (k.last_used_at | date:'short') : 'never' }}</td>
                    <td class="p-2 text-text-secondary">{{ k.rotated_at ? (k.rotated_at | date:'mediumDate') : '—' }}</td>
                    <td class="p-2 text-text-secondary">{{ k.expires_at ? (k.expires_at | date:'mediumDate') : '—' }}</td>
                    <td class="p-2 text-right whitespace-nowrap">
                      @if (k.active) {
                        <button class="btn-tiny-ghost"
                                type="button"
                                (click)="rotateKey(k)"
                                [attr.data-testid]="'apikey-rotate-' + k.id"
                                aria-label="Rotate this key"
                                title="Generate a fresh secret + revoke the old one">Rotate</button>
                        <button class="btn-tiny-danger"
                                type="button"
                                (click)="revokeKey(k)"
                                [attr.data-testid]="'apikey-revoke-' + k.id"
                                aria-label="Revoke this key"
                                title="Revoke this key immediately">Revoke</button>
                      } @else {
                        <span class="status-pill is-revoked">Revoked</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <!-- ─────────────────── SESSIONS ─────────────────── -->
      <section class="card" appReveal>
        <div class="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <div class="kicker">Security</div>
            <h3 class="section-h m-0 text-base font-semibold text-white mt-1">Active sessions</h3>
            <p class="text-[0.7rem] text-text-secondary m-0 mt-1 max-w-prose">
              Devices currently signed in to your account. Revoke anything you don't recognize.
            </p>
          </div>
          @if (sessions().length > 1) {
            <button class="btn-ghost"
                    type="button"
                    (click)="revokeAllOtherSessions()"
                    aria-label="Revoke all other sessions"
                    title="Sign out every session except this one">Revoke all other sessions</button>
          }
        </div>

        @if (loadingSessions() && sessions().length === 0) {
          <div class="space-y-2" aria-busy="true">
            @for (i of [1,2]; track i) {
              <div class="flex items-center gap-3 py-2 border-b border-white/[0.04]">
                <div class="skel h-9 w-9 rounded-lg"></div>
                <div class="flex-1 space-y-2">
                  <div class="skel h-3 w-40 rounded"></div>
                  <div class="skel h-3 w-56 rounded"></div>
                </div>
                <div class="skel h-7 w-16 rounded"></div>
              </div>
            }
          </div>
        } @else if (sessions().length === 0) {
          <p class="text-[0.78rem] text-text-secondary m-0">No active sessions found. You should at least see this one — try refreshing.</p>
        } @else {
          <ul class="session-list" role="list">
            @for (s of sessions(); track s.id) {
              <li class="session-row" [attr.data-testid]="'session-row-' + s.id">
                <div class="session-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-medium text-white text-[0.82rem] truncate">{{ s.device || s.browser || 'Unknown device' }}</span>
                    @if (s.current) { <span class="status-pill is-active">This device</span> }
                  </div>
                  <div class="text-[0.7rem] text-text-secondary mt-0.5 truncate">
                    {{ s.os || '—' }} · {{ s.location || s.ip || 'Unknown location' }}
                  </div>
                  <div class="text-[0.66rem] text-text-secondary/70 mt-0.5">
                    Last active {{ s.last_active_at ? (s.last_active_at | date:'short') : 'unknown' }}
                  </div>
                </div>
                @if (!s.current) {
                  <button class="btn-tiny-danger"
                          type="button"
                          (click)="revokeSession(s)"
                          [attr.aria-label]="'Revoke session on ' + (s.device || s.browser || 'this device')">Revoke</button>
                }
              </li>
            }
          </ul>
        }
      </section>

      <!-- ─────────────────── NOTIFICATIONS ─────────────────── -->
      <section class="card" appReveal>
        <div class="kicker">Email cadence</div>
        <h3 class="section-h m-0 text-base font-semibold text-white mt-1 mb-1">Notification preferences</h3>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3 max-w-prose">
          Choose what lands in your inbox. Security alerts stay on by design — toggling them off only mutes the digest, never critical warnings.
        </p>

        <div class="space-y-5">
          @for (g of notificationGroups(); track g.id) {
            <div>
              <div class="muted-h mb-2">{{ g.label }}</div>
              <ul role="list" class="notif-list">
                @for (p of g.prefs; track p.id) {
                  <li class="notif-row">
                    <label class="flex-1 cursor-pointer">
                      <div class="font-medium text-white text-[0.82rem]">{{ p.label }}</div>
                      <div class="text-[0.7rem] text-text-secondary mt-0.5 leading-relaxed">{{ p.desc }}</div>
                    </label>
                    <button class="switch"
                            type="button"
                            role="switch"
                            [attr.aria-checked]="p.enabled"
                            [attr.aria-label]="(p.enabled ? 'Disable' : 'Enable') + ' ' + p.label"
                            (click)="toggleNotification(g.id, p.id)"
                            [class.is-on]="p.enabled">
                      <span class="switch-thumb"></span>
                    </button>
                  </li>
                }
              </ul>
            </div>
          }
        </div>
      </section>

      <!-- ─────────────────── LABS ─────────────────── -->
      <section class="card" data-testid="labs-card">
        <div class="kicker">Labs</div>
        <h3 class="section-h m-0 text-base font-semibold text-white mt-1 mb-1">Experimental features</h3>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3 max-w-prose leading-relaxed">
          Opt into in-flight work. These flags persist in <code class="text-[0.7rem]">localStorage</code> and live on this device only — clear them by toggling off.
        </p>

        <ul role="list" class="notif-list">
          <li class="notif-row">
            <label class="flex-1 cursor-pointer">
              <div class="font-medium text-white text-[0.82rem]">Native editor</div>
              <div class="text-[0.7rem] text-text-secondary mt-0.5 leading-relaxed">
                Replaces the bolt.diy iframe at <code>/admin/editor-native</code> with a pure Angular port. Faster cold load, D1-backed chat. Phase 1 of 6.
              </div>
            </label>
            <button class="switch"
                    type="button"
                    role="switch"
                    [attr.aria-checked]="nativeEditorFlag()"
                    [attr.aria-label]="(nativeEditorFlag() ? 'Disable' : 'Enable') + ' experimental native editor'"
                    (click)="toggleNativeEditor()"
                    [class.is-on]="nativeEditorFlag()"
                    data-testid="labs-native-editor-toggle">
              <span class="switch-thumb"></span>
            </button>
          </li>
        </ul>
      </section>

      <!-- ─────────────────── DANGER ZONE ─────────────────── -->
      <section class="card danger-card">
        <div class="kicker text-red-300">Danger zone</div>
        <h3 class="section-h m-0 text-base font-semibold text-white mt-1 mb-1">Delete account</h3>
        <p class="text-[0.74rem] text-text-secondary m-0 mb-3 max-w-prose leading-relaxed">
          Permanently delete your account, all your sites, snapshots, audit history, and API keys. This cannot be undone — billing continues until the end of the current period.
        </p>
        <button class="btn-danger"
                type="button"
                (click)="openDeleteAccount()"
                data-testid="delete-account-button"
                aria-label="Delete account">
          Delete account…
        </button>
      </section>

      <!-- ─────────────────── CREATE API KEY MODAL ─────────────────── -->
      @if (createOpen()) {
        <app-dialog-shell (closed)="closeCreateDialog()">
          <span dialogIcon>
            <svg class="text-primary" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg>
          </span>
          <span dialogTitle>{{ newSecret() ? 'API key created' : 'Generate API key' }}</span>

          @if (!newSecret()) {
            <ng-container>
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
                    hlmInput class="w-full"
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
                    hlmSelect class="w-full mt-1"
                    [ngModel]="newKey.expires"
                    (ngModelChange)="newKey.expires = +$event"
                    aria-label="Key expiration"
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
            </ng-container>
          }

          @if (newSecret(); as nk) {
            <ng-container>
              <div class="p-5 flex flex-col gap-3">
                <div class="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.06] p-3">
                  <strong class="text-emerald-300 text-[0.78rem] block mb-1">Copy now — this secret is never shown again.</strong>
                  <span class="text-[0.7rem] text-text-secondary">Store it in your password manager, CI secret store, or a sealed env vault before closing.</span>
                </div>
                <div class="flex items-center gap-2">
                  <code class="flex-1 font-mono text-[0.78rem] text-white p-2 bg-black/40 rounded-lg overflow-x-auto whitespace-nowrap border border-white/[0.06]"
                        data-testid="apikey-modal-secret">{{ nk.secret }}</code>
                  <button class="btn-ghost" type="button" (click)="copyKey(nk.secret)" data-testid="apikey-modal-copy-secret" aria-label="Copy secret" title="Copy secret to clipboard">Copy</button>
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
            </ng-container>
          }
        </app-dialog-shell>
      }

      <!-- ─────────────────── DELETE ACCOUNT MODAL ─────────────────── -->
      @if (deleteOpen()) {
        <app-dialog-shell (closed)="closeDeleteDialog()">
          <span dialogIcon>
            <svg class="text-red-400" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </span>
          <span dialogTitle>Delete account</span>

          <div class="p-5 flex flex-col gap-3">
            <p class="text-[0.82rem] text-white m-0 leading-relaxed">
              This will permanently delete <strong>{{ auth.email() || 'your account' }}</strong>, every site you own, all snapshots, audit history, and API keys.
            </p>
            <p class="text-[0.74rem] text-text-secondary m-0">Type <code class="font-mono text-red-300">delete</code> below to confirm.</p>
            <input
              type="text"
              hlmInput class="w-full"
              placeholder="delete"
              [ngModel]="deleteConfirm"
              (ngModelChange)="deleteConfirm = $event"
              data-testid="delete-account-confirm-input"
              autofocus
              autocomplete="off" />
          </div>

          <div dialogFooter class="px-5 py-4 border-t border-white/[0.06] flex items-center justify-end gap-2">
            <button class="btn-ghost" type="button" (click)="closeDeleteDialog()" [disabled]="deleting()">Cancel</button>
            <button
              class="btn-danger"
              type="button"
              [disabled]="deleting() || deleteConfirm.trim().toLowerCase() !== 'delete'"
              data-testid="delete-account-confirm"
              (click)="performDelete()">
              {{ deleting() ? 'Deleting…' : 'Delete forever' }}
            </button>
          </div>
        </app-dialog-shell>
      }

      <!-- ─────────────────── CLOUDFLARE CREDENTIALS MODAL ─────────────────── -->
      @if (cfDialogOpen()) {
        <app-dialog-shell (closed)="closeCfDialog()">
          <span dialogIcon>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent">
              <path d="M17.7 12.3a4 4 0 0 0-7.6-1.4 3 3 0 0 0-4.1 4.1A3 3 0 0 0 7.5 19h10a3.5 3.5 0 0 0 .2-7z"/>
            </svg>
          </span>
          <span dialogTitle>Cloudflare credentials</span>

          <div class="p-5 flex flex-col gap-4">
            <p class="text-[0.78rem] text-text-secondary m-0 leading-relaxed">
              Paste your Cloudflare global API key + the account email. We store the key AES-GCM encrypted in D1 — it never leaves the worker plaintext after this submit.
            </p>

            <label class="block">
              <span class="muted-h">Email</span>
              <input
                type="email"
                placeholder="you@example.com"
                [ngModel]="cfDraft.email"
                (ngModelChange)="cfDraft.email = $event"
                hlmInput class="w-full mt-1"
                autocomplete="email"
                data-testid="cf-modal-email"
                autofocus />
            </label>

            <label class="block">
              <span class="muted-h flex items-center justify-between">
                <span>Global API key</span>
                <button class="text-[0.66rem] text-text-secondary/80 hover:text-white"
                        type="button"
                        (click)="cfReveal.set(!cfReveal())"
                        [attr.aria-label]="cfReveal() ? 'Hide key' : 'Reveal key'">
                  {{ cfReveal() ? 'Hide' : 'Reveal' }}
                </button>
              </span>
              <input
                [type]="cfReveal() ? 'text' : 'password'"
                placeholder="d3a9…"
                [ngModel]="cfDraft.apiKey"
                (ngModelChange)="cfDraft.apiKey = $event"
                hlmInput class="w-full mt-1 font-mono"
                autocomplete="off"
                data-testid="cf-modal-key" />
              <span class="text-[0.62rem] text-text-secondary/70 mt-1 block">
                Generate at
                <a class="text-link"
                   href="https://dash.cloudflare.com/profile/api-tokens"
                   target="_blank"
                   rel="noopener noreferrer">dash.cloudflare.com/profile/api-tokens</a> → API Keys → Global API Key.
              </span>
            </label>

            @if (cfError(); as err) {
              <p class="apikey-error" role="alert" aria-live="assertive" data-testid="cf-modal-error">{{ err }}</p>
            }
          </div>

          <div dialogFooter class="px-5 py-4 border-t border-white/[0.06] flex items-center justify-end gap-2">
            <button class="btn-ghost" type="button" (click)="closeCfDialog()" [disabled]="savingCf()" data-testid="cf-modal-cancel">Cancel</button>
            <button
              class="btn-primary"
              type="button"
              [disabled]="savingCf() || !cfDraftValid()"
              data-testid="cf-modal-save"
              (click)="saveCf()">
              {{ savingCf() ? 'Validating…' : 'Save credentials' }}
            </button>
          </div>
        </app-dialog-shell>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    /* ── Brand-aware tokens; fall back to literal colors when --ps-* isn't loaded ── */
    .kicker {
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--ps-accent, #00E5FF); opacity: 0.85;
    }
    h2, h3, .section-h { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }

    .card {
      background: var(--ps-surface-1, rgba(13,13,40,0.62));
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 14%, transparent);
      border-radius: var(--ps-radius-xl, 14px);
      padding: 1.4rem;
      box-shadow: var(--ps-shadow-card, inset 0 0 0 1px rgba(255,255,255,0.02));
      transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
    }
    .card:hover {
      transform: translateY(-1px);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 28%, transparent);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px -16px color-mix(in oklch, var(--ps-accent, #00E5FF) 28%, transparent);
    }

    .danger-card {
      border-color: rgba(248,113,113,0.28);
      background: linear-gradient(180deg, rgba(248,113,113,0.04), rgba(13,13,40,0.62));
    }
    .danger-card:hover {
      border-color: rgba(248,113,113,0.48);
      box-shadow: inset 0 0 0 1px rgba(248,113,113,0.08), 0 8px 24px -16px rgba(248,113,113,0.28);
    }

    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }

    /* ── Header pill (active count) ── */
    .header-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 10px; border-radius: 999px;
      background: rgba(52, 211, 153, 0.10);
      border: 1px solid rgba(52, 211, 153, 0.32);
      color: #6ee7b7;
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 0.65rem; font-weight: 600; letter-spacing: 0.02em;
      margin-left: 0.4rem; vertical-align: middle;
    }
    .header-pill-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #34d399; box-shadow: 0 0 6px rgba(52, 211, 153, 0.7);
    }

    /* ── Profile avatar ── */
    .profile-avatar {
      width: 64px; height: 64px;
      border-radius: 18px;
      display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, color-mix(in oklch, var(--ps-accent, #00E5FF) 18%, transparent), color-mix(in oklch, var(--ps-accent-secondary, #7C3AED) 18%, transparent));
      color: var(--ps-ink, #fff);
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 1.4rem; font-weight: 700; letter-spacing: -0.02em;
      box-shadow: 0 0 0 2px color-mix(in oklch, var(--ps-accent, #00E5FF) 45%, transparent), 0 0 24px -6px color-mix(in oklch, var(--ps-accent, #00E5FF) 35%, transparent);
      flex-shrink: 0;
    }
    .role-pill {
      display: inline-flex; align-items: center;
      padding: 2px 8px; border-radius: 999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 12%, transparent);
      color: var(--ps-accent, #00E5FF);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 35%, transparent);
    }

    /* ── Buttons ── */
    .btn-primary {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      min-height: 32px;
      background: linear-gradient(135deg, color-mix(in oklch, var(--ps-accent, #00E5FF) 18%, transparent), color-mix(in oklch, var(--ps-accent-secondary, #7C3AED) 18%, transparent));
      color: var(--ps-accent, #00E5FF);
      font-weight: 600; border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 35%, transparent);
      cursor: pointer; font-size: 0.78rem;
      transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease, background 200ms ease;
    }
    .btn-primary:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 55%, transparent);
      background: linear-gradient(135deg, color-mix(in oklch, var(--ps-accent, #00E5FF) 26%, transparent), color-mix(in oklch, var(--ps-accent-secondary, #7C3AED) 26%, transparent));
      box-shadow: 0 8px 24px -10px color-mix(in oklch, var(--ps-accent, #00E5FF) 35%, transparent);
    }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary:focus-visible {
      outline: 2px solid var(--ps-accent, #00E5FF);
      outline-offset: 2px;
    }

    .btn-ghost {
      padding: 0.45rem 0.95rem; border-radius: 8px; min-height: 32px;
      background: transparent; color: rgba(255,255,255,0.78);
      border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; font-weight: 600;
      transition: transform 200ms ease, border-color 200ms ease, color 200ms ease, background 200ms ease;
    }
    .btn-ghost:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 30%, transparent);
      color: #fff; background: rgba(255,255,255,0.04);
    }
    .btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost:focus-visible {
      outline: 2px solid var(--ps-accent, #00E5FF);
      outline-offset: 2px;
    }

    .btn-danger {
      padding: 0.5rem 1rem; border-radius: 8px; min-height: 32px;
      background: rgba(248, 113, 113, 0.14); color: #fecaca;
      border: 1px solid rgba(248, 113, 113, 0.38); cursor: pointer; font-size: 0.78rem; font-weight: 600;
      transition: background 200ms ease, border-color 200ms ease, transform 200ms ease;
    }
    .btn-danger:hover:not(:disabled) { background: rgba(248, 113, 113, 0.22); border-color: rgba(248, 113, 113, 0.6); transform: translateY(-1px); }
    .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-danger:focus-visible { outline: 2px solid #fca5a5; outline-offset: 2px; }

    .btn-tiny-ghost, .btn-tiny-danger {
      padding: 4px 10px; border-radius: 6px; min-height: 28px;
      font-size: 0.68rem; font-weight: 600; cursor: pointer;
      transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
      margin-left: 6px;
    }
    .btn-tiny-ghost {
      background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.12);
    }
    .btn-tiny-ghost:hover { color: #fff; background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.22); }
    .btn-tiny-ghost:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }

    .btn-tiny-danger {
      background: transparent; color: #fca5a5; border: 1px solid rgba(248,113,113,0.28);
    }
    .btn-tiny-danger:hover { background: rgba(248,113,113,0.14); color: #fecaca; border-color: rgba(248,113,113,0.5); }
    .btn-tiny-danger:focus-visible { outline: 2px solid #fca5a5; outline-offset: 2px; }

    .icon-btn {
      width: 24px; height: 24px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 6px;
      background: transparent;
      color: rgba(255,255,255,0.55);
      border: 1px solid transparent;
      cursor: pointer;
      transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
    }
    .icon-btn:hover { color: var(--ps-accent, #00E5FF); background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }
    .icon-btn:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }

    /* ── Form bits — inputs/select use Spartan hlmInput/hlmSelect; keep only
       the invalid-state tint for the api-key name field ([attr.aria-invalid]). */
    [hlmInput][aria-invalid="true"] { border-color: oklch(0.78 0.18 25 / 0.75) !important; }

    /* ── Theme cards ── */
    .theme-card {
      display: flex; flex-direction: column; align-items: flex-start; gap: 0.4rem;
      padding: 0.85rem; border-radius: 12px;
      background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.08);
      cursor: pointer; transition: all 160ms ease; text-align: left;
      min-height: 48px;
    }
    .theme-card:hover { border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 35%, transparent); transform: translateY(-1px); }
    .theme-card.active {
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 60%, transparent);
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 8%, transparent);
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--ps-accent, #00E5FF) 12%, transparent);
    }
    .theme-card:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }
    .theme-swatch { width: 100%; height: 44px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); }
    .theme-swatch.dk { background: linear-gradient(135deg, #06061a, #0a0a28); }
    .theme-swatch.lt { background: linear-gradient(135deg, #f8fafc, #cbd5e1); }
    .theme-swatch.sy { background: linear-gradient(135deg, #06061a 0 50%, #f8fafc 50% 100%); }

    /* ── Table / rows ── */
    .table-wrap { overflow-x: auto; }
    .row { border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 140ms ease; }
    .row:hover { background: rgba(255,255,255,0.02); }
    .row.is-revoked { opacity: 0.5; }
    .key-cell { display: inline-flex; align-items: center; gap: 6px; }
    .scope-pill {
      display: inline-flex; align-items: center; padding: 2px 8px;
      font-size: 0.6rem; text-transform: uppercase; font-weight: 700; border-radius: 999px;
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 12%, transparent);
      color: var(--ps-accent, #00E5FF);
    }

    .status-pill {
      display: inline-flex; align-items: center;
      padding: 2px 8px; border-radius: 999px;
      font-size: 0.6rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    }
    .status-pill.is-active {
      background: rgba(52, 211, 153, 0.14); color: #6ee7b7; border: 1px solid rgba(52, 211, 153, 0.32);
    }
    .status-pill.is-revoked {
      background: rgba(248, 113, 113, 0.10); color: #fca5a5; border: 1px solid rgba(248, 113, 113, 0.28);
    }

    .text-accent { color: var(--ps-accent, #00E5FF); }
    .text-link {
      color: var(--ps-accent, #00E5FF);
      text-decoration: underline;
      text-decoration-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 40%, transparent);
      text-underline-offset: 3px;
      transition: text-decoration-color 160ms ease;
    }
    .text-link:hover {
      text-decoration-color: var(--ps-accent, #00E5FF);
    }
    .text-link:focus-visible {
      outline: 2px solid var(--ps-accent, #00E5FF);
      outline-offset: 2px;
      border-radius: 2px;
    }
    [data-focus="cloudflare"] {
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 48%, transparent);
      box-shadow:
        inset 0 0 0 1px color-mix(in oklch, var(--ps-accent, #00E5FF) 38%, transparent),
        0 16px 48px -16px color-mix(in oklch, var(--ps-accent, #00E5FF) 42%, transparent);
      animation: focusPulse 1600ms ease-out 1;
    }
    @keyframes focusPulse {
      0%   { transform: scale(1); }
      50%  { transform: scale(1.005); }
      100% { transform: scale(1); }
    }

    /* ── Sessions list ── */
    .session-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .session-row {
      display: flex; align-items: center; gap: 12px;
      padding: 0.7rem 0.8rem;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.05);
      background: rgba(255,255,255,0.015);
      transition: border-color 160ms ease, background 160ms ease;
    }
    .session-row:hover { border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 18%, transparent); background: rgba(255,255,255,0.025); }
    .session-icon {
      width: 36px; height: 36px; border-radius: 10px;
      display: inline-flex; align-items: center; justify-content: center;
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 10%, transparent);
      color: var(--ps-accent, #00E5FF);
      flex-shrink: 0;
    }

    /* ── Notification toggles ── */
    .notif-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
    .notif-row {
      display: flex; align-items: center; gap: 12px;
      padding: 0.6rem 0.7rem;
      border-radius: 10px;
      transition: background 140ms ease;
    }
    .notif-row:hover { background: rgba(255,255,255,0.025); }
    .switch {
      width: 36px; height: 20px;
      border-radius: 999px;
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.16);
      position: relative;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 180ms ease, border-color 180ms ease;
      padding: 0; min-height: 24px;
    }
    .switch:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }
    .switch-thumb {
      position: absolute; top: 1px; left: 1px;
      width: 16px; height: 16px; border-radius: 50%;
      background: #fff;
      transition: transform 180ms cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .switch.is-on {
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 40%, transparent);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 60%, transparent);
    }
    .switch.is-on .switch-thumb { transform: translateX(16px); background: var(--ps-accent, #00E5FF); box-shadow: 0 0 8px color-mix(in oklch, var(--ps-accent, #00E5FF) 50%, transparent); }

    /* ── Empty state (cinematic, matches editor.component) ── */
    .empty-state-pretty {
      display: flex; flex-direction: column; align-items: center; gap: 0.6rem;
      padding: 2.4rem 1.2rem; text-align: center;
    }
    .empty-glyph {
      width: 72px; height: 72px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 18px;
      background: linear-gradient(135deg, color-mix(in oklch, var(--ps-accent, #00E5FF) 10%, transparent), color-mix(in oklch, var(--ps-accent-secondary, #7C3AED) 8%, transparent));
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 18%, transparent);
      color: color-mix(in oklch, var(--ps-accent, #00E5FF) 70%, currentColor 30%);
      box-shadow: 0 16px 48px -24px color-mix(in oklch, var(--ps-accent, #00E5FF) 38%, transparent);
      animation: pulseGlow 3.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    @keyframes pulseGlow {
      0%, 100% { box-shadow: 0 16px 48px -24px color-mix(in oklch, var(--ps-accent, #00E5FF) 32%, transparent); }
      50% { box-shadow: 0 20px 64px -24px color-mix(in oklch, var(--ps-accent, #00E5FF) 55%, transparent); }
    }
    .glow-h-grad {
      background: linear-gradient(135deg, var(--ps-ink, #fff), color-mix(in oklch, var(--ps-accent, #00E5FF) 60%, var(--ps-ink, #fff) 40%));
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }

    /* ── Error tile ── */
    .error-tile {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 0.85rem 1rem;
      border-radius: 10px;
      background: rgba(248, 113, 113, 0.06);
      border: 1px solid rgba(248, 113, 113, 0.28);
      color: #fecaca;
      font-size: 0.78rem;
    }

    /* ── Skeleton ── */
    .skel {
      position: relative; overflow: hidden;
      background: rgba(255,255,255,0.04);
    }
    .skel::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06) 40%, color-mix(in oklch, var(--ps-accent, #00E5FF) 12%, transparent) 50%, rgba(255,255,255,0.06) 60%, transparent);
      background-size: 200% 100%;
      animation: skel-shine 1.6s linear infinite;
    }
    @keyframes skel-shine { from { background-position: 200% 0; } to { background-position: -200% 0; } }

    /* ── Modal helpers ── */
    .char-counter { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.65rem; color: rgba(255,255,255,0.5); letter-spacing: 0.02em; }
    .char-counter--full { color: oklch(0.78 0.18 25); }
    .apikey-error { margin: 6px 0 0; font-size: 0.72rem; color: oklch(0.78 0.18 25); line-height: 1.35; }

    @media (prefers-reduced-motion: reduce) {
      .card, .btn-primary, .btn-ghost, .btn-danger, .theme-card, .session-row, .notif-row, .row, .switch, .switch-thumb, .icon-btn { transition: none; }
      .card:hover, .btn-primary:hover, .btn-ghost:hover, .btn-danger:hover, .theme-card:hover, .session-row:hover { transform: none; box-shadow: none; }
      .empty-glyph, .skel::after { animation: none; }
      .skel { background: rgba(255,255,255,0.06); }
    }
    @media (max-width: 640px) {
      .btn-primary, .btn-ghost, .btn-danger { width: 100%; }
    }
  `],
})
export class AdminUserSettingsComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  // ── Profile derived signals ──
  /** Two-letter initials for the avatar bubble. Falls back to "PS" if no email. */
  initials = computed<string>(() => {
    const e = this.auth.email();
    if (!e) return 'PS';
    const local = e.split('@')[0] ?? '';
    const parts = local.split(/[._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    return (local.slice(0, 2) || 'PS').toUpperCase();
  });
  displayName = computed<string>(() => {
    const e = this.auth.email();
    if (!e) return 'Signed-out';
    return (e.split('@')[0] ?? e).replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  });
  /**
   * Role label shown in the profile pill. Reads from the session shape if a
   * `role` claim is present; otherwise defaults to the only role we currently
   * surface on the SPA (owner). Org membership routing comes later — this is
   * intentionally a string lookup, not a structured RBAC dependency.
   */
  roleLabel = computed<string>(() => {
    const s = this.auth.session() as { role?: string } | null;
    return (s?.role || 'owner').toUpperCase();
  });
  shortId = computed<string>(() => {
    const s = this.auth.session();
    if (!s) return '—';
    const id = s.identifier ?? '';
    return id.length > 16 ? `${id.slice(0, 6)}…${id.slice(-6)}` : (id || '—');
  });

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
    try { document.documentElement.setAttribute('data-theme', t); } catch { /* SSR */ }
    try { localStorage.setItem('ps_theme', t); } catch { /* private mode / quota */ }
    const msg = t === 'system' ? 'Theme set to system' : `Theme changed to ${t}`;
    this.toast.info(msg);
  }

  // ── Labs: native editor opt-in ──
  /**
   * Persisted in `localStorage['editor.native']`. When `true`, the
   * `/admin/editor-native` route renders the experimental Angular port
   * instead of the iframe gate page. Flag survives refresh; opt-out by
   * toggling off (no page reload needed — the next visit to the route
   * re-reads the flag).
   */
  nativeEditorFlag = signal<boolean>(((): boolean => {
    try { return localStorage.getItem('editor.native') === 'true'; } catch { return false; }
  })());

  toggleNativeEditor(): void {
    const next = !this.nativeEditorFlag();
    this.nativeEditorFlag.set(next);
    try {
      if (next) localStorage.setItem('editor.native', 'true');
      else localStorage.removeItem('editor.native');
    } catch { /* SSR / private mode */ }
    this.toast.info(
      next
        ? 'Native editor enabled — visit /admin/editor-native'
        : 'Native editor disabled',
    );
  }

  // ── API keys ──
  apiKeys = signal<ApiKeyRow[]>([]);
  loadingKeys = signal(false);
  keysError = signal<string | null>(null);
  createOpen = signal(false);
  generatingKey = signal(false);
  createError = signal<string | null>(null);
  revealed = signal<Set<string>>(new Set());
  /** The just-created secret + metadata for the modal's reveal step. Cleared on modal close. */
  newSecret = signal<{ name: string; secret: string; expires_at: string | null } | null>(null);
  newKey: { name: string; expires: number } = { name: '', expires: 90 };

  /** Live counter for the name field — caps at 40 per spec. */
  nameLen = computed(() => this.newKey.name.length);
  /** Active (non-revoked) keys for the header pill. */
  activeKeyCount = computed<number>(() => this.apiKeys().filter((k) => k.active).length);

  // ── Sessions ──
  sessions = signal<SessionRow[]>([]);
  loadingSessions = signal(false);

  // ── Notification prefs (local-only until /api/admin/notifications ships) ──
  private static readonly NOTIFICATION_KEY = 'ps_notification_prefs';
  notificationGroups = signal<NotificationGroup[]>(this.loadNotificationPrefs());

  // ── Delete account ──
  deleteOpen = signal(false);
  deleting = signal(false);
  deleteConfirm = '';

  // ── Cloudflare credentials ──
  credStatus = signal<CloudflareCredentialStatus | null>(null);
  cfDialogOpen = signal(false);
  savingCf = signal(false);
  validatingCf = signal(false);
  cfReveal = signal(false);
  cfError = signal<string | null>(null);
  focusCf = signal(false);
  cfDraft: { email: string; apiKey: string } = { email: '', apiKey: '' };

  /** Validate the in-modal draft before enabling Save. */
  cfDraftValid = computed<boolean>(() => {
    const { email, apiKey } = this.cfDraft;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && apiKey.trim().length >= 20;
  });

  /** Human label for the credential source pill in the card body. */
  credSourceLabel = computed<string>(() => {
    const s = this.credStatus()?.source;
    if (s === 'org') return 'using your account credentials';
    if (s === 'worker_global_key') return 'using platform shared credentials';
    if (s === 'worker_token') return 'using platform token (zone-scoped)';
    return 'not connected — analytics will be empty';
  });

  credBadgeTitle = computed<string>(() => {
    const s = this.credStatus()?.source;
    if (s === 'org') return 'Your stored Cloudflare credentials are active.';
    if (s === 'worker_global_key' || s === 'worker_token') return 'Falling back to platform-bundled credentials.';
    return 'No Cloudflare credentials configured — connect to enable analytics.';
  });

  shortCfAccount = computed<string>(() => {
    const id = this.credStatus()?.last_validated_account_id ?? '';
    return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : (id || '—');
  });

  ngOnInit(): void {
    this.loadApiKeys();
    this.loadSessions();
    this.loadCredStatus();
    // Honor `?focus=cloudflare` deep links from the analytics CTA.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('focus') === 'cloudflare') {
        this.focusCf.set(true);
        // Drop the focus highlight after the keyframe finishes.
        setTimeout(() => this.focusCf.set(false), 2200);
        // Auto-scroll the card into view.
        setTimeout(() => {
          const el = document.querySelector<HTMLElement>('[data-testid="cf-credentials-card"]');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      }
    } catch { /* SSR */ }
  }

  loadCredStatus(): void {
    this.api.getCloudflareCredentialStatus().subscribe({
      next: (r) => this.credStatus.set(r.data),
      error: () => { /* shared handleError already toasted */ },
    });
  }

  openCfDialog(): void {
    this.cfDraft = { email: this.credStatus()?.email ?? this.auth.email() ?? '', apiKey: '' };
    this.cfError.set(null);
    this.cfReveal.set(false);
    this.cfDialogOpen.set(true);
  }

  closeCfDialog(): void {
    if (this.savingCf()) return;
    this.cfDialogOpen.set(false);
    this.cfDraft = { email: '', apiKey: '' };
    this.cfError.set(null);
  }

  saveCf(): void {
    if (!this.cfDraftValid() || this.savingCf()) return;
    this.savingCf.set(true);
    this.cfError.set(null);
    this.api.setCloudflareCredentials(this.cfDraft.email.trim(), this.cfDraft.apiKey.trim()).subscribe({
      next: (r) => {
        this.savingCf.set(false);
        this.credStatus.set(r.data);
        this.toast.success('Cloudflare credentials saved + validated');
        this.closeCfDialog();
      },
      error: (err: unknown) => {
        this.savingCf.set(false);
        const message = (err as { error?: { error?: { message?: string } } })?.error?.error?.message
          ?? 'Cloudflare rejected those credentials. Double-check the email + key.';
        this.cfError.set(message);
      },
    });
  }

  validateCf(): void {
    if (this.validatingCf()) return;
    this.validatingCf.set(true);
    this.api.validateCloudflareCredentials().subscribe({
      next: (r) => {
        this.validatingCf.set(false);
        if (r.data.ok) {
          this.toast.success('Cloudflare credentials valid');
          this.loadCredStatus();
        } else {
          this.toast.error(`Cloudflare rejected the stored key: ${r.data.message ?? 'unknown error'}`);
        }
      },
      error: () => {
        this.validatingCf.set(false);
      },
    });
  }

  disconnectCf(): void {
    if (!window.confirm('Remove your stored Cloudflare credentials? Analytics will fall back to platform-bundled defaults.')) return;
    this.api.deleteCloudflareCredentials().subscribe({
      next: () => {
        this.toast.info('Cloudflare credentials removed');
        this.loadCredStatus();
      },
    });
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

  closeCreateDialog(): void {
    if (this.generatingKey()) return;
    this.createOpen.set(false);
    this.newKey = { name: '', expires: 90 };
    this.newSecret.set(null);
    this.createError.set(null);
  }

  /**
   * Validate the key name. Returns null when valid, else a user-safe error
   * rendered inline + announced via aria-live.
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

  canCreate(): boolean {
    return this.newKey.name.trim().length > 0 && this.nameError() === null;
  }

  acknowledgeNewKey(): void {
    this.createOpen.set(false);
    this.newSecret.set(null);
    this.newKey = { name: '', expires: 90 };
    this.createError.set(null);
  }

  loadApiKeys(): void {
    this.loadingKeys.set(true);
    this.keysError.set(null);
    this.api.get<{ data: ApiKeyRow[] }>('/admin/api-keys').subscribe({
      next: (r) => { this.apiKeys.set(r.data ?? []); this.loadingKeys.set(false); },
      error: (err) => {
        this.apiKeys.set([]);
        this.loadingKeys.set(false);
        const msg = err?.error?.error?.message || err?.error?.message || 'Network or auth error — retry shortly.';
        this.keysError.set(msg);
      },
    });
  }

  generateKey(): void {
    if (!this.canCreate()) return;
    this.generatingKey.set(true);
    this.createError.set(null);
    const scopes = ['read', 'write'];
    this.api.post<{ data: ApiKeyCreateResponse }>('/admin/api-keys', {
      name: this.newKey.name.trim(),
      scopes,
      expires_in_days: this.newKey.expires || undefined,
    }).subscribe({
      next: (r) => {
        this.generatingKey.set(false);
        const created = r.data;
        const optimisticRow: ApiKeyRow = {
          id: created.id ?? `temp-${Date.now()}`,
          name: created.name,
          prefix: created.prefix ?? created.secret.slice(0, 12),
          scopes: created.scopes ?? scopes,
          last_used_at: null,
          expires_at: created.expires_at,
          rotated_at: null,
          active: true,
        };
        this.apiKeys.update((rows) => [optimisticRow, ...rows]);
        this.newSecret.set({ name: created.name, secret: created.secret, expires_at: created.expires_at });
        this.toast.success('API key generated — copy your secret now');
        this.loadApiKeys();
      },
      error: (err) => {
        this.generatingKey.set(false);
        const msg = err?.error?.error?.message || err?.error?.message || 'Could not generate API key. Check your name + try again.';
        this.createError.set(msg);
      },
    });
  }

  /** Toggle reveal/hide of the prefix segment for a single row. */
  toggleReveal(id: string): void {
    this.revealed.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** Masked prefix string for the table. Keeps the leading 4 chars visible so the user can still identify the key. */
  maskedPrefix(prefix: string): string {
    if (!prefix) return '••••••••';
    const visible = prefix.slice(0, 4);
    return `${visible}${'•'.repeat(Math.max(8, prefix.length - 4))}`;
  }

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

  async copyPrefix(prefix: string): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(prefix);
      this.toast.success('Prefix copied');
    } catch {
      this.toast.error('Could not copy — select the text manually');
    }
  }

  /**
   * Rotate via toast-armed confirmation. POSTs to `/admin/api-keys/:id/rotate`;
   * the worker revokes the old key and returns a fresh secret which we surface
   * in the reveal modal so the user can save it.
   */
  rotateKey(k: ApiKeyRow): void {
    this.toast.warning(
      `Rotate "${k.name}"? Old secret stops working immediately — clients must redeploy with the new one.`,
      {
        action: { label: 'Rotate', run: () => this.performRotate(k) },
        duration: 7000,
      },
    );
  }

  private performRotate(k: ApiKeyRow): void {
    this.api.post<{ data: ApiKeyCreateResponse }>(`/admin/api-keys/${k.id}/rotate`, {}).subscribe({
      next: (r) => {
        const created = r.data;
        this.newSecret.set({ name: created.name, secret: created.secret, expires_at: created.expires_at });
        this.createOpen.set(true);
        this.toast.success(`${k.name} rotated — copy the new secret`);
        this.loadApiKeys();
      },
      error: (err) => {
        const msg = err?.error?.error?.message || 'Could not rotate key — retry, or revoke + recreate manually.';
        this.toast.error(msg);
      },
    });
  }

  revokeKey(k: { id: string; name: string }): void {
    this.toast.warning(
      `Revoke "${k.name}"? Any client using it will start receiving 401 immediately.`,
      {
        action: { label: 'Revoke', run: () => this.performRevoke(k) },
        duration: 7000,
      },
    );
  }

  private performRevoke(k: { id: string; name: string }): void {
    this.api.delete(`/admin/api-keys/${k.id}`).subscribe({
      next: () => { this.toast.success(`${k.name} revoked`); this.loadApiKeys(); },
      error: () => this.toast.error(`Could not revoke ${k.name} — retry shortly.`),
    });
  }

  // ─────────────────── Sessions ───────────────────
  loadSessions(): void {
    this.loadingSessions.set(true);
    this.api.get<{ data: SessionRow[] }>('/admin/sessions').subscribe({
      next: (r) => {
        this.sessions.set(r.data ?? []);
        this.loadingSessions.set(false);
      },
      error: () => {
        // Endpoint may not be wired yet — fall back to a single synthetic "this device"
        // row so the section never looks broken. Hide the row when there's no session.
        const s = this.auth.session();
        if (s) {
          this.sessions.set([{
            id: 'current',
            device: this.detectDevice(),
            browser: this.detectBrowser(),
            os: this.detectOs(),
            location: 'This browser',
            last_active_at: new Date().toISOString(),
            current: true,
          }]);
        } else {
          this.sessions.set([]);
        }
        this.loadingSessions.set(false);
      },
    });
  }

  revokeSession(s: SessionRow): void {
    this.toast.warning(
      `Sign out ${s.device || s.browser || 'this device'}?`,
      {
        action: {
          label: 'Sign out',
          run: () => {
            this.api.delete(`/admin/sessions/${s.id}`).subscribe({
              next: () => { this.toast.success('Session revoked'); this.loadSessions(); },
              error: () => this.toast.error('Could not revoke that session — retry shortly.'),
            });
          },
        },
        duration: 7000,
      },
    );
  }

  revokeAllOtherSessions(): void {
    this.toast.warning(
      'Sign out every session except this one?',
      {
        action: {
          label: 'Sign out all',
          run: () => {
            this.api.post('/admin/sessions/revoke-others', {}).subscribe({
              next: () => { this.toast.success('Other sessions revoked'); this.loadSessions(); },
              error: () => this.toast.error('Could not revoke other sessions — retry shortly.'),
            });
          },
        },
        duration: 7000,
      },
    );
  }

  private detectDevice(): string {
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
    if (/iPhone|Android.*Mobile/i.test(ua)) return 'Mobile';
    if (/iPad|Tablet/i.test(ua)) return 'Tablet';
    return 'Desktop';
  }
  private detectBrowser(): string {
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
    if (/Edg\//.test(ua)) return 'Edge';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    if (/Firefox\//.test(ua)) return 'Firefox';
    return 'Browser';
  }
  private detectOs(): string {
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
    if (/Mac OS X/i.test(ua)) return 'macOS';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Linux/i.test(ua)) return 'Linux';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad/i.test(ua)) return 'iOS';
    return 'Unknown OS';
  }

  // ─────────────────── Notifications ───────────────────
  private loadNotificationPrefs(): NotificationGroup[] {
    const defaults: NotificationGroup[] = [
      {
        id: 'product',
        label: 'Product',
        prefs: [
          { id: 'product.weekly', label: 'Weekly summary', desc: 'A 5-minute digest of build activity, traffic, and improvements.', enabled: true },
          { id: 'product.changelog', label: 'Changelog', desc: 'New features as they ship — once a week, capped.', enabled: true },
        ],
      },
      {
        id: 'security',
        label: 'Security',
        prefs: [
          { id: 'security.signin', label: 'New sign-in alerts', desc: 'Email when a new device or location signs in to your account.', enabled: true },
          { id: 'security.keys', label: 'API key activity', desc: 'Alert when a new key is generated, rotated, or revoked.', enabled: true },
        ],
      },
      {
        id: 'billing',
        label: 'Billing',
        prefs: [
          { id: 'billing.invoices', label: 'Invoices + receipts', desc: 'Every successful charge and refund, delivered as PDF.', enabled: true },
          { id: 'billing.failures', label: 'Failed payments', desc: 'Immediate alert if a charge fails — prevents site suspension.', enabled: true },
        ],
      },
    ];
    try {
      const raw = localStorage.getItem(AdminUserSettingsComponent.NOTIFICATION_KEY);
      if (!raw) return defaults;
      const saved = JSON.parse(raw) as Record<string, boolean>;
      return defaults.map((g) => ({
        ...g,
        prefs: g.prefs.map((p) => ({ ...p, enabled: saved[p.id] ?? p.enabled })),
      }));
    } catch {
      return defaults;
    }
  }

  toggleNotification(groupId: string, prefId: string): void {
    this.notificationGroups.update((groups) =>
      groups.map((g) =>
        g.id !== groupId
          ? g
          : { ...g, prefs: g.prefs.map((p) => (p.id === prefId ? { ...p, enabled: !p.enabled } : p)) },
      ),
    );
    try {
      const flat: Record<string, boolean> = {};
      for (const g of this.notificationGroups()) for (const p of g.prefs) flat[p.id] = p.enabled;
      localStorage.setItem(AdminUserSettingsComponent.NOTIFICATION_KEY, JSON.stringify(flat));
    } catch (err) {
      console.warn('[user-settings] notification pref persist failed', err);
    }
    // Fire-and-forget sync; ignore errors silently (local persistence is the source of truth).
    this.api.post('/admin/notifications', { group: groupId, pref: prefId }).subscribe({
      next: () => { /* ok */ },
      error: () => { /* silent */ },
    });
  }

  // ─────────────────── Delete account ───────────────────
  openDeleteAccount(): void {
    this.deleteConfirm = '';
    this.deleteOpen.set(true);
  }

  closeDeleteDialog(): void {
    if (this.deleting()) return;
    this.deleteOpen.set(false);
    this.deleteConfirm = '';
  }

  performDelete(): void {
    if (this.deleteConfirm.trim().toLowerCase() !== 'delete') return;
    this.deleting.set(true);
    this.api.delete('/admin/account').subscribe({
      next: () => {
        this.deleting.set(false);
        this.toast.success('Account scheduled for deletion');
        try { localStorage.clear(); } catch { /* */ }
        window.location.href = '/';
      },
      error: (err) => {
        this.deleting.set(false);
        const msg = err?.error?.error?.message || 'Could not delete account — contact hey@megabyte.space for manual removal.';
        this.toast.error(msg);
      },
    });
  }
}
