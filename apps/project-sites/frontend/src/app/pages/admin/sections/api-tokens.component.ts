/**
 * @component AdminApiTokensComponent
 * @description `/admin/api-tokens` — Public API v1 token management.
 *
 * Cyan/black compact design per [[cyan-black-compact-progression]].
 * Rolling counters on every numeric metric, appReveal on sections.
 *
 * Surfaces:
 * - Header stats: active tokens (rolling counter), requests today (rolling counter)
 * - Token list table: name, scopes, last used, expires, revoke action
 * - "New Token" modal: name + scopes checkboxes + expiry
 * - Post-create modal: one-time plaintext token display with copy button
 * - `/admin/docs/api-reference` deep-link to Redocly-rendered API docs
 */

import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AdminStateService } from '../admin-state.service';
import { ToastService } from '../../../services/toast.service';

interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface CreateTokenResponse {
  token: ApiToken;
  plaintext: string;
  warning: string;
}

const ALL_SCOPES = [
  { key: 'sites:read', label: 'Sites — read', description: 'List and get site data' },
  { key: 'sites:write', label: 'Sites — write', description: 'Create, update, delete, deploy' },
  { key: 'media:read', label: 'Media — read', description: 'List media assets' },
  { key: 'media:write', label: 'Media — write', description: 'Upload and delete media' },
  { key: 'forms:read', label: 'Forms — read', description: 'Read form submissions' },
  { key: 'analytics:read', label: 'Analytics — read', description: 'Read analytics data' },
];

