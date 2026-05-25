import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { DialogShellComponent } from '../dialog-shell/dialog-shell.component';

/** Public-facing env var shape mirroring `services/ai_env_vars.ts → EnvVar`. */
export interface EnvVarDto {
  id: string;
  org_id: string;
  scope: 'org' | 'site' | 'mcp';
  site_id: string | null;
  mcp_provider: string | null;
  key: string;
  value_masked: string;
  description: string | null;
  is_secret: boolean;
  exposed_to_ai: boolean;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

interface NewVarDraft {
  key: string;
  value: string;
  description: string;
  isSecret: boolean;
  exposedToAi: boolean;
  showValue: boolean;
}

const EMPTY_DRAFT: NewVarDraft = {
  key: '',
  value: '',
  description: '',
  isSecret: true,
  exposedToAi: true,
  showValue: false,
};

/**
 * Per-scope AI Env Vars manager. Renders a table of existing vars + inline
 * add/edit row + import/export modal. Mounts under Settings (org-scope) and
 * per-MCP (mcp-scope). Site-scope reserved for future per-site overrides.
 */
@Component({
  selector: 'app-env-vars-manager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DialogShellComponent],
  template: `
    <section
      class="ev-shell"
      [attr.aria-label]="ariaLabel()"
      [attr.data-scope]="scope()"
    >
      <header class="ev-head">
        <div class="ev-head-text">
          <div class="ev-kicker">Scope · {{ scope() }}{{ scopeSuffix() }}</div>
          <h4 class="ev-title">Custom environment variables</h4>
          <p class="ev-sub">
            Encrypted at rest. Exposed-to-AI vars flow into LLM tool calls + MCP requests for this scope.
          </p>
        </div>
        <div class="ev-head-actions">
          <button type="button" class="ev-btn-ghost" (click)="openImport()" aria-label="Import .env file">
            Import .env
          </button>
          <button type="button" class="ev-btn-ghost" (click)="exportDotenv()" aria-label="Download .env">
            Export .env
          </button>
          <button
            type="button"
            class="ev-btn-primary"
            (click)="startAdd()"
            [disabled]="addingOpen()"
            aria-label="Add a new environment variable"
          >
            + Add variable
          </button>
        </div>
      </header>

      <!-- Add / inline edit row -->
      @if (addingOpen()) {
        <form class="ev-form" (submit)="saveDraft($event)" aria-label="New env var form">
          <div class="ev-form-grid">
            <label class="ev-field">
              <span class="ev-muted">Key</span>
              <input
                type="text"
                class="ev-input ev-mono"
                placeholder="API_TOKEN"
                [(ngModel)]="draft.key"
                name="key"
                autocomplete="off"
                spellcheck="false"
                required
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                aria-required="true"
                aria-label="Variable key"
              />
            </label>
            <label class="ev-field">
              <span class="ev-muted">Value</span>
              <div class="ev-value-row">
                <input
                  [type]="draft.showValue ? 'text' : 'password'"
                  class="ev-input ev-mono"
                  placeholder="••••"
                  [(ngModel)]="draft.value"
                  name="value"
                  autocomplete="off"
                  spellcheck="false"
                  required
                  aria-label="Variable value"
                />
                <button
                  type="button"
                  class="ev-icon-btn"
                  (click)="draft.showValue = !draft.showValue"
                  [attr.aria-label]="draft.showValue ? 'Hide value' : 'Show value'"
                >
                  {{ draft.showValue ? 'Hide' : 'Show' }}
                </button>
              </div>
            </label>
            <label class="ev-field ev-col-span">
              <span class="ev-muted">Description (optional)</span>
              <textarea
                class="ev-input"
                rows="2"
                placeholder="What this variable is used for"
                [(ngModel)]="draft.description"
                name="description"
                aria-label="Description"
              ></textarea>
            </label>
            <label class="ev-flag">
              <input type="checkbox" [(ngModel)]="draft.isSecret" name="isSecret" />
              <span>Secret (mask value in UI)</span>
            </label>
            <label class="ev-flag">
              <input type="checkbox" [(ngModel)]="draft.exposedToAi" name="exposedToAi" />
              <span>Expose to AI</span>
            </label>
          </div>
          <div class="ev-form-actions">
            <button type="button" class="ev-btn-ghost" (click)="cancelAdd()">Cancel</button>
            <button type="submit" class="ev-btn-primary" [disabled]="saving()">
              {{ saving() ? 'Saving…' : 'Save variable' }}
            </button>
          </div>
        </form>
      }

      <!-- Table -->
      @if (loading() && vars().length === 0) {
        <div class="ev-empty" aria-busy="true">Loading…</div>
      } @else if (vars().length === 0) {
        <div class="ev-empty">
          <p>No env vars yet. Click <strong>+ Add variable</strong> to create one.</p>
        </div>
      } @else {
        <div class="ev-table-wrap" role="region" aria-label="Env vars table">
          <table class="ev-table">
            <thead>
              <tr>
                <th class="ev-th">Key</th>
                <th class="ev-th">Value</th>
                <th class="ev-th">Description</th>
                <th class="ev-th ev-th-center">AI</th>
                <th class="ev-th ev-th-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (v of vars(); track v.id) {
                <tr class="ev-tr">
                  <td class="ev-td ev-mono ev-key">{{ v.key }}</td>
                  <td class="ev-td ev-mono ev-value">{{ v.value_masked }}</td>
                  <td class="ev-td ev-desc" [title]="v.description ?? ''">
                    {{ truncate(v.description, 60) }}
                  </td>
                  <td class="ev-td ev-th-center">
                    <button
                      type="button"
                      class="ev-chip"
                      [class.is-on]="v.exposed_to_ai"
                      (click)="toggleExposedToAi(v)"
                      [attr.aria-label]="v.exposed_to_ai ? 'Disable AI exposure for ' + v.key : 'Enable AI exposure for ' + v.key"
                      [attr.aria-pressed]="v.exposed_to_ai"
                    >
                      {{ v.exposed_to_ai ? 'On' : 'Off' }}
                    </button>
                  </td>
                  <td class="ev-td ev-th-right">
                    <button
                      type="button"
                      class="ev-link"
                      (click)="startEdit(v)"
                      [attr.aria-label]="'Edit ' + v.key"
                    >Edit</button>
                    <button
                      type="button"
                      class="ev-link ev-link-danger"
                      (click)="remove(v)"
                      [attr.aria-label]="'Delete ' + v.key"
                    >Delete</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .ev-shell {
      background: rgba(255,255,255,0.02);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 14%, transparent);
      border-radius: var(--ps-radius-xl, 22px);
      padding: 1.25rem;
      color: var(--ps-ink, #f4f4ff);
      box-shadow: var(--ps-shadow-modal, inset 0 0 0 1px rgba(255,255,255,0.02));
    }
    .ev-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .ev-head-text { min-width: 0; flex: 1; }
    .ev-kicker { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.1em; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); font-weight: 700; }
    .ev-title { margin: 0.25rem 0 0.25rem; font-family: 'Sora', system-ui, sans-serif; font-weight: 600; font-size: 0.95rem; letter-spacing: -0.01em; }
    .ev-sub { margin: 0; font-size: 0.7rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }
    .ev-head-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .ev-btn-primary, .ev-btn-ghost {
      padding: 0.42rem 0.85rem;
      border-radius: 8px;
      font-size: 0.74rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
    }
    .ev-btn-primary {
      background: linear-gradient(135deg, #00ffc8, var(--ps-accent, #00d4ff));
      color: var(--ps-bg, #060610);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00d4ff) 40%, transparent);
    }
    .ev-btn-primary:hover:not(:disabled) { transform: translateY(-1px); }
    .ev-btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }
    .ev-btn-ghost {
      background: transparent;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent);
      border: 1px solid rgba(255,255,255,0.12);
    }
    .ev-btn-ghost:hover { border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 35%, transparent); color: var(--ps-ink, #f4f4ff); }
    @media (prefers-reduced-motion: reduce) {
      .ev-btn-primary, .ev-btn-ghost { transition: none; }
      .ev-btn-primary:hover { transform: none; }
    }
    .ev-form {
      background: rgba(255,255,255,0.025);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 18%, transparent);
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .ev-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    .ev-col-span { grid-column: 1 / -1; }
    .ev-field { display: flex; flex-direction: column; gap: 0.25rem; }
    .ev-flag { display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.74rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent); }
    .ev-muted { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }
    .ev-input {
      padding: 0.45rem 0.7rem;
      border-radius: 8px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.1);
      color: var(--ps-ink, #f4f4ff);
      font: inherit;
      width: 100%;
    }
    .ev-input:focus { outline: none; border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 45%, transparent); }
    .ev-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; }
    .ev-value-row { display: flex; gap: 0.4rem; }
    .ev-icon-btn {
      padding: 0.35rem 0.6rem;
      border-radius: 6px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      color: var(--ps-ink, #f4f4ff);
      font-size: 0.66rem;
      cursor: pointer;
    }
    .ev-form-actions { display: flex; justify-content: flex-end; gap: 0.4rem; margin-top: 0.85rem; }
    .ev-table-wrap { overflow-x: auto; }
    .ev-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
    .ev-th { text-align: left; padding: 0.55rem 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.06); color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); font-weight: 600; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.06em; }
    .ev-th-right { text-align: right; }
    .ev-th-center { text-align: center; }
    .ev-tr { border-bottom: 1px solid rgba(255,255,255,0.04); }
    .ev-tr:hover { background: rgba(255,255,255,0.02); }
    .ev-td { padding: 0.6rem; vertical-align: middle; }
    .ev-key { color: var(--ps-ink, #f4f4ff); font-weight: 600; }
    .ev-value { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent); }
    .ev-desc { color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); max-width: 260px; }
    .ev-link { color: var(--ps-accent, #00E5FF); background: none; border: 0; cursor: pointer; font-size: 0.74rem; padding: 0 0.3rem; }
    .ev-link:hover { text-decoration: underline; }
    .ev-link-danger { color: #f87171; }
    .ev-chip {
      padding: 2px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent);
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      cursor: pointer;
      text-transform: uppercase;
    }
    .ev-chip.is-on {
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 16%, transparent);
      color: var(--ps-accent, #00E5FF);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 35%, transparent);
    }
    .ev-empty {
      padding: 1.6rem 1rem;
      border-radius: 12px;
      background: rgba(255,255,255,0.02);
      border: 1px dashed rgba(255,255,255,0.08);
      text-align: center;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
      font-size: 0.78rem;
    }
    @media (max-width: 720px) {
      .ev-form-grid { grid-template-columns: 1fr; }
      .ev-head { flex-direction: column; align-items: stretch; }
      .ev-head-actions { justify-content: flex-end; }
    }
  `],
})
export class EnvVarsManagerComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private dialog = inject(Dialog);

  /** Required. */
  scope = input.required<'org' | 'site' | 'mcp'>();
  /** Required when scope='site'. */
  siteId = input<string | undefined>(undefined);
  /** Required when scope='mcp'. */
  mcpProvider = input<string | undefined>(undefined);

  vars = signal<EnvVarDto[]>([]);
  loading = signal<boolean>(false);
  saving = signal<boolean>(false);
  addingOpen = signal<boolean>(false);
  editingId = signal<string | null>(null);
  draft: NewVarDraft = { ...EMPTY_DRAFT };

  ariaLabel = (): string =>
    `Environment variables (${this.scope()}${this.scopeSuffix() || ''})`;
  scopeSuffix = (): string => {
    if (this.scope() === 'site' && this.siteId()) return ` · site ${this.siteId()}`;
    if (this.scope() === 'mcp' && this.mcpProvider()) return ` · ${this.mcpProvider()}`;
    return '';
  };

  constructor() {
    // Re-load whenever scope/site/mcp inputs change.
    effect(() => {
      const _scope = this.scope();
      const _site = this.siteId();
      const _mcp = this.mcpProvider();
      void _scope;
      void _site;
      void _mcp;
      this.load();
    });
  }

  ngOnInit(): void {
    this.load();
  }

  private buildScope(): { scope: 'org' | 'site' | 'mcp'; siteId?: string; mcpProvider?: string } {
    const scope = this.scope();
    const siteId = this.siteId();
    const mcpProvider = this.mcpProvider();
    return {
      scope,
      siteId: scope === 'site' && siteId ? siteId : undefined,
      mcpProvider: scope === 'mcp' && mcpProvider ? mcpProvider : undefined,
    };
  }

  private buildQueryParams(): Record<string, string> {
    const s = this.buildScope();
    const out: Record<string, string> = { scope: s.scope };
    if (s.siteId) out['siteId'] = s.siteId;
    if (s.mcpProvider) out['mcpProvider'] = s.mcpProvider;
    return out;
  }

  load(): void {
    this.loading.set(true);
    this.api.get<{ vars: EnvVarDto[] }>('/env-vars', this.buildQueryParams()).subscribe({
      next: (res) => {
        this.vars.set(res.vars ?? []);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); /* toast already fired by ApiService */ },
    });
  }

  truncate(text: string | null, max: number): string {
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  startAdd(): void {
    this.draft = { ...EMPTY_DRAFT };
    this.editingId.set(null);
    this.addingOpen.set(true);
  }

  startEdit(v: EnvVarDto): void {
    this.draft = {
      key: v.key,
      value: '', // never round-trip masked text — user must paste a new value
      description: v.description ?? '',
      isSecret: v.is_secret,
      exposedToAi: v.exposed_to_ai,
      showValue: false,
    };
    this.editingId.set(v.id);
    this.addingOpen.set(true);
  }

  cancelAdd(): void {
    this.addingOpen.set(false);
    this.draft = { ...EMPTY_DRAFT };
    this.editingId.set(null);
  }

  saveDraft(ev: Event): void {
    ev.preventDefault();
    if (!this.draft.key || !this.draft.value) {
      this.toast.error('Key + value required');
      return;
    }
    const s = this.buildScope();
    const payload: Record<string, unknown> = {
      scope: s.scope,
      siteId: s.siteId,
      mcpProvider: s.mcpProvider,
      key: this.draft.key,
      value: this.draft.value,
      description: this.draft.description || null,
      isSecret: this.draft.isSecret,
      exposedToAi: this.draft.exposedToAi,
    };
    this.saving.set(true);
    const editId = this.editingId();
    const req = editId
      ? this.api.patch<{ var: EnvVarDto }>(`/env-vars/${editId}`, payload)
      : this.api.post<{ var: EnvVarDto }>('/env-vars', payload);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success(editId ? 'Variable updated' : 'Variable saved');
        this.cancelAdd();
        this.load();
      },
      error: () => { this.saving.set(false); /* toast already fired */ },
    });
  }

  toggleExposedToAi(v: EnvVarDto): void {
    const next = !v.exposed_to_ai;
    this.api.patch<{ var: EnvVarDto }>(`/env-vars/${v.id}`, { exposedToAi: next }).subscribe({
      next: () => {
        this.vars.update((rows) => rows.map((r) => (r.id === v.id ? { ...r, exposed_to_ai: next } : r)));
        this.toast.success(next ? 'AI exposure on' : 'AI exposure off');
      },
      error: () => { /* toast already fired */ },
    });
  }

  remove(v: EnvVarDto): void {
    if (!confirm(`Delete env var ${v.key}? This cannot be undone.`)) return;
    this.api.delete<{ deleted: boolean }>(`/env-vars/${v.id}`).subscribe({
      next: () => {
        this.vars.update((rows) => rows.filter((r) => r.id !== v.id));
        this.toast.success(`Deleted ${v.key}`);
      },
      error: () => { /* toast already fired */ },
    });
  }

  openImport(): void {
    const ref = this.dialog.open<{ text: string } | undefined>(ImportEnvVarsDialogComponent, {
      width: 'min(720px, 92vw)',
      panelClass: 'cdk-dialog-bare',
      hasBackdrop: true,
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
    ref.closed.subscribe((result) => {
      if (!result?.text) return;
      const s = this.buildScope();
      this.api.post<{ imported: number; failed: number; errors: { key: string; reason: string }[] }>(
        '/env-vars/import',
        {
          scope: s.scope,
          siteId: s.siteId,
          mcpProvider: s.mcpProvider,
          dotenv: result.text,
        },
      ).subscribe({
        next: (res) => {
          this.toast.success(`Imported ${res.imported}${res.failed ? ` · ${res.failed} failed` : ''}`);
          this.load();
        },
        error: () => { /* toast already fired */ },
      });
    });
  }

  exportDotenv(): void {
    const s = this.buildScope();
    const qs = new URLSearchParams({ ...this.buildQueryParams(), include_values: '1' }).toString();
    // Use fetch directly so we get text + can trigger a browser download.
    const token = localStorage.getItem('session_token');
    fetch(`/api/env-vars/export?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(async (res) => {
        if (!res.ok) {
          const reason = res.status === 403 ? 'Org owner required for plaintext export' : `Export failed (${res.status})`;
          throw new Error(reason);
        }
        const text = await res.text();
        const ts = new Date().toISOString().slice(0, 10);
        const filenameScope = s.scope + (s.siteId ? `-${s.siteId}` : '') + (s.mcpProvider ? `-${s.mcpProvider}` : '');
        const filename = `.env.${filenameScope}-${ts}.txt`;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        this.toast.success('Export downloaded');
      })
      .catch((err: Error) => {
        this.toast.error(err.message || 'Export failed');
      });
  }
}

/**
 * Import-dialog component — paste a .env blob, returns `{text}` on close
 * (or `undefined` on cancel).
 */
@Component({
  selector: 'app-env-vars-import-dialog',
  standalone: true,
  imports: [FormsModule, DialogShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell maxWidth="640px" (closed)="cancel()">
      <span dialogTitle>Import .env</span>
      <div class="iev-body">
        <p class="iev-help">
          Paste your .env contents below. Supports comments (#), blank lines, quoted values, and the
          <code>export KEY=value</code> prefix. Max 100 variables per import.
        </p>
        <textarea
          class="iev-textarea"
          rows="14"
          [(ngModel)]="text"
          spellcheck="false"
          aria-label="Dotenv contents"
          placeholder="# Paste .env contents&#10;API_TOKEN=sk-live-xyz&#10;FEATURE_FLAG=on"
        ></textarea>
        <div class="iev-actions">
          <button type="button" class="iev-ghost" (click)="cancel()">Cancel</button>
          <button type="button" class="iev-primary" (click)="confirm()" [disabled]="!text.trim()">Import</button>
        </div>
      </div>
    </app-dialog-shell>
  `,
  styles: [`
    .iev-body { padding: 1.1rem 1.3rem 1.3rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .iev-help { margin: 0; font-size: 0.74rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); }
    .iev-help code { font-family: ui-monospace, monospace; background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 4px; }
    .iev-textarea {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border-radius: 10px;
      background: rgba(0,0,0,0.35);
      border: 1px solid rgba(255,255,255,0.1);
      color: var(--ps-ink, #f4f4ff);
      font: 0.78rem ui-monospace, SFMono-Regular, monospace;
      resize: vertical;
    }
    .iev-textarea:focus { outline: none; border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 45%, transparent); }
    .iev-actions { display: flex; justify-content: flex-end; gap: 0.4rem; }
    .iev-ghost {
      padding: 0.45rem 0.95rem;
      border-radius: 8px;
      background: transparent;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent);
      border: 1px solid rgba(255,255,255,0.12);
      cursor: pointer;
      font-size: 0.74rem;
    }
    .iev-primary {
      padding: 0.45rem 0.95rem;
      border-radius: 8px;
      background: linear-gradient(135deg, #00ffc8, var(--ps-accent, #00d4ff));
      color: var(--ps-bg, #060610);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00d4ff) 40%, transparent);
      cursor: pointer;
      font-weight: 700;
      font-size: 0.74rem;
    }
    .iev-primary:disabled { opacity: 0.55; cursor: not-allowed; }
  `],
})
export class ImportEnvVarsDialogComponent {
  private dialogRef = inject<DialogRef<{ text: string } | undefined>>(DialogRef);
  text = '';

  cancel(): void {
    this.dialogRef.close(undefined);
  }

  confirm(): void {
    this.dialogRef.close({ text: this.text });
  }
}
