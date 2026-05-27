/**
 * CrewScheduleComponent — upcoming jobs list (ag-grid Community).
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef, GridOptions } from 'ag-grid-community';
import { CrewService, type ScheduleEntry } from '@org/data-access';

@Component({
  selector: 'lib-crew-schedule',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, AgGridAngular],
  template: `
    <ag-grid-angular
      class="ag-theme-quartz-dark grid"
      [rowData]="(schedule$ | async) ?? []"
      [columnDefs]="columnDefs"
      [gridOptions]="gridOptions"
      data-testid="crew-schedule-grid"
    ></ag-grid-angular>
  `,
  styles: [`.grid { width: 100%; height: 480px; }`],
})
export class CrewScheduleComponent {
  private readonly crew = inject(CrewService);
  protected readonly schedule$ = this.crew.schedule$();

  protected readonly columnDefs: ColDef<ScheduleEntry>[] = [
    {
      field: 'scheduled_for',
      headerName: 'When',
      valueFormatter: (p) => new Date(p.value as string).toLocaleString(),
      sort: 'asc',
    },
    { field: 'duration_min', headerName: 'Duration (min)', maxWidth: 140 },
    { field: 'customer_label', headerName: 'Customer' },
    {
      field: 'fare_cents',
      headerName: 'Fare',
      maxWidth: 140,
      valueFormatter: (p) => `$${((p.value as number) / 100).toFixed(2)}`,
    },
    { field: 'job_id', headerName: 'Job ID', maxWidth: 160 },
  ];

  protected readonly gridOptions: GridOptions<ScheduleEntry> = {
    defaultColDef: { sortable: true, filter: true, resizable: true, flex: 1 },
    rowHeight: 40,
    animateRows: true,
    suppressCellFocus: true,
  };
}