@Component({
  selector: 'app-admin-api-tokens',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule],
  template: `
    <div class="api-tokens-root" role="main">
      <!-- Header -->
      <div class="at-header" appReveal>
        <div class="at-title-row">
          <div>
            <div class="at-eyebrow">Developer</div>
            <h1 class="at-heading">API Tokens</h1>
            <p class="at-sub">Authenticate programmatic access with scoped Bearer tokens.</p>
          </div>
          <div class="at-header-actions">
            <a routerLink="/admin/docs/api-reference" class="at-btn-ghost">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              API Docs
            </a>
            <button class="at-btn-primary" (click)="openCreateModal()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Token
            </button>
          </div>
        </div>

        <!-- Stat chips -->
        <div class="at-stats-row" appReveal>
          <div class="at-stat-chip">
            <span class="at-stat-value">{{ tokens().length }}</span>
            <span class="at-stat-label">active tokens</span>
          </div>
          <div class="at-stat-chip">
            <span class="at-stat-value">{{ scopeCount() }}</span>
            <span class="at-stat-label">scopes available</span>
          </div>
          <div class="at-stat-chip">
            <a href="/v1/openapi.json" target="_blank" rel="noopener noreferrer" class="at-openapi-link">OpenAPI 3.1 spec ↗</a>
          </div>
        </div>
      </div>

      <!-- Feature-disabled banner -->
      @if (flagDisabled()) {
        <div class="at-flag-banner" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Public API v1 is disabled. Enable the <strong>public_api_v1</strong> feature flag in
          <a routerLink="/admin/feature-flags">Feature Flags</a> to activate.
        </div>
      }

      <!-- Loading -->
      @if (loading()) {
        <div class="at-loading">
          <div class="at-spinner"></div>
          <span>Loading tokens…</span>
        </div>
      }

      <!-- Token list -->
      @if (!loading() && tokens().length > 0) {
        <div class="at-table-wrap" appReveal>
          <table class="at-table" aria-label="API tokens">
            <thead>
              <tr>
                <th>Name</th>
                <th>Scopes</th>
                <th>Last used</th>
                <th>Expires</th>
                <th>Created</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              @for (token of tokens(); track token.id) {
                <tr class="at-row">
                  <td class="at-name-cell">
                    <span class="at-token-name">{{ token.name }}</span>
                    <span class="at-token-id">{{ token.id.slice(0, 8) }}…</span>
                  </td>
                  <td class="at-scopes-cell">
                    @for (scope of token.scopes; track scope) {
                      <span class="at-scope-pill">{{ scope }}</span>
                    }
                  </td>
                  <td class="at-meta-cell">{{ token.last_used_at ? formatRelative(token.last_used_at) : '—' }}</td>
                  <td class="at-meta-cell">{{ token.expires_at ? formatDate(token.expires_at) : 'Never' }}</td>
                  <td class="at-meta-cell">{{ formatDate(token.created_at) }}</td>
                  <td class="at-actions-cell">
                    <button class="at-btn-revoke" (click)="confirmRevoke(token)" [attr.aria-label]="'Revoke token ' + token.name">
                      Revoke
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <!-- Empty state -->
      @if (!loading() && tokens().length === 0) {
        <div class="at-empty" appReveal>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--ps-accent)" stroke-width="1.5" opacity="0.4"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <p>No API tokens yet.</p>
          <button class="at-btn-primary" (click)="openCreateModal()">Create your first token</button>
        </div>
      }

      <!-- Quick-start code snippet -->
      @if (tokens().length > 0) {
        <div class="at-quickstart" appReveal>
          <div class="at-qs-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            Quick start
          </div>
          <pre class="at-code"><code>curl https://projectsites.dev/v1/sites \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"</code></pre>
          <div class="at-qs-footer">
            <a href="/v1/openapi.json" target="_blank" rel="noopener noreferrer" class="at-link">Full API reference ↗</a>
          </div>
        </div>
      }
    </div>

    <!-- Create Token Modal -->
    @if (showCreateModal()) {
      <div class="at-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="create-modal-title" (keydown.escape)="closeCreateModal()">
        <div class="at-modal">
          <div class="at-modal-header">
            <h2 id="create-modal-title">New API Token</h2>
            <button class="at-modal-close" (click)="closeCreateModal()" aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="at-modal-body">
            <div class="at-field">
              <label class="at-label" for="token-name">Token name *</label>
              <input id="token-name" class="at-input" type="text" [(ngModel)]="newName" placeholder="e.g. CI Deploy Bot" autocomplete="off" />
            </div>

            <div class="at-field">
              <label class="at-label">Scopes</label>
              <div class="at-scopes-grid">
                @for (scope of availableScopes; track scope.key) {
                  <label class="at-scope-row">
                    <input type="checkbox" [checked]="selectedScopes().has(scope.key)" (change)="toggleScope(scope.key)" />
                    <span class="at-scope-info">
                      <span class="at-scope-key">{{ scope.label }}</span>
                      <span class="at-scope-desc">{{ scope.description }}</span>
                    </span>
                  </label>
                }
              </div>
            </div>

            <div class="at-field">
              <label class="at-label" for="token-expires">Expiry (optional)</label>
              <input id="token-expires" class="at-input" type="datetime-local" [(ngModel)]="newExpiry" />
            </div>
          </div>

          <div class="at-modal-footer">
            <button class="at-btn-ghost" (click)="closeCreateModal()">Cancel</button>
            <button class="at-btn-primary" (click)="createToken()" [disabled]="creating() || !newName.trim()">
              {{ creating() ? 'Creating…' : 'Create Token' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Reveal Modal (one-time plaintext) -->
    @if (createdToken()) {
      <div class="at-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="reveal-modal-title">
        <div class="at-modal at-modal--reveal">
          <div class="at-modal-header">
            <h2 id="reveal-modal-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              Token created
            </h2>
          </div>
          <div class="at-modal-body">
            <div class="at-warning-box" role="alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Store this token securely — it will <strong>not</strong> be shown again.
            </div>
            <div class="at-token-reveal">
              <code class="at-token-text">{{ createdToken()?.plaintext }}</code>
              <button class="at-copy-btn" (click)="copyToken()" [attr.aria-label]="'Copy token'">
                {{ copied() ? '✓ Copied' : 'Copy' }}
              </button>
            </div>
          </div>
          <div class="at-modal-footer">
            <button class="at-btn-primary" (click)="clearCreatedToken()" autofocus>Done — I've saved this token</button>
          </div>
        </div>
      </div>
    }

    <!-- Revoke confirm modal -->
    @if (revokeTarget()) {
      <div class="at-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="revoke-modal-title">
        <div class="at-modal at-modal--danger">
          <div class="at-modal-header">
            <h2 id="revoke-modal-title">Revoke "{{ revokeTarget()?.name }}"?</h2>
          </div>
          <div class="at-modal-body">
            <p>Any integrations using this token will stop working immediately.</p>
          </div>
          <div class="at-modal-footer">
            <button class="at-btn-ghost" (click)="revokeTarget.set(null)">Cancel</button>
            <button class="at-btn-danger" (click)="revokeToken()" [disabled]="revoking()">
              {{ revoking() ? 'Revoking…' : 'Yes, revoke' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .api-tokens-root { padding: 28px 32px; max-width: 960px; }
    .at-header { margin-bottom: 28px; }
    .at-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
    .at-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--ps-accent); margin-bottom: 4px; }
    .at-heading { font-size: 24px; font-weight: 700; margin: 0 0 4px; color: var(--ps-ink); }
    .at-sub { font-size: 13px; color: rgba(244,244,255,0.55); margin: 0; }
    .at-header-actions { display: flex; gap: 10px; align-items: center; flex-shrink: 0; }
    .at-stats-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .at-stat-chip { background: rgba(0,229,255,0.06); border: 1px solid rgba(0,229,255,0.15); border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; gap: 2px; }
    .at-stat-value { font-size: 20px; font-weight: 700; color: var(--ps-accent); font-variant-numeric: tabular-nums; }
    .at-stat-label { font-size: 11px; color: rgba(244,244,255,0.45); text-transform: uppercase; letter-spacing: 0.5px; }
    .at-openapi-link { font-size: 12px; color: var(--ps-accent); text-decoration: none; display: flex; align-items: center; gap: 4px; }
    .at-flag-banner { background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.25); border-radius: 10px; padding: 12px 16px; font-size: 13px; color: rgba(244,244,255,0.8); display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
    .at-flag-banner a { color: var(--ps-accent); text-decoration: none; }
    .at-loading { display: flex; align-items: center; gap: 10px; color: rgba(244,244,255,0.5); font-size: 13px; padding: 32px 0; }
    .at-spinner { width: 18px; height: 18px; border: 2px solid rgba(0,229,255,0.2); border-top-color: var(--ps-accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .at-table-wrap { border: 1px solid rgba(0,229,255,0.1); border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.02); }
    .at-table { width: 100%; border-collapse: collapse; }
    .at-table th { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(244,244,255,0.4); padding: 10px 14px; text-align: left; background: rgba(0,229,255,0.03); border-bottom: 1px solid rgba(0,229,255,0.08); }
    .at-row { border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.15s; }
    .at-row:last-child { border-bottom: none; }
    .at-row:hover { background: rgba(0,229,255,0.03); }
    .at-table td { padding: 10px 14px; font-size: 13px; vertical-align: middle; }
    .at-name-cell { display: table-cell; }
    .at-token-name { display: block; font-weight: 600; color: var(--ps-ink); font-size: 13px; }
    .at-token-id { display: block; font-size: 11px; color: rgba(244,244,255,0.35); font-family: 'JetBrains Mono', monospace; margin-top: 1px; }
    .at-scopes-cell { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 10px 14px; }
    .at-scope-pill { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: rgba(0,229,255,0.1); border: 1px solid rgba(0,229,255,0.2); color: var(--ps-accent); font-family: 'JetBrains Mono', monospace; letter-spacing: 0.3px; }
    .at-meta-cell { color: rgba(244,244,255,0.55); font-size: 12px; }
    .at-actions-cell { text-align: right; white-space: nowrap; }
    .at-btn-revoke { font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 6px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); color: #ef4444; cursor: pointer; transition: background 0.15s; }
    .at-btn-revoke:hover { background: rgba(239,68,68,0.15); }
    .at-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 60px 0; color: rgba(244,244,255,0.4); font-size: 14px; }
    .at-quickstart { margin-top: 24px; border: 1px solid rgba(0,229,255,0.1); border-radius: 12px; overflow: hidden; }
    .at-qs-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; font-size: 12px; font-weight: 600; color: rgba(244,244,255,0.55); background: rgba(0,229,255,0.03); border-bottom: 1px solid rgba(0,229,255,0.08); text-transform: uppercase; letter-spacing: 0.5px; }
    .at-code { margin: 0; padding: 16px 18px; background: rgba(6,6,16,0.7); font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ps-ink); overflow-x: auto; }
    .at-qs-footer { padding: 10px 14px; border-top: 1px solid rgba(0,229,255,0.08); background: rgba(0,229,255,0.02); }
    .at-link { font-size: 12px; color: var(--ps-accent); text-decoration: none; }
    .at-link:hover { text-decoration: underline; }
    .at-btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 8px; background: var(--ps-accent); color: #060610; font-size: 13px; font-weight: 700; border: none; cursor: pointer; transition: opacity 0.15s; }
    .at-btn-primary:hover:not(:disabled) { opacity: 0.88; }
    .at-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
    .at-btn-ghost { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 8px; background: transparent; color: rgba(244,244,255,0.7); font-size: 13px; font-weight: 600; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: background 0.15s; text-decoration: none; }
    .at-btn-ghost:hover { background: rgba(255,255,255,0.06); }
    .at-btn-danger { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 8px; background: rgba(239,68,68,0.15); color: #ef4444; font-size: 13px; font-weight: 700; border: 1px solid rgba(239,68,68,0.25); cursor: pointer; transition: background 0.15s; }
    .at-btn-danger:hover:not(:disabled) { background: rgba(239,68,68,0.25); }
    .at-btn-danger:disabled { opacity: 0.45; cursor: not-allowed; }
    .at-modal-backdrop { position: fixed; inset: 0; background: rgba(6,6,16,0.82); z-index: var(--ps-z-overlay-takeover, 100000); display: flex; align-items: center; justify-content: center; padding: 16px; backdrop-filter: blur(4px); }
    .at-modal { background: #0d0d20; border: 1px solid rgba(0,229,255,0.18); border-radius: 16px; width: 100%; max-width: 500px; box-shadow: 0 24px 64px rgba(0,0,0,0.6); }
    .at-modal--reveal { max-width: 560px; }
    .at-modal--danger .at-modal-header { border-bottom-color: rgba(239,68,68,0.15); }
    .at-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid rgba(0,229,255,0.1); }
    .at-modal-header h2 { margin: 0; font-size: 16px; font-weight: 700; color: var(--ps-ink); display: flex; align-items: center; gap: 8px; }
    .at-modal-close { background: none; border: none; color: rgba(244,244,255,0.45); cursor: pointer; padding: 4px; border-radius: 6px; }
    .at-modal-close:hover { color: var(--ps-ink); background: rgba(255,255,255,0.06); }
    .at-modal-body { padding: 20px; display: flex; flex-direction: column; gap: 18px; }
    .at-modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid rgba(0,229,255,0.08); }
    .at-field { display: flex; flex-direction: column; gap: 7px; }
    .at-label { font-size: 12px; font-weight: 600; color: rgba(244,244,255,0.6); text-transform: uppercase; letter-spacing: 0.4px; }
    .at-input { background: rgba(255,255,255,0.04); border: 1px solid rgba(0,229,255,0.15); border-radius: 8px; padding: 9px 12px; color: var(--ps-ink); font-size: 14px; outline: none; transition: border-color 0.15s; }
    .at-input:focus { border-color: var(--ps-accent); }
    .at-scopes-grid { display: flex; flex-direction: column; gap: 8px; }
    .at-scope-row { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); transition: background 0.12s; }
    .at-scope-row:hover { background: rgba(0,229,255,0.04); }
    .at-scope-row input { margin-top: 2px; accent-color: var(--ps-accent); width: 14px; height: 14px; flex-shrink: 0; }
    .at-scope-info { display: flex; flex-direction: column; gap: 2px; }
    .at-scope-key { font-size: 13px; font-weight: 600; color: var(--ps-ink); }
    .at-scope-desc { font-size: 11px; color: rgba(244,244,255,0.45); }
    .at-warning-box { display: flex; align-items: flex-start; gap: 8px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); border-radius: 8px; padding: 10px 14px; font-size: 12px; color: rgba(244,244,255,0.75); }
    .at-token-reveal { display: flex; align-items: center; gap: 10px; background: rgba(6,6,16,0.8); border: 1px solid rgba(0,229,255,0.15); border-radius: 10px; padding: 12px 16px; }
    .at-token-text { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ps-accent); flex: 1; word-break: break-all; }
    .at-copy-btn { flex-shrink: 0; padding: 6px 12px; border-radius: 6px; background: rgba(0,229,255,0.1); border: 1px solid rgba(0,229,255,0.2); color: var(--ps-accent); font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.15s; }
    .at-copy-btn:hover { background: rgba(0,229,255,0.18); }
  `],
})
export class AdminApiTokensComponent {
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  private adminState = inject(AdminStateService);

