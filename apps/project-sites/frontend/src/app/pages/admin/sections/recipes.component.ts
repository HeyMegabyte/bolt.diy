/**
 * @component AdminRecipesComponent
 * @description `/admin/recipes` — Automation Builder (#11) management for the
 * selected site. List recipes, create one (name + trigger + action + enabled),
 * and delete. Cyan/black cockpit.
 *
 * Backend (`/api/sites/:siteId/recipes`) is flag-gated (`automation_builder`) —
 * 404 when off → friendly "not available" error.
 */

import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';
import { AdminStateService } from '../admin-state.service';
import { RouterLink } from '@angular/router';
import { RevealDirective } from '../../../directives/reveal.directive';
import { HlmButtonDirective, HlmInputDirective, HlmSelectDirective, HlmCheckboxDirective } from '../../../ui';
import { SkeletonComponent, EmptyStateComponent, ErrorCardComponent } from '../../../components/states';

/** Mirror the worker allowlists (services/automation_builder.ts). */
const TRIGGERS = ['form.submitted', 'site.published', 'payment.succeeded', 'review.received', 'build.failed', 'domain.active'];
const ACTIONS = ['send_email', 'webhook', 'add_tag', 'notify', 'create_task'];

interface Recipe {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { type: string };
  actions: { type: string }[];
}

