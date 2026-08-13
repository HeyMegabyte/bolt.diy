import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

/** A single activation step, mirrors the worker `ChecklistStep` schema. */
interface ChecklistStep {
  id: string;
  title: string;
  done: boolean;
  cta_url: string;
  cta_label: string;
  next: boolean;
}

/** `GET /api/onboarding/checklist` response, mirrors the worker `ChecklistResponse`. */
interface ChecklistResponse {
  dismissed: boolean;
  complete: boolean;
  steps: ChecklistStep[];
}

/**
 * Onboarding activation checklist — the client for the `onboarding_copilot`
 * feature. Surfaces a new org's next-best action (create → publish → domain →
 * explore) on the /admin getting-started hub.
 *
 * @remarks
 * The API IS the flag gate: `GET /api/onboarding/checklist` returns 404 when the
 * `onboarding_copilot` flag is off, so the widget renders nothing for orgs the
 * feature is dark for — no separate client flag check needed. It also self-hides
 * when the checklist is complete or the org has dismissed it.
 *
 * @example
 * <app-onboarding-checklist />
 */
@Component({
  selector: 'app-onboarding-checklist',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (visible()) {
      <section class="oc" role="region" aria-labelledby="oc-heading" data-testid="onboarding-checklist">
        <header class="oc-head">
          <div>
            <p class="oc-eyebrow">Getting started</p>
            <h2 id="oc-heading" class="oc-title">Finish setting up your site</h2>
          </div>
          <div class="oc-progress" data-testid="onboarding-progress" aria-label="Setup progress">
            <span class="oc-progress-num">{{ doneCount() }}</span><span class="oc-progress-den">/{{ total() }}</span>
          </div>
        </header>

        <ul class="oc-list">
          @for (s of steps(); track s.id) {
            <li
              class="oc-step"
              [class.oc-step--done]="s.done"
              [class.oc-step--next]="s.next"
              [attr.data-testid]="'onboarding-step-' + s.id"
            >
              <span class="oc-check" aria-hidden="true">
                @if (s.done) {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                } @else {
                  <span class="oc-dot"></span>
                }
              </span>
              <span class="oc-step-title">{{ s.title }}</span>
              @if (s.next) {
                <a
                  [routerLink]="ctaFor(s).link"
                  [fragment]="ctaFor(s).fragment"
                  class="oc-cta"
                  data-testid="onboarding-next-cta"
                  [attr.aria-label]="ctaFor(s).label + ' — recommended next step'"
                >{{ ctaFor(s).label }} <span aria-hidden="true">→</span></a>
              }
            </li>
          }
        </ul>

        <button type="button" class="oc-dismiss" (click)="dismiss()" data-testid="onboarding-dismiss">
          Dismiss checklist
        </button>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .oc {
      margin: 0 0 1.25rem; padding: 1.25rem 1.4rem;
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 16%, transparent);
      border-radius: var(--ps-radius-xl, 22px);
      background:
        radial-gradient(120% 140% at 0% 0%, color-mix(in oklch, var(--ps-accent, #00e5ff) 7%, transparent), transparent 60%),
        color-mix(in oklch, var(--ps-accent, #00e5ff) 2.5%, transparent);
      animation: ocIn 0.4s ease-out;
    }
    @media (prefers-reduced-motion: reduce) { .oc { animation: none; } }
    @keyframes ocIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .oc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
    .oc-eyebrow { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ps-accent, #00e5ff); margin: 0 0 0.25rem; }
    .oc-title { font-size: 1.05rem; font-weight: 700; margin: 0; color: var(--ps-ink, #f4f4ff); }
    .oc-progress { flex-shrink: 0; font-variant-numeric: tabular-nums; line-height: 1; }
    .oc-progress-num { font-size: 1.3rem; font-weight: 800; color: var(--ps-accent, #00e5ff); }
    .oc-progress-den { font-size: 0.9rem; color: rgba(255,255,255,0.45); }
    .oc-list { list-style: none; margin: 0 0 1rem; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .oc-step { display: flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0.7rem; border-radius: 12px; min-width: 0; }
    .oc-step--next { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 9%, transparent); border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 26%, transparent); }
    .oc-check { flex-shrink: 0; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; color: var(--ps-accent, #00e5ff); }
    .oc-check svg { width: 16px; height: 16px; }
    .oc-dot { width: 9px; height: 9px; border-radius: 999px; border: 2px solid rgba(255,255,255,0.28); }
    .oc-step--done .oc-step-title { color: rgba(255,255,255,0.5); text-decoration: line-through; text-decoration-color: rgba(255,255,255,0.25); }
    .oc-step-title { font-size: 0.9rem; color: var(--ps-ink, #f4f4ff); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .oc-cta {
      margin-left: auto; flex-shrink: 0; display: inline-flex; align-items: center; gap: 0.3rem;
      padding: 0.42rem 0.9rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; text-decoration: none;
      color: #041016; background: var(--ps-accent, #00e5ff);
      transition: filter 0.16s ease, transform 0.16s ease;
    }
    .oc-cta:hover { filter: brightness(1.08); transform: translateX(2px); }
    .oc-cta:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .oc-cta { transition: none; } .oc-cta:hover { transform: none; } }
    .oc-dismiss {
      background: transparent; border: 0; color: rgba(255,255,255,0.5); cursor: pointer;
      font-size: 0.78rem; padding: 0.2rem 0.1rem; text-decoration: underline; text-underline-offset: 3px;
    }
    .oc-dismiss:hover { color: var(--ps-ink, #f4f4ff); }
    .oc-dismiss:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; border-radius: 4px; }
    @media (max-width: 640px) { .oc-step { flex-wrap: wrap; } .oc-cta { margin-left: 32px; } }
  `],
})
export class OnboardingChecklistComponent implements OnInit {
  private readonly api = inject(ApiService);

  /** Raw checklist response, or null when the feature is dark / errored / dismissed. */
  private readonly data = signal<ChecklistResponse | null>(null);

  readonly steps = computed(() => this.data()?.steps ?? []);
  readonly total = computed(() => this.steps().length);
  readonly doneCount = computed(() => this.steps().filter((s) => s.done).length);

  /** Show only when we have real steps, the org hasn't dismissed, and it isn't complete. */
  readonly visible = computed(() => {
    const d = this.data();
    return !!d && !d.dismissed && !d.complete && d.steps.length > 0;
  });

  /**
   * Correct CTA target per step id. The worker service ships stale `cta_url`s
   * (`/admin/sites`, `/admin/domains`) that resolve to the admin 404 — this
   * single-site admin has no sites-list/domains route. Remap by stable step id
   * to the real routes; fall back to the raw url for any unknown id.
   */
  ctaFor(step: ChecklistStep): { link: string; fragment?: string; label: string } {
    switch (step.id) {
      case 'create_site':
        return { link: '/create', label: 'Create a site' };
      case 'publish_site':
        return { link: '/admin', label: 'Open dashboard' };
      case 'add_custom_domain':
        return { link: '/admin/settings', fragment: 'domains', label: 'Add a domain' };
      case 'invite_or_explore':
        return { link: '/admin/settings', fragment: 'team', label: 'Invite a teammate' };
      default:
        return { link: step.cta_url || '/admin', label: step.cta_label || 'Continue' };
    }
  }

  ngOnInit(): void {
    // `silent: true` — a 404 (flag off) is expected, never a user-facing toast.
    this.api.get<ChecklistResponse>('/onboarding/checklist', undefined, { silent: true }).subscribe({
      next: (res) => this.data.set(res),
      error: () => this.data.set(null),
    });
  }

  /** Persist a dismissal (KV, 1-year TTL) and hide the widget immediately. */
  dismiss(): void {
    const current = this.data();
    if (current) this.data.set({ ...current, dismissed: true });
    this.api.post('/onboarding/dismiss', {}, { silent: true }).subscribe({
      next: () => {},
      error: () => {},
    });
  }
}