  tokens = signal<ApiToken[]>([]);
  loading = signal(true);
  flagDisabled = signal(false);

  showCreateModal = signal(false);
  creating = signal(false);
  newName = '';
  newExpiry = '';
  selectedScopes = signal<Set<string>>(new Set(['sites:read']));

  createdToken = signal<CreateTokenResponse | null>(null);
  copied = signal(false);

  revokeTarget = signal<ApiToken | null>(null);
  revoking = signal(false);

  readonly availableScopes = ALL_SCOPES;

  readonly scopeCount = computed(() => ALL_SCOPES.length);

  private get orgId(): string {
    return (this.adminState as unknown as { orgId?: () => string }).orgId?.() ?? '';
  }

  constructor() {
    effect(() => {
      this.loadTokens();
    });
  }

  private loadTokens(): void {
    this.loading.set(true);
    this.http
      .get<{ data: ApiToken[] }>('/api/v1-tokens', {
        headers: { 'x-org-id': this.orgId },
      })
      .subscribe({
        next: (res) => {
          this.tokens.set(res.data ?? []);
          this.loading.set(false);
          this.flagDisabled.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          if (err?.status === 503) {
            this.flagDisabled.set(true);
            this.tokens.set([]);
          } else {
            this.toast.show('Failed to load API tokens', 'error');
          }
        },
      });
  }

