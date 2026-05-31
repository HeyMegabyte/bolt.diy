/**
 * @component AdminApiTokensComponent
 * @description `/admin/api-tokens` — Public API v1 token management.
 *
 * Cyan/black compact design per [[cyan-black-compact-progression]].
 *
 * ── PrimeNG reference migration (form-heavy) ─────────────────────────────
 * This section is the canonical "form-heavy" PrimeNG migration example for the
 * cockpit (see `PRIMENG_MIGRATION.md`). It maps the former hand-rolled
 * patterns onto PrimeNG components, all themed black+cyan via `CockpitPreset`:
 *   - hand-rolled `<table>`        → `p-table` (sort + cockpit density)
 *   - 3× hand-rolled modal/backdrop → `p-dialog` (modal, focus-trap, esc-close,
 *                                     z-index, backdrop all handled for free)
 *   - `<input type=text>`          → `pInputText` directive
 *   - `<input type=datetime-local>`→ `p-datepicker` (showTime, cockpit popup)
 *   - scope `<input type=checkbox>`→ `p-checkbox` (binary, cyan accent)
 *   - scope / action `<button>`s    → `p-button` (severity + size + loading)
 *   - scope pill `<span>`          → `p-tag` (rounded, cockpit-tinted)
 * Toasts continue through the cockpit's existing `ToastService` (the cockpit
 * already renders its own toast layer) — the content-freshness section shows
 * the alternate PrimeNG `MessageService` path; both are documented in the guide.
 *
 * Surfaces:
 * - Header stats: active tokens, scopes available
 * - Token list table (p-table): name, scopes, last used, expires, revoke action
 * - "New Token" dialog: name + scopes checkboxes + expiry datepicker
 * - Post-create dialog: one-time plaintext token display with copy button
 * - Revoke-confirm dialog
 * - `/admin/docs/api-reference` deep-link to Redocly-rendered API docs
 */

