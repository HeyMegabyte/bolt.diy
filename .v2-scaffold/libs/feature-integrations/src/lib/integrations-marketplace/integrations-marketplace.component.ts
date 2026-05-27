/**
 * IntegrationsMarketplaceComponent — `/dashboard/integrations`.
 *
 * @remarks
 * Responsive card grid with category-pill filter + debounced search.
 * Clicking a card opens `IntegrationDrawerComponent` (PrimeNG `p-sidebar`)
 * with the OAuth + paste-key flows.
 *
 * RxJS-first per `[[rxjs-first-angular]]`. The connection list is
 * subscribed via `toSignal`; filtering is fully derived via `computed`.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { DrawerModule } from 'primeng/drawer';
import { Router, RouterModule } from '@angular/router';
import { debounceTime, distinctUntilChanged, startWith } from 'rxjs';
import { IntegrationsService } from '@org/data-access';
import type { IntegrationConfig, IntegrationProvider } from '@org/domain';
import {
  INTEGRATIONS,
  INTEGRATION_CATEGORIES,
  type IntegrationCategory,
  type IntegrationDef,
} from '../registry';
import { IntegrationDrawerComponent } from '../integration-drawer/integration-drawer.component';

@Component({
  selector: 'lib-integrations-marketplace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    ButtonModule,
    CardModule,
    TagModule,
    InputTextModule,
    DrawerModule,
    IntegrationDrawerComponent,
  ],
  templateUrl: './integrations-marketplace.component.html',
  styleUrl: './integrations-marketplace.component.css',
})
export class IntegrationsMarketplaceComponent {
  private readonly integrations = inject(IntegrationsService);
  private readonly router = inject(Router);

  readonly categories = INTEGRATION_CATEGORIES;
  readonly integrationDefs = INTEGRATIONS;

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly searchValue = toSignal(
    this.searchControl.valueChanges.pipe(
      startWith(''),
      debounceTime(150),
      distinctUntilChanged(),
    ),
    { initialValue: '' },
  );

  readonly activeCategory = signal<IntegrationCategory | 'all'>('all');
  readonly connections = toSignal(this.integrations.listConnections$, {
    initialValue: [] as readonly IntegrationConfig[],
  });

  readonly drawerOpen = signal(false);
  readonly drawerProvider = signal<IntegrationDef | null>(null);

  readonly visible = computed(() => {
    const term = this.searchValue().trim().toLowerCase();
    const cat = this.activeCategory();
    return this.integrationDefs.filter((def) => {
      if (def.disabled && cat !== 'all') return false;
      if (cat !== 'all' && def.category !== cat) return false;
      if (!term) return true;
      return (
        def.name.toLowerCase().includes(term) ||
        def.description.toLowerCase().includes(term)
      );
    });
  });

  /** Connection-by-provider map for fast status lookup in templates. */
  readonly byProvider = computed(() => {
    const map = new Map<string, IntegrationConfig>();
    for (const c of this.connections()) map.set(c.provider, c);
    return map;
  });

  setCategory(cat: IntegrationCategory | 'all'): void {
    this.activeCategory.set(cat);
  }

  openDrawer(def: IntegrationDef): void {
    if (def.disabled) return;
    this.drawerProvider.set(def);
    this.drawerOpen.set(true);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  goToApiKeys(): void {
    this.router.navigate(['/dashboard/integrations/api-keys']);
  }

  goToWebhooks(): void {
    this.router.navigate(['/dashboard/integrations/webhooks']);
  }

  goToOauthApps(): void {
    this.router.navigate(['/dashboard/integrations/oauth-apps']);
  }

  statusFor(provider: string): IntegrationConfig['status'] | 'disconnected' {
    return this.byProvider().get(provider)?.status ?? 'disconnected';
  }

  statusSeverity(provider: string): 'success' | 'warning' | 'danger' | 'info' {
    const s = this.statusFor(provider);
    if (s === 'connected') return 'success';
    if (s === 'expired') return 'warning';
    if (s === 'error') return 'danger';
    return 'info';
  }

  ctaLabel(provider: string): string {
    return this.statusFor(provider) === 'disconnected' ? 'Connect' : 'Configure';
  }

  trackById = (_: number, d: IntegrationDef): string => d.id as string;
}
