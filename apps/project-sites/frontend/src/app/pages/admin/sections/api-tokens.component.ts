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
 *   - hand-rolled `<table>`        → native `<table>` + TanStack headless table
 *                                     (createAngularTable; client-side sort)
 *   - 3× hand-rolled modal/backdrop → Spartan `<app-dialog-shell>` (the mandated
 *                                     one-dialog primitive: blur backdrop + CDK
 *                                     focus-trap + Esc-close + scroll-lock built in)
 *   - `<input type=text>`          → Spartan `hlmInput` directive
 *   - `<input type=datetime-local>`→ native `<input hlmInput type=datetime-local>` (Spartan)
 *   - scope `<input type=checkbox>`→ Spartan `hlmCheckbox` directive (cyan accent)
 *   - scope / action `<button>`s    → Spartan `hlmBtn` (variant + size; busy via [disabled]+at-spin)
 *   - scope pill `<span>`          → Spartan `hlmBadge` (variant=info, cockpit-tinted)
 * Toasts continue through the cockpit's existing `ToastService` (the cockpit
 * already renders its own toast layer) — the content-freshness section shows
 * the alternate PrimeNG `MessageService` path; both are documented in the guide.
 *
 * Surfaces:
 * - Header stats: active tokens, scopes available
 * - Token list table (native + TanStack): name, scopes, last used, expires, revoke action
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
import {
  createAngularTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
} from '@tanstack/angular-table';
import { DialogShellComponent } from '../../../components/dialog-shell/dialog-shell.component';
import { HlmBadgeDirective, HlmButtonDirective, HlmInputDirective, HlmCheckboxDirective } from '../../../ui';
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
    DialogShellComponent,
    HlmBadgeDirective,
    HlmButtonDirective,
    HlmInputDirective,
    HlmCheckboxDirective,
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
            <a hlmBtn variant="outline" size="sm" [routerLink]="'/admin/docs/api-reference'">
              <i class="pi pi-book" aria-hidden="true"></i> API Docs
            </a>
            <button hlmBtn variant="primary" size="sm" type="button" (click)="openCreateModal()">
              <i class="pi pi-plus" aria-hidden="true"></i> New Token
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
          <i class="pi pi-info-circle"></i>
          Public API v1 is disabled. Enable the <strong>public_api_v1</strong> feature flag in
          <a routerLink="/admin/feature-flags">Feature Flags</a> to activate.
        </div>
      }

      <!-- Token list (PrimeNG table) -->
      @if (!flagDisabled()) {
        <div class="at-table-wrap" appReveal>
          <table class="at-grid" data-testid="api-tokens-table">
            <thead>
              <tr>
                @for (header of table.getHeaderGroups()[0].headers; track header.id) {
                  @if (header.column.getCanSort()) {
                    <th
                      class="at-sortable"
                      [class.at-num-col]="header.id === 'scopes'"
                      role="button"
                      tabindex="0"
                      [attr.aria-sort]="ariaSort(header.column.getIsSorted())"
                      (click)="header.column.toggleSorting()"
                      (keydown.enter)="header.column.toggleSorting()"
                      (keydown.space)="header.column.toggleSorting(); $event.preventDefault()">
                      {{ headerLabel[header.id] }}
                      <span class="at-sort-ind" aria-hidden="true">{{ sortGlyph(header.column.getIsSorted()) }}</span>
                    </th>
                  } @else {
                    <th [class.at-actions-col]="header.id === 'actions'" [attr.aria-label]="header.id === 'actions' ? 'Actions' : null">{{ headerLabel[header.id] }}</th>
                  }
                }
              </tr>
            </thead>
            <tbody>
              @for (row of table.getRowModel().rows; track row.original.id) {
                <tr>
                  <td class="at-name-cell">
                    <span class="at-token-name">{{ row.original.name }}</span>
                    <span class="at-token-id">{{ row.original.id.slice(0, 8) }}…</span>
                  </td>
                  <td>
                    <div class="at-scopes-cell">
                      @for (scope of row.original.scopes; track scope) {
                        <span hlmBadge variant="info" class="at-scope-tag">{{ scope }}</span>
                      }
                    </div>
                  </td>
                  <td class="at-meta-cell">{{ row.original.last_used_at ? formatRelative(row.original.last_used_at) : '—' }}</td>
                  <td class="at-meta-cell">{{ row.original.expires_at ? formatDate(row.original.expires_at) : 'Never' }}</td>
                  <td class="at-meta-cell">{{ formatDate(row.original.created_at) }}</td>
                  <td class="at-actions-col">
                    <button hlmBtn variant="ghost" size="sm" type="button"
                      class="text-destructive"
                      (click)="confirmRevoke(row.original)"
                      [attr.aria-label]="'Revoke token ' + row.original.name">
                      Revoke
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6">
                    <div class="at-empty">
                      <i class="pi pi-key" style="font-size: 1.8rem; color: var(--ps-accent); opacity: .4"></i>
                      <p>No API tokens yet.</p>
                      <button hlmBtn variant="primary" size="sm" type="button" (click)="openCreateModal()">Create your first token</button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
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

    <!-- Create Token Dialog (Spartan DialogShell) -->
    @if (createModalVisible) {
    <app-dialog-shell title="New API Token" (closed)="closeCreateModal()">
      <div class="at-dialog-body">
        <div class="at-field">
          <label class="at-label" for="token-name">Token name *</label>
          <input id="token-name" hlmInput type="text" [(ngModel)]="newName" placeholder="e.g. CI Deploy Bot" autocomplete="off" class="w-full" />
        </div>

        <div class="at-field">
          <label class="at-label">Scopes</label>
          <div class="at-scopes-grid">
            @for (scope of availableScopes; track scope.key) {
              <label class="at-scope-row" [attr.for]="'scope-' + scope.key">
                <input
                  type="checkbox"
                  hlmCheckbox
                  [id]="'scope-' + scope.key"
                  [ngModel]="selectedScopes().has(scope.key)"
                  (ngModelChange)="toggleScope(scope.key)" />
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
          <input
            id="token-expires"
            hlmInput
            type="datetime-local"
            [(ngModel)]="newExpiry"
            [min]="nowLocal"
            placeholder="Never expires"
            class="w-full" />
          <span class="at-field-hint">Leave blank for a token that never expires.</span>
        </div>
      </div>
      <div footer>
        <button hlmBtn variant="ghost" size="sm" type="button" (click)="closeCreateModal()">Cancel</button>
        <button hlmBtn variant="primary" size="sm" type="button"
          [disabled]="creating() || !newName.trim()" (click)="createToken()">
          <i class="pi pi-key" aria-hidden="true" [class.at-spin]="creating()"></i>
          {{ creating() ? 'Creating…' : 'Create Token' }}
        </button>
      </div>
    </app-dialog-shell>
    }

    <!-- Reveal Dialog (one-time plaintext) -->
    @if (createdToken() !== null) {
    <app-dialog-shell title="Token created" (closed)="clearCreatedToken()">
      <div class="at-dialog-body">
        <div class="at-warning-box" role="alert">
          <i class="pi pi-exclamation-triangle" style="color:#ffd166"></i>
          Store this token securely — it will <strong>not</strong> be shown again.
        </div>
        <div class="at-token-reveal">
          <code class="at-token-text">{{ createdToken()?.plaintext }}</code>
          <button hlmBtn variant="outline" size="sm" type="button" (click)="copyToken()">
            {{ copied() ? '✓ Copied' : 'Copy' }}
          </button>
        </div>
      </div>
      <div footer>
        <button hlmBtn variant="primary" size="sm" type="button" (click)="clearCreatedToken()">Done — I've saved this token</button>
      </div>
    </app-dialog-shell>
    }

    <!-- Revoke confirm Dialog -->
    @if (revokeTarget() !== null) {
    <app-dialog-shell [title]="'Revoke ' + (revokeTarget()?.name ?? '') + '?'" (closed)="revokeTarget.set(null)">
      <div class="at-dialog-body">
        <p class="at-revoke-warn">Any integrations using this token will stop working immediately.</p>
      </div>
      <div footer>
        <button hlmBtn variant="ghost" size="sm" type="button" (click)="revokeTarget.set(null)">Cancel</button>
        <button hlmBtn variant="destructive" size="sm" type="button"
          [disabled]="revoking()" (click)="revokeToken()">
          {{ revoking() ? 'Revoking…' : 'Yes, revoke' }}
        </button>
      </div>
    </app-dialog-shell>
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

    /* Dialog body / fields (chrome handled by app-dialog-shell). */
    .at-dialog-body { display: flex; flex-direction: column; gap: 18px; }
    .at-dialog-title { display: inline-flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; color: var(--ps-ink); }
    .at-field { display: flex; flex-direction: column; gap: 7px; }
    .at-label { font-size: 12px; font-weight: 600; color: rgba(244,244,255,0.6); text-transform: uppercase; letter-spacing: 0.4px; }
    .at-field-hint { font-size: 11px; color: rgba(244,244,255,0.4); }
    /* Brighten the native datetime-local picker indicator on the dark cockpit. */
    input[type="datetime-local"]::-webkit-calendar-picker-indicator { filter: invert(0.85); cursor: pointer; }
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
    @media (prefers-reduced-motion: reduce) { .at-spinner, .at-spin { animation: none; } }

    /* Buttons are Spartan hlmBtn now — variants carry WCAG-correct ink on the
       cyan fill / outline natively, so the old ::ng-deep p-button contrast
       overrides are gone. Icon sizing + busy-spin for pi glyphs inside hlmBtn: */
    .at-header-actions .pi, .at-actions-col .pi, [hlmBtn] .pi { font-size: .72rem; }
    @keyframes at-spin { to { transform: rotate(360deg); } }
    .at-spin { display: inline-block; animation: at-spin .8s linear infinite; }

    /* ── Native cockpit table (TanStack headless drives sort; CSS is ours) ──── */
    .at-grid { width: 100%; min-width: 44rem; border-collapse: collapse; background: transparent; color: var(--ps-ink, #f4f4ff); }
    .at-grid thead > tr > th {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      padding: 10px 14px; font-weight: 600; text-align: left;
      background: rgba(0,229,255,0.04);
      color: rgba(244,244,255,0.6);
      border-bottom: 1px solid rgba(0,229,255,0.12);
    }
    .at-grid tbody > tr > td {
      padding: 10px 14px; font-size: 13px;
      border-bottom: 1px solid rgba(0,229,255,0.08);
    }
    .at-grid tbody > tr:last-child > td { border-bottom: 0; }
    .at-grid tbody > tr { transition: background 140ms; }
    .at-grid tbody > tr:hover > td { background: rgba(0,229,255,0.04); }
    /* Sortable header affordance. */
    .at-grid th.at-sortable { cursor: pointer; user-select: none; }
    .at-grid th.at-sortable:hover { color: var(--ps-accent, #00e5ff); }
    .at-grid th.at-sortable:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: -2px; }
    .at-sort-ind { margin-left: 4px; opacity: 0.5; font-size: 10px; }
    .at-grid th.at-sortable[aria-sort="ascending"] .at-sort-ind,
    .at-grid th.at-sortable[aria-sort="descending"] .at-sort-ind { opacity: 1; color: var(--ps-accent, #00e5ff); }
    .at-scope-tag {
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

  // ── TanStack headless table (client-side sort) ────────────────────────────
  /** Human header labels keyed by column id (template reads these). */
  readonly headerLabel: Record<string, string> = {
    name: 'Name', scopes: 'Scopes', last_used_at: 'Last used',
    expires_at: 'Expires', created_at: 'Created', actions: '',
  };
  private readonly sorting = signal<SortingState>([]);
  private readonly columns: ColumnDef<ApiToken>[] = [
    { id: 'name', accessorKey: 'name' },
    { id: 'scopes', enableSorting: false },
    { id: 'last_used_at', accessorKey: 'last_used_at' },
    { id: 'expires_at', accessorKey: 'expires_at' },
    { id: 'created_at', accessorKey: 'created_at' },
    { id: 'actions', enableSorting: false },
  ];
  readonly table = createAngularTable<ApiToken>(() => ({
    data: this.tokens(),
    columns: this.columns,
    state: { sorting: this.sorting() },
    onSortingChange: (updater) =>
      this.sorting.update((prev) => (typeof updater === 'function' ? updater(prev) : updater)),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  }));
  /** Map TanStack's `false | 'asc' | 'desc'` to an aria-sort token. */
  ariaSort(dir: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
    return dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';
  }
  /** Sort indicator glyph for the header. */
  sortGlyph(dir: false | 'asc' | 'desc'): string {
    return dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕';
  }

  /** Dialog visibility — DialogShell binds these via @if [open]/(closed). */
  createModalVisible = false;
  creating = signal(false);
  newName = '';
  /** Native datetime-local binds a `YYYY-MM-DDTHH:mm` string; '' = never expires. */
  newExpiry = '';
  /** Lower bound for the expiry picker — now, in the input's local format. */
  readonly nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
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
    this.newExpiry = '';
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
      expires_at: this.newExpiry ? new Date(this.newExpiry).toISOString() : null,
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
