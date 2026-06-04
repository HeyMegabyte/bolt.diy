import { Component, computed, effect, inject, signal, type OnInit } from '@angular/core';
import { SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { HlmInputDirective } from '../../../ui';

interface Conn { id: string; provider: string; display_name: string; status: string; connected_at: string; metadata?: Record<string, unknown>; }

/**
 * Available MCP providers. Colors are the official brand hues used for the
 * monogram tile only — every text element on the card uses the surrounding
 * `var(--ps-ink)` / `var(--text-secondary)` tokens to keep contrast safe
 * regardless of theme.
 */
const PROVIDERS: ReadonlyArray<{ id: string; label: string; desc: string; color: string; oauth: boolean }> = [
  { id: 'mailchimp', label: 'MailChimp', desc: 'Subscribe newsletter submissions to a Mailchimp audience list.', color: '#FFE01B', oauth: true },
  { id: 'stripe',    label: 'Stripe',    desc: 'Send invoices, charge cards, process quote requests.',          color: '#635BFF', oauth: true },
  { id: 'resend',    label: 'Resend',    desc: 'Send transactional emails (replies, confirmations).',           color: '#FF6363', oauth: false },
  { id: 'hubspot',   label: 'HubSpot',   desc: 'Create/update HubSpot CRM contacts on form submit.',            color: '#FF7A59', oauth: true },
] as const;

/**
 * Admin → MCP Connections section.
 *
 * @remarks
 * Per-site connections to external services so the AI form router can call
 * them. OAuth uses the standard MCP authorization pattern (OAuth 2.1 + PKCE
 * where supported) — providers without OAuth fall back to a paste-key flow.
 *
 * Disconnect uses a toast-armed confirmation flow rather than the native
 * `confirm()` dialog so the admin overlay z-stack stays consistent.
 */
@Component({
  selector: 'app-admin-mcp',
  standalone: true,
  imports: [FormsModule, SlicePipe, HlmInputDirective],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <header>
        <div class="kicker">Integrations</div>
        <h2 class="section-h text-lg font-bold text-white m-0 mt-1 flex items-center gap-2">
          MCP Connections
          @if (connectedCount() > 0) {
            <span class="header-pill" aria-label="Active connections" title="Active connections">
              <span class="header-pill-dot" aria-hidden="true"></span>
              {{ connectedCount() }} active
            </span>
          }
        </h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1 max-w-prose leading-relaxed">
          Connect external services so the AI form router + AI endpoints can call them. Tokens are encrypted at rest. OAuth uses the standard MCP authorization pattern (OAuth 2.1 + PKCE where supported).
        </p>
      </header>

      @if (!state.selectedSite()) {
        <div class="card notice notice-amber" role="status">
          <strong>No site selected.</strong>
          Pick a site from the sidebar — MCP connections are scoped per-site.
        </div>
      } @else if (loading() && connections().length === 0) {
        <div class="grid md:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading connections">
          @for (i of [0,1,2,3]; track i) {
            <article class="card">
              <div class="flex items-center gap-3">
                <div class="skel h-10 w-10 rounded-lg"></div>
                <div class="flex-1 space-y-2">
                  <div class="skel h-3 w-24"></div>
                  <div class="skel h-3 w-48"></div>
                </div>
              </div>
              <div class="skel h-7 w-28 mt-3 rounded-md"></div>
            </article>
          }
        </div>
      } @else {
        @if (loadError()) {
          <div class="card notice notice-amber" role="alert" data-testid="mcp-load-error">
            <strong>{{ loadError() }}</strong>
            <button class="btn-ghost text-xs ml-2" data-testid="mcp-retry" (click)="load()">Retry</button>
          </div>
        }
        <div class="grid md:grid-cols-2 gap-4">
          @for (p of providers; track p.id) {
            <article class="card mcp-card" [attr.data-testid]="'mcp-card-' + p.id">
              <div class="flex items-start gap-3">
                <div class="mcp-mono"
                     [style.background]="p.color + '22'"
                     [style.color]="p.color"
                     [style.box-shadow]="'inset 0 0 0 1px ' + p.color + '38'"
                     aria-hidden="true">{{ p.label[0] }}</div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <div class="font-semibold text-white">{{ p.label }}</div>
                    @if (isConnected(p.id); as _c) {
                      <span class="status-pill is-active" aria-label="Connected">Connected</span>
                    } @else {
                      <span class="status-pill is-draft" aria-label="Not connected">Not connected</span>
                    }
                  </div>
                  <div class="text-[0.72rem] text-text-secondary mt-1 leading-relaxed">{{ p.desc }}</div>
                </div>
              </div>

              @if (isConnected(p.id); as c) {
                <footer class="mcp-footer">
                  <span class="connected-meta">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    Connected {{ c.connected_at | slice:0:10 }}
                  </span>
                  <button class="btn-danger-ghost"
                          type="button"
                          (click)="disconnect(c)"
                          [attr.data-testid]="'mcp-disconnect-' + p.id"
                          [attr.aria-label]="'Disconnect ' + p.label">
                    Disconnect
                  </button>
                </footer>
              } @else if (pasteMode() === p.id) {
                <div class="mt-3">
                  <label class="block">
                    <span class="muted-h">API key</span>
                    <div class="flex gap-2 mt-1">
                      <input #pasteInput
                             type="password"
                             hlmInput
                             class="flex-1 font-mono text-xs"
                             [placeholder]="p.id === 'resend' ? 're_xxxxxxxx' : 'paste API key'"
                             [(ngModel)]="pastedKey"
                             (keydown.enter)="submitPaste(p.id)"
                             (keydown.escape)="cancelPaste()"
                             [attr.aria-label]="p.label + ' API key'"
                             [attr.data-testid]="'mcp-paste-input-' + p.id" />
                      <button class="btn-primary"
                              type="button"
                              (click)="submitPaste(p.id)"
                              [disabled]="!pastedKey.trim() || pasting()"
                              [attr.data-testid]="'mcp-paste-save-' + p.id">{{ pasting() ? 'Saving…' : 'Save' }}</button>
                      <button class="btn-ghost"
                              type="button"
                              (click)="cancelPaste()"
                              [attr.aria-label]="'Cancel ' + p.label + ' paste'">Cancel</button>
                    </div>
                  </label>
                  <p class="text-[0.66rem] text-text-secondary mt-2 leading-relaxed">
                    Stored encrypted in Cloudflare D1. Press <kbd class="kbd">Enter</kbd> to save · <kbd class="kbd">Esc</kbd> to cancel.
                  </p>
                </div>
              } @else {
                <button class="btn-primary mt-3 self-start mcp-connect"
                        type="button"
                        (click)="connect(p.id)"
                        [attr.data-testid]="'mcp-connect-' + p.id"
                        [attr.aria-label]="'Connect ' + p.label">
                  @if (p.oauth) {
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    <span>Connect via OAuth</span>
                  } @else {
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    <span>Paste API key</span>
                  }
                </button>
              }
            </article>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .kicker {
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--ps-accent, #00E5FF); opacity: 0.85;
    }
    .section-h { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }
    .card {
      background: var(--ps-surface-1, rgba(13,13,40,0.62));
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: var(--ps-radius-lg, 14px);
      padding: 1.2rem;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
    }
    .mcp-card {
      transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
    }
    .mcp-card:hover {
      transform: translateY(-1px);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 22%, transparent);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px -16px rgba(0,229,255,0.18);
    }
    @media (prefers-reduced-motion: reduce) {
      .mcp-card { transition: none; }
      .mcp-card:hover { transform: none; box-shadow: none; }
    }

    .mcp-mono {
      width: 44px; height: 44px;
      border-radius: var(--ps-radius-sm, 10px);
      display: inline-flex; align-items: center; justify-content: center;
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 1.05rem; font-weight: 800; letter-spacing: -0.02em;
      flex-shrink: 0;
    }

    .mcp-footer {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin-top: 0.85rem; padding-top: 0.75rem;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .connected-meta {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.7rem; color: #34d399;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }

    /* .input-field removed — the lone paste field now uses hlmInput (Spartan). */

    .btn-primary {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0.5rem 0.95rem;
      border-radius: var(--ps-radius-sm, 8px);
      background: rgba(0,229,255,0.12);
      color: var(--ps-accent, #00E5FF);
      font-weight: 600;
      border: 1px solid rgba(0,229,255,0.35);
      cursor: pointer;
      font-size: 0.74rem;
      transition: background var(--ps-dur-fast, 140ms) ease, transform var(--ps-dur-fast, 140ms) ease, border-color var(--ps-dur-fast, 140ms) ease;
    }
    .btn-primary:hover:not(:disabled) { background: rgba(0,229,255,0.2); transform: translateY(-1px); border-color: rgba(0,229,255,0.55); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary:focus-visible {
      outline: var(--ps-ring-focus, 2px solid #00E5FF);
      outline-offset: var(--ps-ring-focus-offset, 2px);
    }

    .btn-ghost {
      padding: 0.5rem 0.85rem;
      border-radius: var(--ps-radius-sm, 8px);
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.78);
      border: 1px solid rgba(255,255,255,0.1);
      cursor: pointer;
      font-size: 0.74rem;
      font-weight: 600;
      transition: background var(--ps-dur-fast, 140ms) ease, color var(--ps-dur-fast, 140ms) ease;
    }
    .btn-ghost:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .btn-ghost:focus-visible {
      outline: var(--ps-ring-focus, 2px solid #00E5FF);
      outline-offset: var(--ps-ring-focus-offset, 2px);
    }

    .btn-danger-ghost {
      padding: 0.35rem 0.75rem;
      border-radius: var(--ps-radius-sm, 8px);
      background: transparent;
      color: #fca5a5;
      border: 1px solid rgba(248,113,113,0.28);
      cursor: pointer;
      font-size: 0.7rem;
      font-weight: 600;
      transition: background var(--ps-dur-fast, 140ms) ease, color var(--ps-dur-fast, 140ms) ease, border-color var(--ps-dur-fast, 140ms) ease;
    }
    .btn-danger-ghost:hover { background: rgba(248,113,113,0.14); color: #fecaca; border-color: rgba(248,113,113,0.5); }
    .btn-danger-ghost:focus-visible {
      outline: 2px solid #fca5a5;
      outline-offset: 2px;
    }

    .mcp-connect { min-height: 32px; }

    /* Translucent loading skeleton */
    .skel {
      position: relative;
      overflow: hidden;
      background: rgba(255,255,255,0.04);
      border-radius: 6px;
    }
    .skel::after {
      content: "";
      position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06) 40%, rgba(0,229,255,0.08) 50%, rgba(255,255,255,0.06) 60%, transparent);
      background-size: 200% 100%;
      animation: skel-shine 1.6s linear infinite;
    }
    @keyframes skel-shine { from { background-position: 200% 0; } to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }

    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }

    .notice {
      display: flex; gap: 0.6rem; align-items: flex-start;
      font-size: 0.78rem; line-height: 1.55;
      padding: 0.85rem 1rem;
    }
    .notice strong { display: block; }
    .notice-amber {
      background: rgba(251, 191, 36, 0.06);
      border-color: rgba(251, 191, 36, 0.3);
      color: #fde68a;
    }
    .notice-amber strong { color: #fcd34d; }

    .header-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 10px; border-radius: 999px;
      background: rgba(52, 211, 153, 0.10);
      border: 1px solid rgba(52, 211, 153, 0.32);
      color: #6ee7b7;
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 0.65rem; font-weight: 600; letter-spacing: 0.02em;
    }
    .header-pill-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #34d399; box-shadow: 0 0 6px rgba(52, 211, 153, 0.7);
    }
  `],
})
export class AdminMcpComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  providers = PROVIDERS;
  connections = signal<Conn[]>([]);
  /** Persistent load failure — without it, a failed fetch shows every provider as "not connected" (stale/misleading). */
  loadError = signal<string | null>(null);
  pasteMode = signal<string | null>(null);
  pastedKey = '';
  /** In-flight guard for the paste-key save — blocks double-submit + drives the "Saving…" affordance. */
  readonly pasting = signal(false);
  loading = signal(false);

  /** Count of currently-connected providers — drives the header status pill. */
  connectedCount = computed<number>(() => this.connections().length);

  private loadedSiteId: string | null = null;

  constructor() {
    // Load connections when the selected site resolves (may arrive after mount on
    // deep-link) + reload on site switch. Guarded so we never re-load the same site.
    effect(() => {
      const id = this.state.selectedSite()?.id ?? null;
      if (id && id !== this.loadedSiteId) {
        this.loadedSiteId = id;
        this.load();
      }
    });
  }

  ngOnInit(): void { this.handleCallback(); }

  load(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.loading.set(true);
    this.loadError.set(null);
    this.api.get<{ data: { connections: Conn[] } }>(`/sites/${s.id}/mcp/connections`, undefined, { silent: true }).subscribe({
      next: (r) => {
        this.connections.set(r.data?.connections ?? []);
        this.loadError.set(null);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        // Persistent banner — otherwise the provider cards below render every
        // provider as "not connected", making a failed load look like a clean slate.
        // Persistent inline banner only — a transient toast on top of a sticky
        // banner (and the now-silenced generic ApiService toast) was triple feedback.
        this.loadError.set('Could not load connection status — shown statuses may be stale.');
      },
    });
  }

  isConnected(provider: string): Conn | null {
    return this.connections().find((c) => c.provider === provider) ?? null;
  }

  connect(provider: string): void {
    const s = this.state.selectedSite(); if (!s) return;
    const meta = this.providers.find((p) => p.id === provider);
    // Providers without OAuth (currently: Resend) get the inline paste flow.
    if (meta && !meta.oauth) { this.pasteMode.set(provider); this.pastedKey = ''; return; }
    window.location.href = `/api/mcp/${provider}/connect?site_id=${s.id}&return_url=/admin/mcp`;
  }

  cancelPaste(): void {
    this.pasteMode.set(null);
    this.pastedKey = '';
  }

  submitPaste(provider: string): void {
    if (this.pasting()) return; // in-flight guard — a 2nd Save/Enter must not double-POST
    const s = this.state.selectedSite(); if (!s) return;
    const key = this.pastedKey.trim();
    if (!key) {
      this.toast.error('Paste a valid API key before saving');
      return;
    }
    const meta = this.providers.find((p) => p.id === provider);
    this.pasting.set(true);
    this.api.post(`/mcp/${provider}/paste?site_id=${s.id}`, { api_key: key }, { silent: true }).subscribe({
      next: () => {
        this.pasting.set(false);
        this.pastedKey = '';
        this.pasteMode.set(null);
        this.toast.success(`${meta?.label ?? provider} connected — form router can now call it`);
        this.load();
      },
      error: () => {
        this.pasting.set(false);
        this.toast.error(`Could not save ${meta?.label ?? provider} key — check the value + retry`);
      },
    });
  }

  /**
   * Disconnect via toast-armed confirmation. Replaces the native
   * `confirm()` dialog (which broke the admin z-stack + accessibility focus
   * loop) with the consistent action-armed toast pattern used elsewhere.
   */
  disconnect(c: Conn): void {
    const s = this.state.selectedSite(); if (!s) return;
    const meta = this.providers.find((p) => p.id === c.provider);
    this.toast.warning(
      `Disconnect ${meta?.label ?? c.provider}? The form router will lose this integration.`,
      {
        action: { label: 'Disconnect', run: () => this.performDisconnect(c, s.id) },
        duration: 7000,
      },
    );
  }

  private performDisconnect(c: Conn, siteId: string): void {
    const meta = this.providers.find((p) => p.id === c.provider);
    this.api.delete(`/sites/${siteId}/mcp/connections/${c.id}`, { silent: true }).subscribe({
      next: () => { this.toast.success(`${meta?.label ?? c.provider} disconnected`); this.load(); },
      error: () => this.toast.error(`Could not disconnect ${meta?.label ?? c.provider} — retry shortly`),
    });
  }

  handleCallback(): void {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('error');
    if (connected) {
      const meta = this.providers.find((p) => p.id === connected);
      this.toast.success(`${meta?.label ?? connected} connected — form router can now call it`);
      history.replaceState({}, '', '/admin/mcp');
      setTimeout(() => this.load(), 200);
    } else if (error) {
      this.toast.error(`Connection failed: ${error}`);
      history.replaceState({}, '', '/admin/mcp');
    }
  }
}
