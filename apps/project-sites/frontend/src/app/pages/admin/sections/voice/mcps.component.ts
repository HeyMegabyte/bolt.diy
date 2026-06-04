/**
 * Voice → MCPs tab.
 *
 * @remarks
 * Lists MCP connections already configured on the site. Each row has a pair
 * of checkboxes to attach the connection to the voice agent's tool context,
 * the SMS agent's tool context, or both. Saving fans the change out to the
 * worker's voice agent settings store. Adding a new MCP routes the operator
 * to the MCP tab in Settings — this section never re-implements the
 * connect/disconnect flow.
 *
 * Endpoint contract (worker-owned):
 *   GET  /api/mcp/connections?siteId=…             → { data: McpConnection[] }
 *   GET  /api/voice/mcp-attachments?siteId=…       → { data: { voice: string[]; sms: string[] } }
 *   PUT  /api/voice/mcp-attachments                → same shape
 *
 * @example
 * ```html
 * <app-voice-mcps />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AdminStateService } from '../../admin-state.service';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { RevealOnScrollDirective } from '../../../../animations/reveal-on-scroll.directive';
import { EmptyStateComponent } from '../../empty-state.component';
import { ErrorCardComponent } from '../../../../components/states';

interface McpConnection {
  id: string;
  provider: string;
  display_name: string;
  status: string;
  connected_at: string;
}

const PROVIDER_META: Readonly<Record<string, { label: string; color: string }>> = {
  mailchimp: { label: 'MailChimp', color: '#FFE01B' },
  stripe:    { label: 'Stripe',    color: '#635BFF' },
  resend:    { label: 'Resend',    color: '#FF6363' },
  hubspot:   { label: 'HubSpot',   color: '#FF7A59' },
  slack:     { label: 'Slack',     color: '#4A154B' },
  notion:    { label: 'Notion',    color: '#FFFFFF' },
  github:    { label: 'GitHub',    color: '#FFFFFF' },
  calendly:  { label: 'Calendly',  color: '#006BFF' },
  gcal:      { label: 'Google Calendar', color: '#4285F4' },
  square:    { label: 'Square',    color: '#3E4348' },
};

@Component({
  selector: 'app-voice-mcps',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, RevealOnScrollDirective, EmptyStateComponent, ErrorCardComponent],
  template: `
    <section class="space-y-5" psReveal>
      <article class="card" psReveal>
        <header class="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div>
            <div class="kicker">Integrations</div>
            <h3 class="section-h text-base font-bold text-white m-0 mt-1">MCP tool access</h3>
            <p class="muted-help m-0 mt-1">
              Toggle which connections your voice + SMS agents can call mid-conversation.
              "Book the 3pm slot" → Calendly · "Send a quote" → Stripe · "Add to nurture" → Mailchimp.
            </p>
          </div>
          <a routerLink="/admin/settings" fragment="mcp" class="btn-ghost text-xs">+ Add new MCP</a>
        </header>

        @if (loading() && connections().length === 0) {
          <div class="space-y-2" aria-busy="true">
            @for (i of [0,1,2]; track i) { <div class="skel h-16 rounded-md"></div> }
          </div>
        } @else if (loadError() && connections().length === 0) {
          <app-error-card
            title="Couldn't load connections"
            [message]="loadError()!"
            (retry)="reload()"
            data-testid="mcps-error" />
        } @else if (connections().length === 0) {
          <app-empty-state
            icon="🔌"
            title="No connections yet"
            body="Connect an MCP from the Settings tab — Calendly, Stripe, Mailchimp, HubSpot, and more."
            primary="Open Settings"
            (primaryClick)="goSettings()"
          />
        } @else {
          <ul class="grid gap-2" role="list">
            @for (c of connections(); track c.id) {
              <li class="mcp-row" role="listitem">
                <div class="mcp-mono"
                     [style.background]="meta(c.provider).color + '22'"
                     [style.color]="meta(c.provider).color"
                     [style.box-shadow]="'inset 0 0 0 1px ' + meta(c.provider).color + '38'"
                     aria-hidden="true">{{ meta(c.provider).label[0] }}</div>
                <div class="min-w-0 flex-1">
                  <div class="font-semibold text-white truncate">{{ meta(c.provider).label }}</div>
                  <div class="text-[0.7rem] text-text-secondary">{{ c.display_name }} · connected {{ c.connected_at.slice(0,10) }}</div>
                </div>
                <label class="ck-pill">
                  <input type="checkbox"
                         [checked]="voiceAttached().has(c.id)"
                         (change)="toggle(c.id, 'voice', $any($event.target).checked)"
                         [attr.aria-label]="'Attach ' + meta(c.provider).label + ' to voice agent'" />
                  <span>Voice</span>
                </label>
                <label class="ck-pill">
                  <input type="checkbox"
                         [checked]="smsAttached().has(c.id)"
                         (change)="toggle(c.id, 'sms', $any($event.target).checked)"
                         [attr.aria-label]="'Attach ' + meta(c.provider).label + ' to SMS agent'" />
                  <span>SMS</span>
                </label>
              </li>
            }
          </ul>

          <div class="flex items-center justify-between mt-4">
            <span class="muted-help">{{ attachedCount() }} connection(s) attached</span>
            <button class="btn-primary" type="button" (click)="save()" [disabled]="saving() || !dirty()">
              {{ saving() ? 'Saving…' : 'Save attachments' }}
            </button>
          </div>
        }
      </article>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .kicker { font: 700 0.62rem/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ps-accent, #00E5FF); opacity: 0.85; }
    .section-h { font-family: 'Sora', system-ui, sans-serif; letter-spacing: -0.02em; }
    .muted-help { font-size: 0.72rem; color: rgba(255,255,255,0.58); line-height: 1.5; }
    .card { background: var(--ps-surface-1, rgba(13,13,40,0.62)); border: 1px solid rgba(255,255,255,0.06); border-radius: var(--ps-radius-lg, 14px); padding: 1.2rem; }

    .mcp-row {
      display: flex; align-items: center; gap: 0.85rem;
      padding: 0.75rem 0.9rem;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: var(--ps-radius-sm, 10px);
      background: rgba(255,255,255,0.02);
      min-height: 60px;
    }
    .mcp-mono {
      width: 36px; height: 36px; border-radius: var(--ps-radius-sm, 8px);
      display: inline-flex; align-items: center; justify-content: center;
      font: 800 0.95rem 'Sora', system-ui, sans-serif; letter-spacing: -0.02em;
      flex-shrink: 0;
    }

    .ck-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      font: 600 0.72rem 'JetBrains Mono', ui-monospace, monospace;
      color: rgba(255,255,255,0.78); cursor: pointer; min-height: 36px;
      transition: background 140ms ease, border-color 140ms ease;
    }
    .ck-pill:has(input:checked) { background: rgba(0,229,255,0.12); border-color: rgba(0,229,255,0.42); color: var(--ps-accent, #00E5FF); }
    .ck-pill input { accent-color: var(--ps-accent, #00E5FF); cursor: pointer; }

    .btn-primary, .btn-ghost {
      padding: 0.5rem 1rem; border-radius: var(--ps-radius-sm, 8px);
      font-weight: 600; cursor: pointer; border: 1px solid transparent; min-height: 36px;
      transition: background 140ms ease, transform 140ms ease;
    }
    .btn-primary { background: rgba(0,229,255,0.16); color: var(--ps-accent, #00E5FF); border-color: rgba(0,229,255,0.4); font-size: 0.76rem; }
    .btn-primary:hover:not(:disabled) { background: rgba(0,229,255,0.24); transform: translateY(-1px); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost { background: rgba(255,255,255,0.04); color: #fff; border-color: rgba(255,255,255,0.1); font-size: 0.74rem; text-decoration: none; display: inline-flex; align-items: center; }
    .btn-ghost:hover { background: rgba(255,255,255,0.09); }
    button:focus-visible, a.btn-ghost:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }

    .skel { background: rgba(255,255,255,0.04); border-radius: 6px; position: relative; overflow: hidden; }
    .skel::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent); background-size: 200% 100%; animation: shine 1.6s linear infinite; }
    @keyframes shine { from { background-position: 200% 0; } to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
  `],
})
export class VoiceMcpsComponent {
  readonly state = inject(AdminStateService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  connections = signal<McpConnection[]>([]);
  loading = signal(true);
  saving = signal(false);
  /** Set when the connections fetch fails so a Retry card shows — never a fake "No connections yet". */
  loadError = signal<string | null>(null);
  voiceAttached = signal<Set<string>>(new Set());
  smsAttached = signal<Set<string>>(new Set());
  private originalKey = signal<string>('');

  attachedCount = computed(() => new Set([...this.voiceAttached(), ...this.smsAttached()]).size);
  dirty = computed(() => this.currentKey() !== this.originalKey());

  private readonly siteEffect = effect(() => {
    const site = this.state.selectedSite();
    if (!site) return;
    this.reload();
  });

  meta(provider: string): { label: string; color: string } {
    return PROVIDER_META[provider] ?? { label: provider.toUpperCase(), color: '#A1A1AA' };
  }

  reload(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.loading.set(true);
    this.loadError.set(null);
    Promise.all([
      this.api.get<{ data: McpConnection[] }>(`/mcp/connections?siteId=${site.id}`, undefined, { silent: true }).toPromise()
        .then((r) => ({ ok: true as const, data: r?.data ?? [] }))
        .catch(() => ({ ok: false as const, data: [] as McpConnection[] })),
      // Attachments are secondary/best-effort — empty-on-fail is fine here.
      this.api.get<{ data: { voice: string[]; sms: string[] } }>(`/voice/mcp-attachments?siteId=${site.id}`, undefined, { silent: true }).toPromise().catch(() => ({ data: { voice: [], sms: [] } })),
    ]).then(([conns, atts]) => {
      if (conns.ok) {
        this.connections.set(conns.data);
      } else if (this.connections().length === 0) {
        // Surface a Retry card instead of a fake "No connections yet"; keep any
        // already-loaded rows on a transient blip.
        this.loadError.set('The MCP connections service did not respond.');
      }
      const v = new Set(atts?.data?.voice ?? []);
      const s = new Set(atts?.data?.sms ?? []);
      this.voiceAttached.set(v);
      this.smsAttached.set(s);
      this.originalKey.set(this.currentKey());
      this.loading.set(false);
    });
  }

  toggle(id: string, kind: 'voice' | 'sms', on: boolean): void {
    const sig = kind === 'voice' ? this.voiceAttached : this.smsAttached;
    const next = new Set(sig());
    if (on) next.add(id); else next.delete(id);
    sig.set(next);
  }

  save(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.saving.set(true);
    this.api.put<{ data: { voice: string[]; sms: string[] } }>(`/voice/mcp-attachments`, {
      site_id: site.id,
      voice: [...this.voiceAttached()],
      sms: [...this.smsAttached()],
    }, { silent: true }).subscribe({
      next: () => {
        this.originalKey.set(this.currentKey());
        this.toast.success('Attachments saved');
        this.saving.set(false);
      },
      // {silent} above so this is the ONLY toast on failure (no generic double-fire).
      error: () => { this.toast.error('Save failed'); this.saving.set(false); },
    });
  }

  /**
   * Open the Settings → MCP tab via SPA navigation. Previously this set
   * `window.location.pathname` + `.hash`, which triggered a full-page reload
   * (destroying the persistent bolt iframe + all admin state). Routed
   * navigation keeps the cockpit shell alive and lets View Transitions handle
   * the swap. The `mcp` fragment is consumed by the Settings section to focus
   * its MCP panel.
   */
  goSettings(): void {
    void this.router.navigate(['/admin/settings'], { fragment: 'mcp' });
  }

  private currentKey = computed(() =>
    JSON.stringify([[...this.voiceAttached()].sort(), [...this.smsAttached()].sort()]),
  );
}
