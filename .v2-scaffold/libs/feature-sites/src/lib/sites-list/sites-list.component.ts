/**
 * SitesListComponent — `/dashboard/sites`. ag-grid Community list +
 * "Create from search" button that mounts `SiteCreateDialogComponent`.
 *
 * RxJS-first per [[rxjs-first-angular]] — `sites.listSites$ | async`
 * end-to-end; no signal-driven HTTP.
 */
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef, GridOptions } from 'ag-grid-community';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SitesService } from '@org/data-access';
import type { Site } from '@org/domain';
import { SiteCreateDialogComponent } from '../site-create-dialog/site-create-dialog.component';

@Component({
  selector: 'lib-sites-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    AgGridAngular,
    ButtonModule,
    TagModule,
    DialogModule,
    RouterLink,
    SiteCreateDialogComponent,
  ],
  template: `
    <section class="sites-list" data-testid="sites-list">
      <header class="hdr">
        <h1>Sites</h1>
        <button
          pButton
          icon="pi pi-plus"
          label="New site"
          (click)="openCreate()"
          data-testid="sites-create"
        ></button>
      </header>

      <ag-grid-angular
        class="ag-theme-quartz-dark grid"
        [rowData]="(sites.listSites$ | async) ?? []"
        [columnDefs]="columnDefs"
        [gridOptions]="gridOptions"
        data-testid="sites-grid"
      ></ag-grid-angular>

      <lib-site-create-dialog
        [open]="createOpen()"
        (closed)="createOpen.set(false)"
      ></lib-site-create-dialog>
    </section>
  `,
  styles: [
    `
      .sites-list { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; }
      .hdr { display: flex; justify-content: space-between; align-items: center; }
      .hdr h1 { font-size: 1.5rem; margin: 0; }
      .grid { width: 100%; height: calc(100vh - 12rem); min-height: 480px; }
    `,
  ],
})
export class SitesListComponent {
  protected readonly sites = inject(SitesService);
  protected readonly createOpen = signal(false);

  protected readonly columnDefs: ColDef<Site>[] = [
    {
      field: 'slug',
      headerName: 'Slug',
      cellRenderer: (p: { value: string; data: Site }) =>
        `<a data-testid="site-link-${p.data.id}" href="/dashboard/sites/${p.data.id}">${p.value}</a>`,
    },
    { field: 'primary_hostname', headerName: 'Primary Host' },
    { field: 'status', headerName: 'Status', maxWidth: 140 },
    {
      field: 'created_at',
      headerName: 'Created',
      valueFormatter: (p) => new Date(p.value as string).toLocaleDateString(),
    },
    {
      field: 'updated_at',
      headerName: 'Updated',
      valueFormatter: (p) => new Date(p.value as string).toLocaleString(),
    },
  ];

  protected readonly gridOptions: GridOptions<Site> = {
    defaultColDef: { sortable: true, filter: true, resizable: true, flex: 1 },
    rowHeight: 44,
    animateRows: true,
    suppressCellFocus: true,
  };

  protected openCreate(): void {
    this.createOpen.set(true);
  }
}
