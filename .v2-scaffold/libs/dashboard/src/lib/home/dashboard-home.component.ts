import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CapabilityService } from '../services/capability.service';
import { MeStore } from '../services/me.store';

interface ChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly requires: string | null;
  readonly cta: readonly string[];
  readonly done: boolean;
}

/**
 * Capability-aware first-run checklist + summary tiles. Replaces the
 * legacy `/me` / `/work/dashboard` landing surfaces.
 */
@Component({
  selector: 'lib-dashboard-home',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ps-home" data-testid="dashboard-home">
      <header class="ps-home__head">
        <h1>Welcome back{{ user()?.name ? ', ' + user()!.name : '' }}.</h1>
        <p>Here's what to do next.</p>
      </header>
      <ul class="ps-home__list">
        @for (item of items(); track item.id) {
          <li
            class="ps-home__row"
            [class.is-done]="item.done"
            [attr.data-testid]="'home-' + item.id"
          >
            <span class="ps-home__mark" aria-hidden="true">{{ item.done ? '✓' : '○' }}</span>
            <a class="ps-home__link" [routerLink]="item.cta">{{ item.label }}</a>
          </li>
        }
      </ul>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 24px;
        max-width: 880px;
      }
      .ps-home__head h1 {
        margin: 0;
        font-size: clamp(1.5rem, 2vw + 0.5rem, 2rem);
        text-wrap: balance;
      }
      .ps-home__head p {
        opacity: 0.7;
      }
      .ps-home__list {
        list-style: none;
        margin: 24px 0 0;
        padding: 0;
        display: grid;
        gap: 8px;
      }
      .ps-home__row {
        display: grid;
        grid-template-columns: 24px 1fr;
        gap: 12px;
        padding: 14px 16px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 14px;
      }
      .ps-home__row.is-done {
        opacity: 0.55;
      }
      .ps-home__link {
        color: inherit;
        font-weight: 600;
        text-decoration: none;
      }
      .ps-home__link:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 3px;
      }
    `,
  ],
})
export class DashboardHomeComponent {
  private readonly me = inject(MeStore);
  private readonly caps = inject(CapabilityService);

  readonly user = computed(() => this.me.user());

  readonly items = computed<readonly ChecklistItem[]>(() => {
    const all: ChecklistItem[] = [
      {
        id: 'site',
        label: 'Create your first site',
        requires: 'sites:write',
        cta: ['/dashboard', 'sites'],
        done: false,
      },
      {
        id: 'domain',
        label: 'Connect a custom domain',
        requires: 'domains:read',
        cta: ['/dashboard', 'settings', 'domains'],
        done: false,
      },
      {
        id: 'billing',
        label: 'Set up billing',
        requires: 'billing:checkout',
        cta: ['/dashboard', 'billing'],
        done: false,
      },
      {
        id: 'team',
        label: 'Invite a teammate',
        requires: 'team:invite',
        cta: ['/dashboard', 'team'],
        done: false,
      },
      {
        id: 'jobs',
        label: 'Schedule your first job',
        requires: 'jobs:dispatch',
        cta: ['/dashboard', 'jobs'],
        done: false,
      },
    ];
    return all.filter((i) => !i.requires || this.caps.has(i.requires));
  });
}
