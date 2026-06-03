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
import { AdminStateService } from '../admin-state.service';
import { RevealDirective } from '../../../directives/reveal.directive';
import { HlmButtonDirective, HlmInputDirective } from '../../../ui';

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
  imports: [CommonModule, FormsModule, RevealDirective, HlmButtonDirective, HlmInputDirective],
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
        <!-- Create -->
        <div class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col gap-4 mb-6">
          <label class="flex flex-col gap-1.5">
            <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">Recipe name</span>
            <input hlmInput data-testid="recipes-name" placeholder="e.g. Email me on new lead" [(ngModel)]="nameModel" />
          </label>
          <div class="flex flex-col gap-3 sm:flex-row">
            <label class="flex flex-col gap-1.5 flex-1">
              <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">When (trigger)</span>
              <select data-testid="recipes-trigger" class="bg-dark border border-white/[0.12] rounded-lg px-3 py-2 text-light text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" [(ngModel)]="triggerModel">
                @for (t of triggers; track t) { <option [value]="t">{{ t }}</option> }
              </select>
            </label>
            <label class="flex flex-col gap-1.5 flex-1">
              <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">Do (action)</span>
              <select data-testid="recipes-action" class="bg-dark border border-white/[0.12] rounded-lg px-3 py-2 text-light text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" [(ngModel)]="actionModel">
                @for (a of actions; track a) { <option [value]="a">{{ a }}</option> }
              </select>
            </label>
          </div>
          <div class="flex items-center gap-3">
            <button hlmBtn data-testid="recipes-create-btn" [disabled]="creating()" (click)="create()">
              {{ creating() ? 'Creating…' : 'Add recipe' }}
            </button>
            <label class="inline-flex items-center gap-2 cursor-pointer text-sm text-light">
              <input type="checkbox" class="accent-primary w-4 h-4" [(ngModel)]="enabledModel" />
              <span>Enabled</span>
            </label>
          </div>
        </div>

        @if (error()) {
          <div data-testid="recipes-error" role="alert" class="mb-5 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-300">{{ error() }}</div>
        }

        @if (loading()) {
          <p class="text-text-secondary text-sm">Loading recipes…</p>
        } @else if (recipes().length === 0) {
          <p class="text-text-secondary text-sm">No automations yet — add one above.</p>
        } @else {
          <ul class="flex flex-col gap-2">
            @for (r of recipes(); track r.id) {
              <li data-testid="recipes-row" class="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2.5">
                <div class="min-w-0">
                  <span class="text-sm text-light block truncate">{{ r.name }}</span>
                  <span class="text-[0.7rem] text-text-secondary">{{ r.trigger.type }} → {{ r.actions[0]?.type }}{{ r.enabled ? '' : ' · disabled' }}</span>
                </div>
                <button hlmBtn variant="ghost" size="sm" data-testid="recipes-delete" (click)="remove(r.id)">Delete</button>
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
  private readonly state = inject(AdminStateService);

  readonly triggers = TRIGGERS;
  readonly actions = ACTIONS;
  readonly site = computed(() => this.state.selectedSite());

  readonly nameModel = signal('');
  readonly triggerModel = signal<string>(TRIGGERS[0] ?? 'form.submitted');
  readonly actionModel = signal<string>(ACTIONS[0] ?? 'send_email');
  readonly enabledModel = signal(true);

  readonly recipes = signal<Recipe[]>([]);
  readonly loading = signal(false);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);

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

  load(): void {
    const id = this.siteId();
    if (!id) return;
    this.loading.set(true);
    this.error.set(null);
    this.api.get<{ ok: boolean; recipes: Recipe[] }>(`/sites/${id}/recipes`).subscribe({
      next: (res) => {
        this.recipes.set(res.recipes ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Automations are not available for this site.');
        this.loading.set(false);
      },
    });
  }

  create(): void {
    const id = this.siteId();
    if (!id || this.creating()) return;
    if (!this.nameModel().trim()) {
      this.toast.error('Give the recipe a name.');
      return;
    }
    this.creating.set(true);
    this.api
      .post<{ ok: boolean; id: string }>(`/sites/${id}/recipes`, {
        name: this.nameModel().trim(),
        enabled: this.enabledModel(),
        trigger: { type: this.triggerModel() },
        actions: [{ type: this.actionModel() }],
      })
      .subscribe({
        next: () => {
          this.nameModel.set('');
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

  remove(recipeId: string): void {
    const id = this.siteId();
    if (!id) return;
    this.api.delete<{ ok: boolean }>(`/sites/${id}/recipes/${recipeId}`).subscribe({
      next: () => {
        this.toast.success('Recipe removed.');
        this.load();
      },
      error: () => this.toast.error('Could not remove the recipe.'),
    });
  }
}
