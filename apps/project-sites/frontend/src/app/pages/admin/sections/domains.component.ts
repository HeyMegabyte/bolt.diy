/**
 * @module pages/admin/sections/domains
 * @description Per-project Domain Management admin section.
 *
 * Renders three vertically-stacked surfaces against the currently selected
 * site from {@link AdminStateService}:
 *
 *  1. **Provisioned backup domain** — read-only display of
 *     `{slug}.projectsites.dev` plus copy + open-in-new-tab affordances.
 *     This is the always-available fallback every site ships with.
 *  2. **Add a domain** — two-track form: existing custom-CNAME flow (re-uses
 *     `POST /api/sites/:siteId/hostnames`) AND the new AI creative-domain
 *     search (`POST /api/sites/:siteId/domains/ai-search`) that fans out 10
 *     parallel Workers AI strategies and bulk-checks availability via
 *     Cloudflare Registrar. Each candidate renders as a card with a
 *     strategy badge + price + register button.
 *  3. **Connected domains** — table of `GET /api/sites/:siteId/hostnames`
 *     with row actions for "Make primary", "Remove", and the new
 *     "Transfer out / Port to another registrar" flow.
 *
 * Component is fully reactive over `state.selectedSite()`; switching the
 * site in the sidebar instantly reloads the hostname list.
 *
 * @example
 * ```ts
 * // app.routes.ts
 * { path: 'domains', loadComponent: () =>
 *     import('./pages/admin/sections/domains.component').then(m => m.AdminDomainsComponent) }
 * ```
 *
 * @packageDocumentation
 */
