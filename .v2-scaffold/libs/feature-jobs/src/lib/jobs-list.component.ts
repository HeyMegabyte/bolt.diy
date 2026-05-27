/**
 * JobsListComponent — `/dashboard/jobs`. Role-aware ag-grid list of
 * dispatched jobs.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef, GridOptions } from 'ag-grid-community';
import { TagModule } from 'primeng/tag';
import type { Observable } from 'rxjs';
import { JobsService } from './services/jobs.service';
import { RoleService } from '@org/dashboard';
import type { Job } from '@org/domain';

@Component({
  selector: 'lib-jobs-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, AgGridAngular, TagModule],
  template: `
    <section class="jobs-list" data-testid="jobs-list">
      <header class="hdr"><h1>Jobs</h1></header>
      <ag-grid-angular
        class="ag-theme-quartz-dark grid"
        [rowData]="(jobs$ | async) ?? []"
        [columnDefs]="columnDefs"
        [gridOptions]="gridOptions"
        data-testid="jobs-grid"
      ></ag-grid-angular>
    </section>
  `,
  styles: [
    `
      .jobs-list { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; }
      .hdr h1 { font-size: 1.5rem; margin: 0; }
      .grid { width: 100%; height: calc(100vh - 12rem); min-height: 480px; }
    `,
  ],
})
export class JobsListComponent {
  private readonly api = inject(JobsService);
  private readonly role = inject(RoleService);

  protected readonly jobs$: Observable<readonly Job[]> = this.api.listJobs$({
    role: this.role.viewAs() as 'customer' | 'crew' | 'super_admin',
  });

  protected readonly columnDefs: ColDef<Job>[] = [
    {
      field: 'id',
      headerName: 'ID',
      maxWidth: 140,
      cellRenderer: (p: { value: string; data: Job }) =>
        `<a data-testid="job-link-${p.data.id}" href="/dashboard/jobs/${p.data.id}">${p.value.slice(0, 8)}…</a>`,
    },
    { field: 'status', headerName: 'Status', maxWidth: 140 },
    { field: 'crew_id', headerName: 'Crew' },
    { field: 'booking_id', headerName: 'Booking' },
    {
      field: 'started_at',
      headerName: 'Started',
      valueFormatter: (p) => (p.value ? new Date(p.value as string).toLocaleString() : '—'),
    },
    {
      field: 'completed_at',
      headerName: 'Completed',
      valueFormatter: (p) => (p.value ? new Date(p.value as string).toLocaleString() : '—'),
    },
  ];

  protected readonly gridOptions: GridOptions<Job> = {
    defaultColDef: { sortable: true, filter: true, resizable: true, flex: 1 },
    rowHeight: 44,
    animateRows: true,
    suppressCellFocus: true,
  };
}
