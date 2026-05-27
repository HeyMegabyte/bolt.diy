/**
 * SiteDetailComponent — `/dashboard/sites/:id`. PrimeNG `p-tabView`
 * with the canonical tab order Logs / Snapshots / SQL / Integrations
 * (per spec §10). Header has slug + status + delete (typed-confirm) +
 * hostnames CRUD inline.
 *
 * Logs viewer is lazy-loaded (heavy via virtual scroll); other tabs
 * mount eagerly because they're already on the home shell.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { switchMap, take } from 'rxjs';
import { SitesService } from '@org/data-access';
import {
  ColorBlindFilterComponent,
  type ColorBlindMode,
} from '@org/ui';
import { LogsViewerComponent } from '@org/feature-logs';
import { SnapshotsListComponent } from '@org/feature-snapshots';
import { SqlConsoleComponent } from '@org/feature-sql';
import { IntegrationsMarketplaceComponent } from '@org/feature-integrations';
import { HostnamesPanelComponent } from '../hostnames-panel/hostnames-panel.component';
import { DeleteSiteDialogComponent } from '../delete-site-dialog/delete-site-dialog.component';

@Component({
  selector: 'lib-site-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    ButtonModule,
    TagModule,
    ColorBlindFilterComponent,
    LogsViewerComponent,
    SnapshotsListComponent,
    SqlConsoleComponent,
    IntegrationsMarketplaceComponent,
    HostnamesPanelComponent,
    DeleteSiteDialogComponent,
  ],
  template: `
    <section class="site-detail" data-testid="site-detail" *ngIf="siteId() as id">
      <header class="hdr">
        <div>
          <a routerLink="/dashboard/sites" class="back">← Sites</a>
          <h1>{{ site()?.slug ?? id }}</h1>
          <p-tag
            *ngIf="site() as s"
            [value]="s.status"
            [severity]="statusSeverity(s.status)"
          ></p-tag>
        </div>
        <div class="actions">
          <button
            pButton
            severity="danger"
            icon="pi pi-trash"
            label="Delete"
            (click)="deleteOpen.set(true)"
            data-testid="site-delete"
          ></button>
        </div>
      </header>

      <lib-hostnames-panel [siteId]="id"></lib-hostnames-panel>

      <section class="preview" data-testid="site-preview-shell">
        <header class="preview__hdr">
          <h2>Live preview</h2>
          <lib-color-blind-filter
            [mode]="cbMode()"
            (modeChange)="cbMode.set($event)"
          ></lib-color-blind-filter>
        </header>
        <iframe
          *ngIf="previewUrl() as src"
          class="preview__frame"
          data-testid="site-preview-iframe"
          [src]="src"
          [style.filter]="cbFilter()"
          title="Live site preview"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
        ></iframe>
      </section>

      <nav class="tab-bar" role="tablist">
        <button
          *ngFor="let t of tabs"
          role="tab"
          [class.active]="active() === t.id"
          [attr.aria-selected]="active() === t.id"
          [attr.data-testid]="'site-tab-' + t.id"
          (click)="active.set(t.id)"
        >
          {{ t.label }}
        </button>
      </nav>
      <section class="tab-body">
        <lib-logs-viewer *ngIf="active() === 'logs'" [siteId]="id"></lib-logs-viewer>
        <lib-snapshots-list
          *ngIf="active() === 'snapshots'"
          [siteId]="id"
          [siteSlug]="site()?.slug ?? id"
        ></lib-snapshots-list>
        <lib-sql-console *ngIf="active() === 'sql'" [siteId]="id"></lib-sql-console>
        <lib-integrations-marketplace *ngIf="active() === 'integrations'"></lib-integrations-marketplace>
      </section>

      <lib-delete-site-dialog
        [open]="deleteOpen()"
        [siteId]="id"
        [expectedSlug]="site()?.slug ?? ''"
        (closed)="deleteOpen.set(false)"
        (deleted)="onDeleted()"
      ></lib-delete-site-dialog>
    </section>
  `,
  styles: [
    `
      .site-detail { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; }
      .hdr { display: flex; justify-content: space-between; align-items: center; }
      .hdr h1 { font-size: 1.5rem; margin: 0.25rem 0; }
      .back { color: var(--text-color-secondary, #999); text-decoration: none; font-size: 0.875rem; }
      .actions { display: flex; gap: 0.5rem; }
      .tab-bar { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--border, #2a2a3a); }
      .tab-bar button { background: transparent; border: 0; padding: 0.6rem 1rem; color: var(--text-color-secondary, #999); cursor: pointer; border-bottom: 2px solid transparent; }
      .tab-bar button.active { color: var(--text-color, #fff); border-bottom-color: var(--primary-color, #6366f1); }
      .tab-body { padding-top: 1rem; }
      .preview { display: flex; flex-direction: column; gap: 0.5rem; }
      .preview__hdr { display: flex; justify-content: space-between; align-items: center; }
      .preview__hdr h2 { font-size: 1rem; margin: 0; opacity: 0.85; }
      .preview__frame { width: 100%; height: 480px; border: 1px solid var(--border, #2a2a3a); border-radius: 14px; background: #000; }
    `,
  ],
})
export class SiteDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sites = inject(SitesService);

  protected readonly siteId = toSignal(
    this.route.paramMap.pipe(switchMap((p) => [p.get('id') ?? ''])),
    { initialValue: '' },
  );

  protected readonly site = toSignal(
    this.route.paramMap.pipe(
      switchMap((p) => this.sites.getSite$(p.get('id') ?? '')),
    ),
    { initialValue: null },
  );

  protected readonly deleteOpen = signal(false);
  protected readonly active = signal<'logs' | 'snapshots' | 'sql' | 'integrations'>('logs');

  /** Color-blind simulator mode for the preview iframe (#37). */
  protected readonly cbMode = signal<ColorBlindMode>('normal');
  protected readonly cbFilter = computed(() => {
    const m = this.cbMode();
    return m === 'normal' ? null : `url(#cbf-${m})`;
  });
  /** Iframe `src` — defaults to the site's primary hostname when known. */
  protected readonly previewUrl = computed<string | null>(() => {
    const s = this.site() as { slug?: string; primary_hostname?: string } | null;
    if (!s) return null;
    if (s.primary_hostname) return `https://${s.primary_hostname}`;
    if (s.slug) return `https://${s.slug}.projectsites.dev`;
    return null;
  });
  protected readonly tabs = [
    { id: 'logs' as const, label: 'Logs' },
    { id: 'snapshots' as const, label: 'Snapshots' },
    { id: 'sql' as const, label: 'SQL' },
    { id: 'integrations' as const, label: 'Integrations' },
  ];

  protected statusSeverity(status: string): 'success' | 'warning' | 'danger' | 'info' {
    if (status === 'published') return 'success';
    if (status === 'failed') return 'danger';
    if (status === 'building') return 'warning';
    return 'info';
  }

  protected onDeleted(): void {
    this.deleteOpen.set(false);
    this.router.navigate(['/dashboard/sites']);
  }
}