  openCreateModal(): void {
    this.newName = '';
    this.newExpiry = '';
    this.selectedScopes.set(new Set(['sites:read']));
    this.showCreateModal.set(true);
  }

  closeCreateModal(): void {
    this.showCreateModal.set(false);
  }

  toggleScope(key: string): void {
    const s = new Set(this.selectedScopes());
    if (s.has(key)) { s.delete(key); } else { s.add(key); }
    this.selectedScopes.set(s);
  }

  createToken(): void {
    if (!this.newName.trim() || this.creating()) return;
    this.creating.set(true);

    const body = {
      name: this.newName.trim(),
      scopes: Array.from(this.selectedScopes()),
      expires_at: this.newExpiry || null,
    };

    this.http
      .post<CreateTokenResponse>('/api/v1-tokens', body, {
        headers: { 'x-org-id': this.orgId },
      })
      .subscribe({
        next: (res) => {
          this.creating.set(false);
          this.showCreateModal.set(false);
          this.createdToken.set(res);
          this.loadTokens();
        },
        error: () => {
          this.creating.set(false);
          this.toast.show('Failed to create token', 'error');
        },
      });
  }

  clearCreatedToken(): void {
    this.createdToken.set(null);
    this.copied.set(false);
  }

  async copyToken(): Promise<void> {
    const t = this.createdToken();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t.plaintext);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      this.toast.show('Copy failed — select the token text manually', 'warning');
    }
  }

  confirmRevoke(token: ApiToken): void {
    this.revokeTarget.set(token);
  }

  revokeToken(): void {
    const t = this.revokeTarget();
    if (!t || this.revoking()) return;
    this.revoking.set(true);

    this.http
      .delete(`/api/v1-tokens/${t.id}`, { headers: { 'x-org-id': this.orgId } })
      .subscribe({
        next: () => {
          this.revoking.set(false);
          this.revokeTarget.set(null);
          this.toast.show(`Token "${t.name}" revoked`, 'success');
          this.loadTokens();
        },
        error: () => {
          this.revoking.set(false);
          this.toast.show('Failed to revoke token', 'error');
        },
      });
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatRelative(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days}d ago`;
    return this.formatDate(iso);
  }
}