import { Component, inject, signal, computed, effect, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { EmptyStateComponent } from '../empty-state.component';

/** Single hostname row returned by `GET /api/sites/:siteId/hostnames`. */
interface Hostname {
  readonly id: string;
  readonly hostname: string;
  readonly type: 'free_subdomain' | 'custom_cname' | string;
  readonly status: string;
  readonly ssl_status: string;
  readonly is_primary: number;
}

/** Card emitted by the AI-domain-search backend. */
interface DomainCard {
  readonly name: string;
  readonly tld: string;
  readonly price_usd: number;
  readonly available: boolean;
  readonly strategy: string;
}

/** Server response shape for the AI domain search endpoint. */
interface AiSearchResponse {
  readonly data: {
    readonly available: readonly DomainCard[];
    readonly unavailable: readonly DomainCard[];
  };
}

/** Server response for the transfer-out endpoint. */
interface TransferOutResponse {
  readonly data: {
    readonly auth_code: string;
    readonly registrar_locked: false;
    readonly instructions_url: string;
  };
}

/**
 * Friendly label for each AI naming strategy, rendered inside the candidate
 * card badge. Kept here (not on the server) so we can re-skin labels
 * without redeploying the Worker.
 */
const STRATEGY_LABEL: Readonly<Record<string, string>> = {
  literal: 'Literal',
  metaphor: 'Metaphor',
  compound: 'Compound',
  alliterative: 'Alliterative',
  rhyming: 'Rhyming',
  jargon: 'Industry jargon',
  playful: 'Playful',
  minimalist: 'Minimalist',
  'premium-tld': 'Premium TLD',
  geography: 'Geo-flavored',
};

/**
 * Standalone Angular component for the per-site domain management page.
 *
 * Provided via the admin route at `/admin/domains`.
 */
@Component({
  selector: 'app-admin-domains',
  standalone: true,
  imports: [FormsModule, EmptyStateComponent],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0">Domains</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Manage the live domain, search creative names with AI, and port any custom domain in or out.
          </p>
        </div>
        @if (state.selectedSite()) {
          <button class="btn-ghost" (click)="loadHostnames()" [disabled]="loadingHostnames()" title="Reload connected domains">
            {{ loadingHostnames() ? '…' : 'Refresh' }}
          </button>
        }
      </header>

      @if (!state.selectedSite()) {
        <app-empty-state
          icon="🌐"
          title="No site selected"
          body="Pick a site from the sidebar to manage its domains."
        />
      } @else {

        <!-- ── 1. Provisioned backup domain ──────────────────────── -->
        <section class="bg-surface border border-border rounded-lg p-5 space-y-3">
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 class="text-base font-semibold text-white m-0">Provisioned backup domain</h3>
              <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
                Every site ships with a free, always-on subdomain. Use it while a custom domain propagates or as a permanent home.
              </p>
            </div>
            <span class="px-2 py-0.5 text-[0.65rem] rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">Active</span>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <code class="font-mono text-sm text-primary bg-black/30 px-3 py-2 rounded border border-border flex-1 min-w-[260px]" data-testid="backup-domain">
              {{ backupDomain() }}
            </code>
            <button class="btn-ghost" (click)="copyBackup()" title="Copy to clipboard">Copy</button>
            <a class="btn-ghost" [href]="'https://' + backupDomain()" target="_blank" rel="noopener noreferrer" title="Open in a new tab">Open ↗</a>
          </div>
        </section>

        <!-- ── 2. Add a domain ───────────────────────────────────── -->
        <section class="bg-surface border border-border rounded-lg p-5 space-y-5">
          <div>
            <h3 class="text-base font-semibold text-white m-0">Add a domain</h3>
            <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
              Connect a domain you already own, or search for an available one with AI.
            </p>
          </div>

          <!-- Custom CNAME entry (re-uses existing /hostnames POST) -->
          <form class="space-y-2" (submit)="addCustom($event)">
            <label class="text-[0.72rem] uppercase tracking-wider text-text-secondary block">Already own a domain?</label>
            <div class="flex gap-2 flex-wrap">
              <input
                class="input-field flex-1 min-w-[240px]"
                type="text"
                name="customDomain"
                placeholder="www.example.com"
                [(ngModel)]="customDomainInput"
                [disabled]="addingCustom()"
                data-testid="custom-domain-input"
              />
              <button class="btn-primary" type="submit" [disabled]="!isValidDomain(customDomainInput()) || addingCustom()">
                {{ addingCustom() ? 'Adding…' : 'Add domain' }}
              </button>
            </div>
            <p class="text-[0.7rem] text-text-secondary m-0">
              Point a CNAME record to <code class="font-mono text-primary">projectsites.dev</code> first, then add it here.
            </p>
          </form>

          <!-- AI domain search -->
          <div class="border-t border-border pt-5 space-y-3">
            <label class="text-[0.72rem] uppercase tracking-wider text-text-secondary block">Search creative domains with AI</label>
            <div class="flex gap-2 flex-wrap">
              <input
                class="input-field flex-1 min-w-[240px]"
                type="text"
                placeholder="e.g. premium barber shop in Newark"
                [(ngModel)]="aiQuery"
                [disabled]="aiSearching()"
                (keydown.enter)="runAiSearch()"
                data-testid="ai-search-input"
              />
              <button class="btn-primary" type="button" (click)="runAiSearch()" [disabled]="aiSearching()" data-testid="ai-search-btn">
                {{ aiSearching() ? 'Searching…' : 'Search with AI' }}
              </button>
            </div>

            @if (aiSearching()) {
              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="ai-results-loading">
                @for (i of [0,1,2,3,4,5]; track i) {
                  <div class="h-[96px] bg-black/30 border border-border rounded-md animate-pulse"></div>
                }
              </div>
            } @else if (aiResults()) {
              @let r = aiResults()!;
              @if (r.available.length === 0 && r.unavailable.length === 0) {
                <p class="text-[0.78rem] text-text-secondary">No suggestions yet. Try a more descriptive query.</p>
              } @else {
                <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="ai-results">
                  @for (card of r.available; track card.name) {
                    <article class="bg-black/30 border border-emerald-500/30 rounded-md p-3 space-y-2 transition-colors hover:border-emerald-500/60">
                      <header class="flex items-start justify-between gap-2">
                        <code class="font-mono text-sm text-white break-all">{{ card.name }}</code>
                        <span class="px-2 py-0.5 text-[0.6rem] rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 uppercase tracking-wider whitespace-nowrap" title="Available for registration">✓ Available</span>
                      </header>
                      <div class="flex items-center justify-between gap-2 text-[0.7rem] text-text-secondary">
                        <span class="px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">{{ strategyLabel(card.strategy) }}</span>
                        <span class="font-mono">{{ formatPrice(card.price_usd) }}/yr</span>
                      </div>
                      <button class="btn-primary w-full text-[0.78rem] py-1.5" type="button" (click)="registerDomain(card.name)" [disabled]="registering() === card.name" [attr.data-testid]="'register-' + card.name">
                        {{ registering() === card.name ? 'Registering…' : 'Register' }}
                      </button>
                    </article>
                  }
                  @for (card of r.unavailable; track card.name) {
                    <article class="bg-black/20 border border-border rounded-md p-3 space-y-2 opacity-60">
                      <header class="flex items-start justify-between gap-2">
                        <code class="font-mono text-sm text-text-secondary break-all line-through">{{ card.name }}</code>
                        <span class="px-2 py-0.5 text-[0.6rem] rounded-full bg-red-500/10 text-red-300 border border-red-500/30 uppercase tracking-wider whitespace-nowrap" title="Already registered">🔒 Taken</span>
                      </header>
                      <div class="flex items-center justify-between gap-2 text-[0.7rem] text-text-secondary">
                        <span class="px-1.5 py-0.5 rounded bg-black/40 border border-border">{{ strategyLabel(card.strategy) }}</span>
                      </div>
                    </article>
                  }
                </div>
              }
            }
          </div>
        </section>

        <!-- ── 3. Connected domains ─────────────────────────────── -->
        <section class="bg-surface border border-border rounded-lg p-5 space-y-4">
          <div>
            <h3 class="text-base font-semibold text-white m-0">Connected domains</h3>
            <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
              Every domain currently pointing to this site. The primary domain is what visitors see first.
            </p>
          </div>

          @if (loadingHostnames()) {
            <div class="space-y-2" data-testid="hostnames-loading">
              @for (i of [0,1,2]; track i) {
                <div class="h-12 bg-black/30 border border-border rounded-md animate-pulse"></div>
              }
            </div>
          } @else if (hostnames().length === 0) {
            <app-empty-state
              icon="🔗"
              title="No connected domains"
              body="Add a domain above or search for an available one with AI."
            />
          } @else {
            <div class="overflow-x-auto">
              <table class="w-full text-[0.82rem]" data-testid="hostnames-table">
                <thead>
                  <tr class="text-left text-[0.68rem] uppercase tracking-wider text-text-secondary border-b border-border">
                    <th class="py-2 pr-3 font-medium">Hostname</th>
                    <th class="py-2 pr-3 font-medium">Status</th>
                    <th class="py-2 pr-3 font-medium">SSL</th>
                    <th class="py-2 pr-3 font-medium">Primary</th>
                    <th class="py-2 pr-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (h of hostnames(); track h.id) {
                    <tr class="border-b border-border/50 last:border-b-0">
                      <td class="py-2 pr-3 font-mono text-white break-all">{{ h.hostname }}</td>
                      <td class="py-2 pr-3">
                        <span class="px-1.5 py-0.5 text-[0.65rem] rounded border" [class]="statusClass(h.status)">{{ h.status }}</span>
                      </td>
                      <td class="py-2 pr-3 text-text-secondary">{{ h.ssl_status || '—' }}</td>
                      <td class="py-2 pr-3">
                        <input
                          type="radio"
                          name="primary"
                          [checked]="h.is_primary === 1"
                          (change)="makePrimary(h)"
                          [disabled]="busyHostname() === h.id"
                          [attr.aria-label]="'Make ' + h.hostname + ' primary'"
                        />
                      </td>
                      <td class="py-2 pr-3 text-right">
                        <div class="flex justify-end gap-1 flex-wrap">
                          @if (h.type === 'custom_cname') {
                            <button
                              class="btn-ghost text-[0.72rem] py-1 px-2"
                              type="button"
                              (click)="openTransferModal(h)"
                              [disabled]="busyHostname() === h.id"
                              [attr.data-testid]="'transfer-' + h.hostname"
                              title="Port this domain to another registrar"
                            >
                              Transfer out
                            </button>
                          }
                          @if (h.type !== 'free_subdomain') {
                            <button
                              class="btn-ghost text-[0.72rem] py-1 px-2 text-red-400 hover:text-red-300"
                              type="button"
                              (click)="removeHostname(h)"
                              [disabled]="busyHostname() === h.id"
                              title="Remove this hostname from the site"
                            >
                              Remove
                            </button>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      }

      <!-- ── Transfer-out modal ─────────────────────────────────── -->
      @if (transferModal(); as t) {
        <div class="modal-overlay" (click)="closeTransferModal()" data-testid="transfer-modal">
          <div class="modal-panel max-w-[520px]" (click)="$event.stopPropagation()">
            <header class="modal-head">
              <h3 class="m-0 text-base font-semibold text-white">Port {{ t.hostname.hostname }} to another registrar</h3>
              <button class="text-text-secondary hover:text-white" type="button" (click)="closeTransferModal()" aria-label="Close">×</button>
            </header>
            <div class="p-5 space-y-4 text-[0.82rem]">
              @if (!t.authCode) {
                <p class="text-text-secondary m-0">
                  We will unlock the domain at Cloudflare and generate an authorization (EPP) code you can hand to your new registrar.
                  The transfer itself happens at the gaining registrar — Cloudflare typically releases the domain within 5 to 7 days.
                </p>
                <ul class="text-text-secondary text-[0.78rem] list-disc pl-5 space-y-1 m-0">
                  <li>Site traffic keeps flowing during the transfer.</li>
                  <li>If you change your mind, re-lock the domain in Cloudflare before the transfer completes.</li>
                  <li>You will lose Cloudflare's at-cost pricing once the domain moves.</li>
                </ul>
                <label class="block">
                  <span class="text-[0.7rem] uppercase tracking-wider text-text-secondary block mb-1">New registrar (optional)</span>
                  <input class="input-field w-full" type="text" placeholder="e.g. Namecheap" [(ngModel)]="transferNewRegistrar" />
                </label>
                <div class="flex justify-end gap-2">
                  <button class="btn-ghost" type="button" (click)="closeTransferModal()">Cancel</button>
                  <button class="btn-primary" type="button" (click)="confirmTransfer()" [disabled]="t.submitting" data-testid="transfer-confirm">
                    {{ t.submitting ? 'Generating code…' : 'Generate auth code' }}
                  </button>
                </div>
              } @else {
                <p class="text-emerald-300 m-0 text-[0.85rem]">
                  Provide this auth code to your new registrar. Unlock confirmed at Cloudflare. Transfer should complete within 5-7 days.
                </p>
                <div class="bg-black/40 border border-primary/30 rounded p-3 flex items-center justify-between gap-2">
                  <code class="font-mono text-primary text-sm break-all" data-testid="transfer-auth-code">{{ t.authCode }}</code>
                  <button class="btn-ghost text-[0.72rem]" type="button" (click)="copyText(t.authCode)" title="Copy auth code">Copy</button>
                </div>
                <p class="text-[0.75rem] text-text-secondary m-0">
                  <a class="text-primary hover:underline" [href]="t.instructionsUrl" target="_blank" rel="noopener noreferrer">Read Cloudflare's transfer-out guide ↗</a>
                </p>
                <div class="flex justify-end">
                  <button class="btn-primary" type="button" (click)="closeTransferModal()">Done</button>
                </div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        z-index: 50;
      }
      .modal-panel {
        background: #0f0f1a;
        border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
        border-radius: 0.5rem;
        width: 100%;
        max-width: 520px;
        max-height: calc(100vh - 2rem);
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
      }
      .modal-head {
        padding: 0.85rem 1.25rem;
        border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
    `,
  ],
})
export class AdminDomainsComponent implements OnInit {
  /** Shared admin state — read-only access to the selected site. */
  readonly state = inject(AdminStateService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  /** ───── Form / input state ───── */
  customDomainInput = signal('');
  aiQuery = signal('');

  /** ───── Async state ───── */
  hostnames = signal<readonly Hostname[]>([]);
  loadingHostnames = signal(false);
  addingCustom = signal(false);
  aiSearching = signal(false);
  aiResults = signal<{ available: readonly DomainCard[]; unavailable: readonly DomainCard[] } | null>(null);
  registering = signal<string | null>(null);
  busyHostname = signal<string | null>(null);

  /** Transfer-out modal state. `null` when closed. */
  transferModal = signal<{
    readonly hostname: Hostname;
    authCode: string | null;
    instructionsUrl: string;
    submitting: boolean;
  } | null>(null);
  transferNewRegistrar = signal('');

  /** Computed: the default `{slug}.projectsites.dev` fallback for the site. */
  readonly backupDomain = computed<string>(() => {
    const site = this.state.selectedSite();
    return site ? `${site.slug}.projectsites.dev` : '';
  });

  constructor() {
    // Reactively reload hostnames when the selected site changes.
    effect(() => {
      const site = this.state.selectedSite();
      if (site) {
        this.loadHostnames();
      } else {
        this.hostnames.set([]);
      }
    });
  }

  ngOnInit(): void {
    // No-op — effect() above handles initial load.
  }

  // ─── Data loaders ──────────────────────────────────────────

  /** Fetch the hostname list for the currently-selected site. */
  loadHostnames(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.loadingHostnames.set(true);
    this.api.get<{ data: readonly Hostname[] }>(`/sites/${site.id}/hostnames`).subscribe({
      next: (res) => {
        this.hostnames.set(res.data ?? []);
        this.loadingHostnames.set(false);
      },
      error: () => {
        this.loadingHostnames.set(false);
        this.toast.error('Failed to load connected domains');
      },
    });
  }

  // ─── Backup-domain helpers ─────────────────────────────────

  /** Copy the backup domain to the clipboard, with a success toast. */
  copyBackup(): void {
    const value = this.backupDomain();
    if (!value) return;
    this.copyText(value, 'Backup domain copied');
  }

  // ─── Add custom CNAME ──────────────────────────────────────

  /**
   * Validate an FQDN-shaped string. Loose check (`label.label.tld`) — server
   * enforces the strict rules via Zod.
   */
  isValidDomain(value: string): boolean {
    return /^[a-z0-9][a-z0-9-]*\.[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(value.trim());
  }

  /** Submit handler for the "Already own a domain?" form. */
  addCustom(event: Event): void {
    event.preventDefault();
    const site = this.state.selectedSite();
    const hostname = this.customDomainInput().trim().toLowerCase();
    if (!site || !this.isValidDomain(hostname)) return;
    this.addingCustom.set(true);
    this.api
      .post<{ data: { hostname: string } }>(`/sites/${site.id}/hostnames`, {
        hostname,
        type: 'custom_cname',
      })
      .subscribe({
        next: () => {
          this.toast.success(`Added ${hostname}`);
          this.customDomainInput.set('');
          this.addingCustom.set(false);
          this.loadHostnames();
        },
        error: (err: { error?: { error?: { message?: string } } }) => {
          this.addingCustom.set(false);
          this.toast.error(err?.error?.error?.message ?? 'Failed to add domain');
        },
      });
  }

  // ─── AI domain search ──────────────────────────────────────

  /** Fan out 10 parallel AI strategies and merge with availability data. */
  runAiSearch(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    const query = this.aiQuery().trim();
    this.aiSearching.set(true);
    this.aiResults.set(null);
    this.api.post<AiSearchResponse>(`/sites/${site.id}/domains/ai-search`, { query }).subscribe({
      next: (res) => {
        this.aiResults.set({
          available: res.data?.available ?? [],
          unavailable: res.data?.unavailable ?? [],
        });
        this.aiSearching.set(false);
      },
      error: () => {
        this.aiSearching.set(false);
        this.toast.error('Domain search failed. Try again in a moment.');
      },
    });
  }

  /** Register an available domain card via Cloudflare Registrar. */
  registerDomain(name: string): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.registering.set(name);
    this.api
      .post<{ data: { domain: string; status: string } }>(`/sites/${site.id}/domains/register`, {
        domain: name,
      })
      .subscribe({
        next: () => {
          this.registering.set(null);
          this.toast.success(`Registered ${name}`);
          // Drop the freshly-registered card from the available list so it
          // doesn't re-tempt the user.
          const current = this.aiResults();
          if (current) {
            this.aiResults.set({
              available: current.available.filter((c) => c.name !== name),
              unavailable: current.unavailable,
            });
          }
          this.loadHostnames();
        },
        error: (err: { error?: { error?: { message?: string } } }) => {
          this.registering.set(null);
          this.toast.error(err?.error?.error?.message ?? `Failed to register ${name}`);
        },
      });
  }

  /** Friendly label for a strategy id (falls back to the raw id). */
  strategyLabel(id: string): string {
    return STRATEGY_LABEL[id] ?? id;
  }

  /** Render a USD price for a domain card. */
  formatPrice(usd: number): string {
    if (!usd || usd <= 0) return '—';
    return `$${usd.toFixed(2)}`;
  }

  // ─── Connected domains actions ─────────────────────────────

  /** Map a hostname status to a colored badge class. */
  statusClass(status: string): string {
    switch (status) {
      case 'active':
        return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40';
      case 'pending':
      case 'pending_validation':
        return 'bg-amber-500/10 text-amber-300 border-amber-500/40';
      case 'verification_failed':
      case 'error':
        return 'bg-red-500/10 text-red-300 border-red-500/40';
      default:
        return 'bg-black/40 text-text-secondary border-border';
    }
  }

  /** Promote a hostname to primary. */
  makePrimary(h: Hostname): void {
    const site = this.state.selectedSite();
    if (!site || h.is_primary === 1) return;
    this.busyHostname.set(h.id);
    this.api.put(`/sites/${site.id}/hostnames/${h.id}/primary`).subscribe({
      next: () => {
        this.busyHostname.set(null);
        this.toast.success(`${h.hostname} is now primary`);
        this.loadHostnames();
      },
      error: () => {
        this.busyHostname.set(null);
        this.toast.error('Failed to update primary domain');
      },
    });
  }

  /** Remove a custom hostname (free subdomains cannot be removed). */
  removeHostname(h: Hostname): void {
    const site = this.state.selectedSite();
    if (!site) return;
    if (!confirm(`Remove ${h.hostname} from this site?`)) return;
    this.busyHostname.set(h.id);
    this.api.delete(`/sites/${site.id}/hostnames/${h.id}`).subscribe({
      next: () => {
        this.busyHostname.set(null);
        this.toast.success(`Removed ${h.hostname}`);
        this.loadHostnames();
      },
      error: () => {
        this.busyHostname.set(null);
        this.toast.error('Failed to remove domain');
      },
    });
  }

  // ─── Transfer-out flow ─────────────────────────────────────

  /** Open the port-out modal for a custom hostname. */
  openTransferModal(h: Hostname): void {
    this.transferNewRegistrar.set('');
    this.transferModal.set({
      hostname: h,
      authCode: null,
      instructionsUrl: 'https://developers.cloudflare.com/registrar/domains/transfer-domain-away/',
      submitting: false,
    });
  }

  /** Close the modal, resetting any state. */
  closeTransferModal(): void {
    this.transferModal.set(null);
  }

  /** Hit the transfer-out endpoint and surface the resulting auth code. */
  confirmTransfer(): void {
    const modal = this.transferModal();
    const site = this.state.selectedSite();
    if (!modal || !site) return;
    this.transferModal.set({ ...modal, submitting: true });
    const newRegistrar = this.transferNewRegistrar().trim();
    this.api
      .post<TransferOutResponse>(
        `/sites/${site.id}/domains/${modal.hostname.hostname}/transfer-out`,
        newRegistrar ? { new_registrar: newRegistrar } : {},
      )
      .subscribe({
        next: (res) => {
          this.transferModal.set({
            hostname: modal.hostname,
            authCode: res.data.auth_code,
            instructionsUrl: res.data.instructions_url,
            submitting: false,
          });
        },
        error: (err: { error?: { error?: { message?: string } } }) => {
          this.transferModal.set({ ...modal, submitting: false });
          this.toast.error(err?.error?.error?.message ?? 'Transfer initiation failed');
        },
      });
  }

  // ─── Utilities ─────────────────────────────────────────────

  /** Copy arbitrary text to the clipboard with toast feedback. */
  copyText(value: string, successMessage = 'Copied to clipboard'): void {
    if (!value) return;
    void navigator.clipboard
      .writeText(value)
      .then(() => this.toast.success(successMessage))
      .catch(() => this.toast.error('Copy failed'));
  }
}