@Component({
  selector: 'app-admin-recipes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RevealDirective, HlmButtonDirective, HlmInputDirective, HlmSelectDirective, HlmCheckboxDirective, SkeletonComponent, EmptyStateComponent, ErrorCardComponent],
  template: `
    <section class="max-w-3xl mx-auto px-5 py-7" appReveal>
      <header class="mb-6">
        <p class="font-mono uppercase tracking-wider text-[0.7rem] text-primary mb-1">Automations</p>
        <h2 class="text-2xl font-semibold text-light">Automation Builder</h2>
        <p class="text-text-secondary text-sm mt-1 max-w-prose">
          When something happens on your site, run an action automatically — no code.
        </p>
      </header>

      @if (!site()) {
        <div data-testid="recipes-empty" class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-center">
          <p class="text-text-secondary text-sm">Select a site from <strong class="text-light">Sites</strong> to manage its automations.</p>
        </div>
      } @else {
        @if (flagDisabled()) {
          <!-- Flag OFF (404) → calm cohesive notice (NOT alarming red), inline Feature-Flags link. -->
          <div data-testid="recipes-flag-gate" role="status" class="mb-5 rounded-xl border border-[#00E5FF]/15 bg-[#00E5FF]/[0.04] p-4 text-sm text-text-secondary">
            Automations are behind the <code class="text-[#00E5FF]">automation_builder</code> feature flag (currently disabled). Enable it in
            <a routerLink="/admin/feature-flags" class="text-[#00E5FF] underline underline-offset-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] rounded-sm">Feature&nbsp;Flags</a>.
          </div>
        } @else if (loadError()) {
          <!-- Transient (non-404) failure → shared error card with Retry + support ref. -->
          <app-error-card
            data-testid="recipes-error"
            class="block mb-5"
            title="Couldn’t load automations"
            [message]="loadError()!"
            [correlationId]="loadErrorRef()"
            (retry)="load()" />
        }
        <!-- Create -->
        <div class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col gap-4 mb-6 transition-opacity" [class.opacity-60]="formLocked()">
          <label class="flex flex-col gap-1.5">
            <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">Recipe name</span>
            <input hlmInput data-testid="recipes-name" placeholder="e.g. Email me on new lead" [(ngModel)]="nameModel" [disabled]="formLocked()" />
          </label>
          <div class="flex flex-col gap-3 sm:flex-row">
            <label class="flex flex-col gap-1.5 flex-1">
              <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">When (trigger)</span>
              <select hlmSelect data-testid="recipes-trigger" class="w-full" [(ngModel)]="triggerModel" [disabled]="formLocked()">
                @for (t of triggers; track t) { <option [value]="t">{{ t }}</option> }
              </select>
            </label>
            <label class="flex flex-col gap-1.5 flex-1">
              <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">Do (action)</span>
              <select hlmSelect data-testid="recipes-action" class="w-full" [(ngModel)]="actionModel" [disabled]="formLocked()">
                @for (a of actions; track a) { <option [value]="a">{{ a }}</option> }
              </select>
            </label>
          </div>
          <!-- Per-action config -->
          <label class="flex flex-col gap-1.5">
            <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">{{ primaryLabel() }}</span>
            <input hlmInput data-testid="recipes-cfg-primary" [placeholder]="primaryPlaceholder()" [(ngModel)]="cfgPrimary" [disabled]="formLocked()"
              [attr.type]="actionModel() === 'send_email' ? 'email' : actionModel() === 'webhook' ? 'url' : 'text'"
              [attr.aria-invalid]="configInvalid()" [attr.aria-describedby]="configInvalid() ? 'recipes-cfg-hint' : null"
              [class.ring-1]="configInvalid()" [class.ring-red-500/60]="configInvalid()" [class.border-red-500/50]="configInvalid()" />
            @if (configInvalid()) {
              <span id="recipes-cfg-hint" data-testid="recipes-cfg-hint" class="text-[0.7rem] text-red-300/90">
                @if (actionModel() === 'webhook') {
                  Must be a valid <code class="text-red-200">https://</code> URL with a public hostname.
                } @else {
                  Must be a valid email address.
                }
              </span>
            }
          </label>
          @if (showSecondary()) {
            <label class="flex flex-col gap-1.5">
              <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">Subject (optional)</span>
              <input hlmInput data-testid="recipes-cfg-secondary" placeholder="New lead from your site" [(ngModel)]="cfgSecondary" [disabled]="formLocked()" />
            </label>
          }
          <div class="flex items-center gap-3">
            <button hlmBtn data-testid="recipes-create-btn"
                    [disabled]="creating() || !canSubmit() || formLocked()"
                    [attr.title]="formLocked() ? 'Automations are not available — see the notice above' : null"
                    (click)="create()">
              {{ creating() ? 'Creating…' : 'Add recipe' }}
            </button>
            <label class="inline-flex items-center gap-2 cursor-pointer text-sm text-light" [class.opacity-50]="formLocked()">
              <input type="checkbox" hlmCheckbox [(ngModel)]="enabledModel" [disabled]="formLocked()" />
              <span>Enabled</span>
            </label>
          </div>
        </div>

        @if (loading()) {
          <app-skeleton variant="table" [rows]="3" />
        } @else if (recipes().length === 0) {
          <app-empty-state icon="⚡" title="No automations yet"
            body="Create a recipe above to auto-run an action whenever a site event fires." />
        } @else {
          <ul class="flex flex-col gap-2">
            @for (r of recipes(); track r.id) {
              <li data-testid="recipes-row" class="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2.5">
                <div class="min-w-0">
                  <span class="text-sm text-light block truncate" [attr.title]="r.name">{{ r.name }}</span>
                  <span class="text-[0.7rem] text-text-secondary">{{ r.trigger.type }} → {{ r.actions[0]?.type }}{{ r.enabled ? '' : ' · disabled' }}</span>
                </div>
                <button hlmBtn variant="ghost" size="sm" data-testid="recipes-delete" (click)="remove(r.id, r.name)">Delete</button>
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
})
export class AdminRecipesComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirmSvc = inject(ConfirmService);
  private readonly state = inject(AdminStateService);

  readonly triggers = TRIGGERS;
  readonly actions = ACTIONS;
  readonly site = computed(() => this.state.selectedSite());

  readonly nameModel = signal('');
  readonly triggerModel = signal<string>(TRIGGERS[0] ?? 'form.submitted');
  readonly actionModel = signal<string>(ACTIONS[0] ?? 'send_email');
  readonly enabledModel = signal(true);

  /** Per-action config inputs — `cfgPrimary` is the main field, `cfgSecondary` the optional one. */
  readonly cfgPrimary = signal('');
  readonly cfgSecondary = signal('');

  /** Label/placeholder/required-ness of the primary config field for the selected action. */
  readonly primaryLabel = computed(() => {
    switch (this.actionModel()) {
      case 'send_email': return 'Recipient email';
      case 'webhook': return 'Endpoint URL (https)';
      case 'add_tag': return 'Tag';
      case 'notify': return 'Message (optional)';
      case 'create_task': return 'Task title';
      default: return 'Value';
    }
  });
  readonly primaryPlaceholder = computed(() => {
    switch (this.actionModel()) {
      case 'send_email': return 'owner@example.com';
      case 'webhook': return 'https://hooks.yourapp.com/projectsites';
      case 'add_tag': return 'vip';
      case 'notify': return 'New lead from your site';
      case 'create_task': return 'Follow up with the lead';
      default: return '';
    }
  });
  /** notify's message is optional; every other action requires its primary field. */
  readonly primaryRequired = computed(() => this.actionModel() !== 'notify');
  /** Only send_email has a secondary (subject) field today. */
  readonly showSecondary = computed(() => this.actionModel() === 'send_email');

  /**
   * True only when a non-empty primary value fails the SELECTED action's type
   * check — webhook needs a valid https URL (it is called server-side when the
   * recipe fires → SSRF-adjacent), send_email needs a valid recipient address.
   * Drives the inline red hint + ring.
   */
  readonly configInvalid = computed(() => {
    const v = this.cfgPrimary().trim();
    if (v.length === 0) return false; // incomplete, not invalid
    if (this.actionModel() === 'webhook') return !this.isValidHttpsUrl(v);
    if (this.actionModel() === 'send_email') return !this.isValidEmail(v);
    return false;
  });
  /** Gate for the Add-recipe button: name present + the action's typed config is valid. */
  readonly canSubmit = computed(() => {
    if (!this.nameModel().trim()) return false;
    const v = this.cfgPrimary().trim();
    if (this.actionModel() === 'webhook') return this.isValidHttpsUrl(v);
    if (this.actionModel() === 'send_email') return this.isValidEmail(v);
    if (this.primaryRequired()) return v.length > 0;
    return true; // notify with an optional (possibly empty) message
  });

  readonly recipes = signal<Recipe[]>([]);
  readonly loading = signal(false);
  readonly creating = signal(false);
  /** Flag OFF (load 404 = automation_builder disabled) → calm Feature-Flags notice. */
  readonly flagDisabled = signal(false);
  /** Transient (non-404) load failure → app-error-card with Retry. */
  readonly loadError = signal<string | null>(null);
  /** Worker request_id from a transient failure → copyable support reference. */
  readonly loadErrorRef = signal('');
  /** Either gate locks the create form (can't create against a flag-off or failed-load site). */
  readonly formLocked = computed(() => this.flagDisabled() || this.loadError() !== null);

  private loadedSiteId: string | null = null;

  constructor() {
    // Load when the selected site resolves (may arrive after mount) + reload on switch.
    effect(() => {
      const id = this.site()?.id ?? null;
      if (id && id !== this.loadedSiteId) {
        this.loadedSiteId = id;
        this.load();
      }
    });
  }

  private siteId(): string | null {
    return this.site()?.id ?? null;
  }

  /** A webhook target is called server-side, so require https + a dotted public hostname. */
  private isValidHttpsUrl(raw: string): boolean {
    if (!raw) return false;
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' && u.hostname.includes('.') && !u.hostname.endsWith('.');
    } catch {
      return false;
    }
  }

  /** Minimal RFC-pragmatic email shape — blocks junk before the automation silently no-ops server-side. */
  private isValidEmail(raw: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
  }

  /** Build the action's config payload from the inputs (mirrors the worker ACTION_CONFIG_SCHEMAS). */
  private buildActionConfig(): Record<string, string> {
    const p = this.cfgPrimary().trim();
    const s = this.cfgSecondary().trim();
    switch (this.actionModel()) {
      case 'send_email': return { to: p, ...(s ? { subject: s } : {}) };
      case 'webhook': return { url: p };
      case 'add_tag': return { tag: p };
      case 'notify': return p ? { message: p } : {};
      case 'create_task': return { title: p };
      default: return {};
    }
  }

  load(): void {
    const id = this.siteId();
    if (!id) return;
    this.loading.set(true);
    this.flagDisabled.set(false);
    this.loadError.set(null);
    this.loadErrorRef.set('');
    // Silent: this component owns its inline state — the generic ApiService
    // network toast would double-fire over it (the redundant-network-toast class).
    this.api.get<{ ok: boolean; recipes: Recipe[] }>(`/sites/${id}/recipes`, undefined, { silent: true }).subscribe({
      next: (res) => {
        this.recipes.set(res.recipes ?? []);
        this.loading.set(false);
      },
      // 404 = automation_builder flag OFF (permanent → calm Feature-Flags notice);
      // any other status = transient (→ app-error-card with Retry + request_id).
      // Previously ANY error read as "not available", so a 500 masqueraded as off.
      error: (err: { status?: number; error?: unknown } | undefined) => {
        if (err?.status === 404) {
          this.flagDisabled.set(true);
        } else {
          this.loadError.set('Could not load automations — retry.');
          this.loadErrorRef.set(this.requestIdFrom(err));
        }
        this.loading.set(false);
      },
    });
  }

  /** Pull the worker request_id from a failed response ({ error: { request_id } }) for the support reference. */
  private requestIdFrom(e: { error?: unknown } | undefined): string {
    return (e?.error as { error?: { request_id?: string } } | undefined)?.error?.request_id ?? '';
  }

  create(): void {
    const id = this.siteId();
    if (!id || this.creating()) return;
    // Don't fire a dead POST when the form is locked: flag OFF (the create route
    // 404s) or the list failed to load (state unknown → re-load before mutating).
    if (this.formLocked()) return;
    if (!this.nameModel().trim()) {
      this.toast.error('Give the recipe a name.');
      return;
    }
    const primary = this.cfgPrimary().trim();
    if (this.primaryRequired() && !primary) {
      this.toast.error(`${this.primaryLabel()} is required for "${this.actionModel()}".`);
      return;
    }
    if (this.actionModel() === 'webhook' && !this.isValidHttpsUrl(primary)) {
      this.toast.error('The webhook action needs a valid https:// URL with a public hostname.');
      return;
    }
    if (this.actionModel() === 'send_email' && !this.isValidEmail(primary)) {
      this.toast.error('Enter a valid recipient email for the send-email action.');
      return;
    }
    this.creating.set(true);
    this.api
      .post<{ ok: boolean; id: string }>(`/sites/${id}/recipes`, {
        name: this.nameModel().trim(),
        enabled: this.enabledModel(),
        trigger: { type: this.triggerModel() },
        actions: [{ type: this.actionModel(), config: this.buildActionConfig() }],
      })
      .subscribe({
        next: () => {
          this.nameModel.set('');
          this.cfgPrimary.set('');
          this.cfgSecondary.set('');
          this.toast.success('Recipe added.');
          this.creating.set(false);
          this.load();
        },
        error: (err: unknown) => {
          const msg =
            (err as { error?: { error?: { message?: string } } })?.error?.error?.message ?? 'Could not add the recipe.';
          this.toast.error(msg);
          this.creating.set(false);
        },
      });
  }

  async remove(recipeId: string, name?: string): Promise<void> {
    const id = this.siteId();
    if (!id) return;
    const ok = await this.confirmSvc.confirm({
      title: 'Delete automation',
      message: `Delete ${name ? `the automation "${name}"` : 'this automation'}? It stops running immediately and cannot be recovered — you'd have to rebuild it.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.api.delete<{ ok: boolean }>(`/sites/${id}/recipes/${recipeId}`, { silent: true }).subscribe({
      next: () => {
        this.toast.success('Recipe removed.');
        this.load();
      },
      error: () => this.toast.error('Could not remove the recipe.'),
    });
  }
}