import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { TagModule } from 'primeng/tag';
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
  imports: [
    RouterLink,
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    CheckboxModule,
    DatePickerModule,
    TagModule,
  ],
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
            <p-button
              [routerLink]="'/admin/docs/api-reference'"
              label="API Docs"
              icon="pi pi-book"
              severity="secondary"
              [outlined]="true"
              size="small" />
            <p-button
              label="New Token"
              icon="pi pi-plus"
              size="small"
              (onClick)="openCreateModal()" />
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
          <i class="pi pi-info-circle"></i>
          Public API v1 is disabled. Enable the <strong>public_api_v1</strong> feature flag in
          <a routerLink="/admin/feature-flags">Feature Flags</a> to activate.
        </div>
      }

      <!-- Token list (PrimeNG table) -->
      @if (!flagDisabled()) {
        <div class="at-table-wrap" appReveal>
          <p-table
            [value]="tokens()"
            [loading]="loading()"
            dataKey="id"
            styleClass="at-grid p-datatable-sm"
            [tableStyle]="{ 'min-width': '44rem' }"
            data-testid="api-tokens-table">
            <ng-template #header>
              <tr>
                <th pSortableColumn="name">Name <p-sortIcon field="name" /></th>
                <th>Scopes</th>
                <th pSortableColumn="last_used_at">Last used <p-sortIcon field="last_used_at" /></th>
                <th pSortableColumn="expires_at">Expires <p-sortIcon field="expires_at" /></th>
                <th pSortableColumn="created_at">Created <p-sortIcon field="created_at" /></th>
                <th class="at-actions-col" aria-label="Actions"></th>
              </tr>
            </ng-template>
            <ng-template #body let-token>
              <tr>
                <td class="at-name-cell">
                  <span class="at-token-name">{{ token.name }}</span>
                  <span class="at-token-id">{{ token.id.slice(0, 8) }}…</span>
                </td>
                <td>
                  <div class="at-scopes-cell">
                    @for (scope of token.scopes; track scope) {
                      <p-tag [value]="scope" severity="info" [rounded]="true" styleClass="at-scope-tag" />
                    }
                  </div>
                </td>
                <td class="at-meta-cell">{{ token.last_used_at ? formatRelative(token.last_used_at) : '—' }}</td>
                <td class="at-meta-cell">{{ token.expires_at ? formatDate(token.expires_at) : 'Never' }}</td>
                <td class="at-meta-cell">{{ formatDate(token.created_at) }}</td>
                <td class="at-actions-col">
                  <p-button
                    label="Revoke"
                    severity="danger"
                    [text]="true"
                    size="small"
                    (onClick)="confirmRevoke(token)"
                    [attr.aria-label]="'Revoke token ' + token.name" />
                </td>
              </tr>
            </ng-template>
            <ng-template #emptymessage>
              <tr>
                <td colspan="6">
                  <div class="at-empty">
                    <i class="pi pi-key" style="font-size: 1.8rem; color: var(--ps-accent); opacity: .4"></i>
                    <p>No API tokens yet.</p>
                    <p-button label="Create your first token" size="small" (onClick)="openCreateModal()" />
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      }

      <!-- Quick-start code snippet -->
      @if (tokens().length > 0) {
        <div class="at-quickstart" appReveal>
          <div class="at-qs-header">
            <i class="pi pi-code"></i>
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

    <!-- Create Token Dialog (PrimeNG) -->
    <p-dialog
      header="New API Token"
      [(visible)]="createModalVisible"
      [modal]="true"
      [style]="{ width: '32rem' }"
      [draggable]="false"
      [dismissableMask]="true"
      (onHide)="closeCreateModal()"
      styleClass="at-dialog">
      <div class="at-dialog-body">
        <div class="at-field">
          <label class="at-label" for="token-name">Token name *</label>
          <input id="token-name" pInputText type="text" [(ngModel)]="newName" placeholder="e.g. CI Deploy Bot" autocomplete="off" class="w-full" />
        </div>

        <div class="at-field">
          <label class="at-label">Scopes</label>
          <div class="at-scopes-grid">
            @for (scope of availableScopes; track scope.key) {
              <label class="at-scope-row">
                <p-checkbox
                  [binary]="true"
                  [ngModel]="selectedScopes().has(scope.key)"
                  (ngModelChange)="toggleScope(scope.key)"
                  [inputId]="'scope-' + scope.key" />
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
          <p-datepicker
            inputId="token-expires"
            [(ngModel)]="newExpiry"
            [showTime]="true"
            [showIcon]="true"
            dateFormat="yy-mm-dd"
            placeholder="Never expires"
            appendTo="body"
            styleClass="w-full" />
        </div>
      </div>
      <ng-template #footer>
        <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="closeCreateModal()" />
        <p-button
          label="Create Token"
          [loading]="creating()"
          [disabled]="!newName.trim()"
          (onClick)="createToken()" />
      </ng-template>
    </p-dialog>

    <!-- Reveal Dialog (one-time plaintext) -->
    <p-dialog
      [(visible)]="revealVisible"
      [modal]="true"
      [closable]="false"
      [style]="{ width: '34rem' }"
      [draggable]="false"
      styleClass="at-dialog">
      <ng-template #header>
        <span class="at-dialog-title"><i class="pi pi-check-circle" style="color:#4dffb5"></i> Token created</span>
      </ng-template>
      <div class="at-dialog-body">
        <div class="at-warning-box" role="alert">
          <i class="pi pi-exclamation-triangle" style="color:#ffd166"></i>
          Store this token securely — it will <strong>not</strong> be shown again.
        </div>
        <div class="at-token-reveal">
          <code class="at-token-text">{{ createdToken()?.plaintext }}</code>
          <p-button
            [label]="copied() ? '✓ Copied' : 'Copy'"
            severity="secondary"
            [outlined]="true"
            size="small"
            (onClick)="copyToken()" />
        </div>
      </div>
      <ng-template #footer>
        <p-button label="Done — I've saved this token" (onClick)="clearCreatedToken()" />
      </ng-template>
    </p-dialog>

    <!-- Revoke confirm Dialog -->
    <p-dialog
      [(visible)]="revokeVisible"
      [modal]="true"
      [style]="{ width: '26rem' }"
      [draggable]="false"
      [dismissableMask]="true"
      (onHide)="revokeTarget.set(null)"
      styleClass="at-dialog">
      <ng-template #header>
        <span class="at-dialog-title">Revoke "{{ revokeTarget()?.name }}"?</span>
      </ng-template>
      <div class="at-dialog-body">
        <p class="at-revoke-warn">Any integrations using this token will stop working immediately.</p>
      </div>
      <ng-template #footer>
        <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="revokeTarget.set(null)" />
        <p-button label="Yes, revoke" severity="danger" [loading]="revoking()" (onClick)="revokeToken()" />
      </ng-template>
    </p-dialog>
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
    .at-stat-chip { background: var(--ps-accent-soft, rgba(0,229,255,0.06)); border: 1px solid var(--ps-accent-line, rgba(0,229,255,0.15)); border-radius: 8px; padding: 8px 14px; display: flex; flex-direction: column; gap: 2px; }
    .at-stat-value { font-size: 20px; font-weight: 700; color: var(--ps-accent); font-variant-numeric: tabular-nums; }
    .at-stat-label { font-size: 11px; color: rgba(244,244,255,0.45); text-transform: uppercase; letter-spacing: 0.5px; }
    .at-openapi-link { font-size: 12px; color: var(--ps-accent); text-decoration: none; display: flex; align-items: center; gap: 4px; }
    .at-flag-banner { background: rgba(255,209,102,0.08); border: 1px solid rgba(255,209,102,0.25); border-radius: 10px; padding: 12px 16px; font-size: 13px; color: rgba(244,244,255,0.8); display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
    .at-flag-banner a { color: var(--ps-accent); text-decoration: none; }
    .at-table-wrap { border: 1px solid var(--ps-accent-line, rgba(0,229,255,0.1)); border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.02); }
    .at-name-cell { display: table-cell; }
    .at-token-name { display: block; font-weight: 600; color: var(--ps-ink); font-size: 13px; }
    .at-token-id { display: block; font-size: 11px; color: rgba(244,244,255,0.35); font-family: 'JetBrains Mono', monospace; margin-top: 1px; }
    .at-scopes-cell { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .at-meta-cell { color: rgba(244,244,255,0.55); font-size: 12px; }
    .at-actions-col { text-align: right; white-space: nowrap; }
    .at-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 0; color: rgba(244,244,255,0.4); font-size: 14px; }
    .at-quickstart { margin-top: 24px; border: 1px solid var(--ps-accent-line, rgba(0,229,255,0.1)); border-radius: 12px; overflow: hidden; }
    .at-qs-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; font-size: 12px; font-weight: 600; color: rgba(244,244,255,0.55); background: rgba(0,229,255,0.03); border-bottom: 1px solid rgba(0,229,255,0.08); text-transform: uppercase; letter-spacing: 0.5px; }
    .at-code { margin: 0; padding: 16px 18px; background: rgba(6,6,16,0.7); font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ps-ink); overflow-x: auto; }
    .at-qs-footer { padding: 10px 14px; border-top: 1px solid rgba(0,229,255,0.08); background: rgba(0,229,255,0.02); }
    .at-link { font-size: 12px; color: var(--ps-accent); text-decoration: none; }
    .at-link:hover { text-decoration: underline; }

    /* Dialog body / fields (chrome handled by p-dialog + CockpitPreset). */
    .at-dialog-body { display: flex; flex-direction: column; gap: 18px; }
    .at-dialog-title { display: inline-flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; color: var(--ps-ink); }
    .at-field { display: flex; flex-direction: column; gap: 7px; }
    .at-label { font-size: 12px; font-weight: 600; color: rgba(244,244,255,0.6); text-transform: uppercase; letter-spacing: 0.4px; }
    .at-scopes-grid { display: flex; flex-direction: column; gap: 8px; }
    .at-scope-row { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); transition: background 0.12s; }
    .at-scope-row:hover { background: rgba(0,229,255,0.04); }
    .at-scope-info { display: flex; flex-direction: column; gap: 2px; }
    .at-scope-key { font-size: 13px; font-weight: 600; color: var(--ps-ink); }
    .at-scope-desc { font-size: 11px; color: rgba(244,244,255,0.45); }
    .at-warning-box { display: flex; align-items: flex-start; gap: 8px; background: rgba(255,209,102,0.08); border: 1px solid rgba(255,209,102,0.2); border-radius: 8px; padding: 10px 14px; font-size: 12px; color: rgba(244,244,255,0.75); }
    .at-token-reveal { display: flex; align-items: center; gap: 10px; background: rgba(6,6,16,0.8); border: 1px solid rgba(0,229,255,0.15); border-radius: 10px; padding: 12px 16px; }
    .at-token-text { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ps-accent); flex: 1; word-break: break-all; }
    .at-revoke-warn { font-size: 13px; color: rgba(244,244,255,0.7); margin: 0; }
    @media (prefers-reduced-motion: reduce) { .at-spinner { animation: none; } }

    /* ── Cockpit dark surface + density for the PrimeNG table ──────────────
       PrimeNG's default datatable theme renders on a LIGHT surface, which broke
       the dark cockpit here (white table on a black dashboard). Force every
       part onto a transparent/dark surface — these unlayered ::ng-deep rules
       win the cascade over PrimeNG's theme. */
    :host ::ng-deep .at-grid,
    :host ::ng-deep .at-grid .p-datatable-table,
    :host ::ng-deep .at-grid .p-datatable-tbody > tr {
      background: transparent;
      color: var(--ps-ink, #f4f4ff);
    }
    :host ::ng-deep .at-grid .p-datatable-thead > tr > th {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      padding: 10px 14px; font-weight: 600;
      background: rgba(0,229,255,0.04);
      color: rgba(244,244,255,0.6);
      border-color: rgba(0,229,255,0.12);
    }
    :host ::ng-deep .at-grid .p-datatable-tbody > tr > td {
      padding: 10px 14px; font-size: 13px;
      background: transparent;
      color: var(--ps-ink, #f4f4ff);
      border-color: rgba(0,229,255,0.08);
    }
    :host ::ng-deep .at-grid .p-datatable-tbody > tr:hover > td { background: rgba(0,229,255,0.04); }
    :host ::ng-deep .at-scope-tag {
      font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.3px;
    }
  `],
})
export class AdminApiTokensComponent {
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  private adminState = inject(AdminStateService);

  tokens = signal<ApiToken[]>([]);
  loading = signal(true);
  flagDisabled = signal(false);

  /** p-dialog visibility flags (two-way bound to `[(visible)]`). */
  createModalVisible = false;
  creating = signal(false);
  newName = '';
  /** p-datepicker binds a Date | null; serialized to ISO on submit. */
  newExpiry: Date | null = null;
  selectedScopes = signal<Set<string>>(new Set(['sites:read']));

  createdToken = signal<CreateTokenResponse | null>(null);
  /** Derived dialog visibility — mirrors the createdToken signal. */
  get revealVisible(): boolean { return this.createdToken() !== null; }
  set revealVisible(v: boolean) { if (!v) this.clearCreatedToken(); }
  copied = signal(false);

  revokeTarget = signal<ApiToken | null>(null);
  get revokeVisible(): boolean { return this.revokeTarget() !== null; }
  set revokeVisible(v: boolean) { if (!v) this.revokeTarget.set(null); }
  revoking = signal(false);

  readonly availableScopes = ALL_SCOPES;

  readonly scopeCount = computed(() => ALL_SCOPES.length);

  /** Reactive org id from the shared admin state (hydrated from /api/auth/me). */
  private get orgId(): string {
    return this.adminState.orgId();
  }

  constructor() {
    // Reads `orgId()` synchronously via loadTokens → the effect re-fires once
    // the shared state hydrates the org id, so the first paint isn't stuck
    // sending an empty `x-org-id` (which the worker 401s).
    effect(() => {
      this.loadTokens();
    });
  }

  private loadTokens(): void {
    const orgId = this.orgId; // tracked by the effect — re-runs when it hydrates
    if (!orgId) {
      // Org id not ready yet; the effect will re-run when it resolves. Avoid
      // firing a guaranteed-401 request with an empty header.
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.http
      .get<{ data: ApiToken[] }>('/api/v1-tokens', {
        headers: { 'x-org-id': orgId },
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
    this.newExpiry = null;
    this.selectedScopes.set(new Set(['sites:read']));
    this.createModalVisible = true;
  }

  closeCreateModal(): void {
    this.createModalVisible = false;
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
      expires_at: this.newExpiry ? this.newExpiry.toISOString() : null,
    };

    this.http
      .post<CreateTokenResponse>('/api/v1-tokens', body, {
        headers: { 'x-org-id': this.orgId },
      })
      .subscribe({
        next: (res) => {
          this.creating.set(false);
          this.createModalVisible = false;
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
