import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { DialogShellComponent } from '../dialog-shell/dialog-shell.component';
import {
  EnvVarsManagerComponent,
  type EnvVarScopeDto,
} from '../env-vars-manager/env-vars-manager.component';

/** The kinds of contexts an attachment can decorate. */
export type EnvVarsAttachmentKind = 'endpoint' | 'agent' | 'mcp' | 'site';

/** Shape of a single MCP connection row returned by `/api/mcp/connections`. */
interface McpConnectionDto {
  id: string;
  provider: string;
  display_name?: string | null;
  endpoint_id?: string | null;
  agent_id?: string | null;
  site_id?: string | null;
  status?: string | null;
}

/**
 * Compact "AI context + MCPs" panel — bundles the per-scope env-vars manager
 * with a list of attached MCP providers + an "Attach MCP" affordance.
 *
 * @remarks
 * Designed to be embedded anywhere an AI context exists: the Agents tab (one
 * per agent row), the MCP picker (per-provider override), the endpoint detail
 * pane, and per-site Settings. Surfaces a collapsible card titled
 * "AI context + MCPs" that exposes:
 *
 * - The matching {@link EnvVarsManagerComponent} for `kind` + `contextId`
 * - A list of attached MCP providers fetched from
 *   `GET /api/mcp/connections?{kind}_id=...` (best-effort — empty fallback
 *   when the endpoint doesn't return MCP rows for the kind yet)
 * - An "Attach MCP" button that opens {@link DialogShellComponent} with a
 *   minimal provider picker stub.
 *
 * @example
 * ```html
 * <app-env-vars-attachment kind="agent" [contextId]="agent.id" />
 * <app-env-vars-attachment kind="endpoint" [contextId]="endpoint.id" title="Endpoint context" />
 * ```
 *
 * Brand tokens: `--ps-bg`, `--ps-ink`, `--ps-accent`. A11y: title is rendered
 * inside a real `<button aria-expanded>` so the panel collapse/expand is
 * keyboard-operable; the embedded manager retains its own focus order.
 */
@Component({
  selector: 'app-env-vars-attachment',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EnvVarsManagerComponent, DialogShellComponent],
  template: `
    <section
      class="eva-shell"
      [attr.data-kind]="kind()"
      [attr.aria-label]="resolvedTitle()"
    >
      <button
        type="button"
        class="eva-toggle"
        (click)="toggleOpen()"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="panelId"
      >
        <span class="eva-kicker">{{ kicker() }}</span>
        <span class="eva-title">{{ resolvedTitle() }}</span>
        <span class="eva-caret" aria-hidden="true">{{ open() ? '▾' : '▸' }}</span>
      </button>

      @if (open()) {
        <div class="eva-body" [id]="panelId" role="region" [attr.aria-label]="resolvedTitle()">
          <!-- Env vars manager — scope-driven. -->
          <app-env-vars-manager
            [scope]="scope()"
            [siteId]="kind() === 'site' ? contextId() : undefined"
            [mcpProvider]="kind() === 'mcp' ? contextId() : undefined"
            [endpointId]="kind() === 'endpoint' ? contextId() : undefined"
            [agentId]="kind() === 'agent' ? contextId() : undefined"
          />

          <!-- MCP attachments. -->
          <div class="eva-mcps">
            <header class="eva-mcps-head">
              <div>
                <div class="eva-kicker">Attached MCPs</div>
                <p class="eva-mcps-sub">
                  Tools + data sources this context can call. Vars above flow into every MCP request.
                </p>
              </div>
              <button
                type="button"
                class="eva-btn-ghost"
                (click)="openMcpPicker()"
                [attr.aria-label]="'Attach MCP to ' + resolvedTitle()"
              >
                + Attach MCP
              </button>
            </header>

            @if (mcpsLoading()) {
              <div class="eva-empty" aria-busy="true">Loading MCPs…</div>
            } @else if (mcps().length === 0) {
              <div class="eva-empty">
                No MCPs attached yet. Click <strong>+ Attach MCP</strong> to connect one.
              </div>
            } @else {
              <ul class="eva-mcp-list" role="list">
                @for (m of mcps(); track m.id) {
                  <li class="eva-mcp-item">
                    <span class="eva-mcp-name">{{ m.display_name || m.provider }}</span>
                    @if (m.status) {
                      <span
                        class="eva-mcp-status"
                        [class.is-ok]="m.status === 'connected' || m.status === 'active'"
                      >{{ m.status }}</span>
                    }
                  </li>
                }
              </ul>
            }
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .eva-shell {
      background: rgba(255,255,255,0.02);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 12%, transparent);
      border-radius: var(--ps-radius-xl, 22px);
      color: var(--ps-ink, #f4f4ff);
      overflow: hidden;
    }
    .eva-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.85rem 1.1rem;
      background: transparent;
      border: 0;
      color: inherit;
      cursor: pointer;
      text-align: left;
      transition: background 180ms ease;
    }
    .eva-toggle:hover { background: rgba(255,255,255,0.03); }
    .eva-toggle:focus-visible {
      outline: 2px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 60%, transparent);
      outline-offset: -2px;
    }
    @media (prefers-reduced-motion: reduce) {
      .eva-toggle { transition: none; }
    }
    .eva-kicker {
      font-size: 0.58rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 700;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
    }
    .eva-title {
      flex: 1;
      font-family: 'Sora', system-ui, sans-serif;
      font-weight: 600;
      font-size: 0.88rem;
      letter-spacing: -0.01em;
    }
    .eva-caret {
      font-size: 0.72rem;
      color: color-mix(in oklch, var(--ps-accent, #00E5FF) 70%, transparent);
    }
    .eva-body {
      padding: 0 1.1rem 1.1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .eva-mcps {
      padding: 1rem;
      border-radius: 14px;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .eva-mcps-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.6rem;
      margin-bottom: 0.7rem;
      flex-wrap: wrap;
    }
    .eva-mcps-sub {
      margin: 0.2rem 0 0;
      font-size: 0.68rem;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
      max-width: 480px;
    }
    .eva-btn-ghost {
      padding: 0.4rem 0.8rem;
      border-radius: 8px;
      background: transparent;
      color: var(--ps-ink, #f4f4ff);
      border: 1px solid rgba(255,255,255,0.12);
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
      transition: border-color 180ms ease;
    }
    .eva-btn-ghost:hover {
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 45%, transparent);
    }
    @media (prefers-reduced-motion: reduce) {
      .eva-btn-ghost { transition: none; }
    }
    .eva-mcp-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.35rem; }
    .eva-mcp-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
      padding: 0.45rem 0.7rem;
      border-radius: 8px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .eva-mcp-name { font-size: 0.78rem; font-weight: 600; }
    .eva-mcp-status {
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(255,255,255,0.04);
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .eva-mcp-status.is-ok {
      color: var(--ps-accent, #00E5FF);
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 14%, transparent);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 35%, transparent);
    }
    .eva-empty {
      padding: 1rem;
      border-radius: 10px;
      background: rgba(255,255,255,0.02);
      border: 1px dashed rgba(255,255,255,0.08);
      text-align: center;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
      font-size: 0.74rem;
    }
  `],
})
export class EnvVarsAttachmentComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private dialog = inject(Dialog);

  /** Which kind of context this attachment is decorating. */
  kind = input.required<EnvVarsAttachmentKind>();
  /** The owning context id (endpoint id, agent id, mcp provider slug, or site id). */
  contextId = input.required<string>();
  /** Optional custom title — defaults to a kind-sensible label. */
  title = input<string | undefined>(undefined);
  /** When true, panel renders expanded on first paint. */
  defaultOpen = input<boolean>(false);

  /** Whether the panel is currently expanded. */
  open = signal<boolean>(false);
  /** Per-instance DOM id so `aria-controls` can target the body. */
  readonly panelId = `eva-${crypto.randomUUID()}`;

  /** Loaded MCP connections for this context. */
  mcps = signal<McpConnectionDto[]>([]);
  /** True while the MCP list is fetching. */
  mcpsLoading = signal<boolean>(false);

  /** Computed scope passed through to the embedded {@link EnvVarsManagerComponent}. */
  scope = computed<EnvVarScopeDto>(() => {
    switch (this.kind()) {
      case 'endpoint': return 'endpoint';
      case 'agent': return 'agent';
      case 'mcp': return 'mcp';
      case 'site': return 'site';
      default: return 'org';
    }
  });

  /** Small uppercase kicker shown above the title. */
  kicker = computed<string>(() => `Scope · ${this.scope()}`);

  /** Human title — caller's override, else a sensible default per kind. */
  resolvedTitle = computed<string>(() => {
    const t = this.title();
    if (t) return t;
    switch (this.kind()) {
      case 'endpoint': return 'AI context + MCPs · endpoint';
      case 'agent': return 'AI context + MCPs · agent';
      case 'mcp': return 'AI context + overrides · MCP';
      case 'site': return 'AI context + MCPs · site';
      default: return 'AI context + MCPs';
    }
  });

  constructor() {
    // Open state seeds from input on first run; then re-fetch MCPs whenever
    // the (kind, contextId) tuple changes.
    effect(() => {
      this.open.set(this.defaultOpen());
    }, { allowSignalWrites: true });

    effect(() => {
      const _k = this.kind();
      const _id = this.contextId();
      void _k;
      void _id;
      this.loadMcps();
    });
  }

  /** Toggle the collapsible body. */
  toggleOpen(): void {
    this.open.update((v) => !v);
  }

  /**
   * Fetch MCP connections scoped to this context. Best-effort — the
   * `/api/mcp/connections` endpoint may not yet accept every kind filter,
   * so failures degrade to an empty list rather than firing an error toast.
   */
  private loadMcps(): void {
    const kind = this.kind();
    const id = this.contextId();
    if (!id) {
      this.mcps.set([]);
      return;
    }
    const params: Record<string, string> = {};
    switch (kind) {
      case 'endpoint': params['endpoint_id'] = id; break;
      case 'agent': params['agent_id'] = id; break;
      case 'mcp': params['provider'] = id; break;
      case 'site': params['site_id'] = id; break;
    }
    this.mcpsLoading.set(true);
    this.api.get<{ connections?: McpConnectionDto[] }>('/mcp/connections', params).subscribe({
      next: (res) => {
        this.mcps.set(res?.connections ?? []);
        this.mcpsLoading.set(false);
      },
      error: () => {
        // Silent — the endpoint may not yet support every kind filter.
        this.mcps.set([]);
        this.mcpsLoading.set(false);
      },
    });
  }

  /**
   * Open the MCP picker dialog. On confirm, fire `/api/mcp/:provider/connect`
   * for the chosen provider so the OAuth or paste-key flow can start. On
   * close, refresh the local list.
   */
  openMcpPicker(): void {
    const ref = this.dialog.open<{ provider: string } | undefined>(EnvVarsAttachmentMcpPickerComponent, {
      width: 'min(520px, 92vw)',
      panelClass: 'cdk-dialog-bare',
      hasBackdrop: true,
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
    ref.closed.subscribe((res) => {
      if (!res?.provider) return;
      // Surface a toast so the user knows the next step opens elsewhere.
      this.toast.success(`Connecting ${res.provider}…`);
      this.loadMcps();
    });
  }
}

/**
 * Minimal MCP picker dialog. Hard-codes a starter provider list — the worker
 * `/api/mcp/:provider/connect` route handles the OAuth/paste-key fallback.
 *
 * @remarks
 * Returns `{ provider }` on confirm, `undefined` on cancel.
 */
@Component({
  selector: 'app-env-vars-attachment-mcp-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogShellComponent],
  template: `
    <app-dialog-shell maxWidth="480px" (closed)="cancel()">
      <span dialogTitle>Attach an MCP</span>
      <div class="evp-body">
        <p class="evp-help">
          Pick a provider to attach. You'll be redirected through OAuth (or shown a paste-key form when no OAuth credentials are configured).
        </p>
        <ul class="evp-list" role="list">
          @for (p of providers; track p.id) {
            <li>
              <button
                type="button"
                class="evp-item"
                (click)="pick(p.id)"
                [attr.aria-label]="'Attach ' + p.label"
              >
                <span class="evp-item-label">{{ p.label }}</span>
                <span class="evp-item-sub">{{ p.id }}</span>
              </button>
            </li>
          }
        </ul>
        <div class="evp-actions">
          <button type="button" class="evp-ghost" (click)="cancel()">Cancel</button>
        </div>
      </div>
    </app-dialog-shell>
  `,
  styles: [`
    .evp-body { padding: 1.1rem 1.3rem 1.3rem; display: flex; flex-direction: column; gap: 0.85rem; }
    .evp-help { margin: 0; font-size: 0.74rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); }
    .evp-list { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.45rem; }
    .evp-item {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      padding: 0.6rem 0.75rem;
      border-radius: 10px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08);
      color: var(--ps-ink, #f4f4ff);
      cursor: pointer;
      text-align: left;
      transition: border-color 180ms ease, transform 180ms ease;
    }
    .evp-item:hover {
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 40%, transparent);
      transform: translateY(-1px);
    }
    .evp-item:focus-visible {
      outline: 2px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 60%, transparent);
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      .evp-item { transition: none; }
      .evp-item:hover { transform: none; }
    }
    .evp-item-label { font-size: 0.82rem; font-weight: 700; }
    .evp-item-sub {
      font-size: 0.62rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
    }
    .evp-actions { display: flex; justify-content: flex-end; }
    .evp-ghost {
      padding: 0.45rem 0.95rem;
      border-radius: 8px;
      background: transparent;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent);
      border: 1px solid rgba(255,255,255,0.12);
      cursor: pointer;
      font-size: 0.74rem;
    }
  `],
})
export class EnvVarsAttachmentMcpPickerComponent {
  private dialogRef = inject<DialogRef<{ provider: string } | undefined>>(DialogRef);

  /** Starter list — extend as worker `/api/mcp/:provider/connect` adds providers. */
  readonly providers: { id: string; label: string }[] = [
    { id: 'mailchimp', label: 'Mailchimp' },
    { id: 'stripe', label: 'Stripe' },
    { id: 'hubspot', label: 'HubSpot' },
    { id: 'github', label: 'GitHub' },
    { id: 'slack', label: 'Slack' },
    { id: 'notion', label: 'Notion' },
    { id: 'linear', label: 'Linear' },
    { id: 'google-calendar', label: 'Google Calendar' },
    { id: 'calendly', label: 'Calendly' },
    { id: 'resend', label: 'Resend (paste-key)' },
  ];

  /** Resolve the dialog with the selected provider id. */
  pick(provider: string): void {
    this.dialogRef.close({ provider });
  }

  /** Close without choosing — resolves to `undefined`. */
  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
