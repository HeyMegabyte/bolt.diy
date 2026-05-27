/**
 * BookingsListComponent — `/dashboard/bookings`.
 *
 * Role-aware ag-grid (Community) list of bookings: customer sees their
 * own, crew sees assigned, super_admin sees all. RxJS-first per
 * [[rxjs-first-angular]] — async pipe end-to-end; signals only at the
 * template boundary.
 */
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef, GridOptions } from 'ag-grid-community';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { combineLatest, map } from 'rxjs';
import {
  BookingsService,
  type BookingsFilter,
} from '@org/data-access';
import { RoleService, UndoManagerService } from '@org/dashboard';
import type { Booking } from '@org/domain';

@Component({
  selector: 'lib-bookings-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    AgGridAngular,
    ButtonModule,
    TagModule,
    RouterLink,
    CurrencyPipe,
    DatePipe,
  ],
  template: `
    <section class="bookings-list" data-testid="bookings-list">
      <header class="hdr">
        <h1>Bookings</h1>
        <span class="count" *ngIf="rows$ | async as rows">{{ rows.length }} total</span>
      </header>
      <ag-grid-angular
        class="ag-theme-quartz-dark grid"
        [rowData]="(rows$ | async) ?? []"
        [columnDefs]="columnDefs"
        [gridOptions]="gridOptions"
        data-testid="bookings-grid"
      ></ag-grid-angular>
    </section>
  `,
  styles: [
    `
      .bookings-list { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; }
      .hdr { display: flex; justify-content: space-between; align-items: baseline; }
      .hdr h1 { font-size: 1.5rem; font-weight: 600; margin: 0; }
      .count { color: var(--text-color-secondary, #999); font-size: 0.875rem; }
      .grid { width: 100%; height: calc(100vh - 12rem); min-height: 480px; }
    `,
  ],
})
export class BookingsListComponent {
  private readonly bookings = inject(BookingsService);
  private readonly role = inject(RoleService);
  private readonly undoManager = inject(UndoManagerService);

  /**
   * Example undo-wired CRUD entry point. Any caller (toolbar button,
   * row-action, command palette) can hand a `Booking` to `cancel()`
   * and the user gets a 5-second window to undo via toast or Cmd+Z.
   *
   * Pairs with `BookingsService.cancelBooking$` / `.restoreBooking$`
   * (added once the data-access layer lands). The TODO markers stay
   * here until those land — service methods are the natural seam.
   */
  cancel(booking: Pick<Booking, 'id'>): void {
    void this.undoManager.register({
      label: `Booking ${booking.id.slice(0, 8)}… cancelled`,
      do: async () => {
        // TODO: wire to BookingsService.cancelBooking$(id) once it lands.
      },
      undo: async () => {
        // TODO: wire to BookingsService.restoreBooking$(id) once it lands.
      },
    });
  }

  protected readonly columnDefs: ColDef<Booking>[] = [
    {
      field: 'id',
      headerName: 'ID',
      maxWidth: 120,
      cellRenderer: (p: { value: string; data: Booking }) =>
        `<a data-testid="booking-link-${p.data.id}" href="/dashboard/bookings/${p.data.id}">${p.value.slice(0, 8)}…</a>`,
    },
    { field: 'status', headerName: 'Status', maxWidth: 140 },
    { field: 'scheduled_for', headerName: 'Scheduled', valueFormatter: (p) => new Date(p.value as string).toLocaleString() },
    { field: 'duration_min', headerName: 'Duration (min)', maxWidth: 140 },
    {
      field: 'fare_cents',
      headerName: 'Fare',
      maxWidth: 140,
      valueFormatter: (p) => `$${((p.value as number) / 100).toFixed(2)}`,
    },
    { field: 'crew_id', headerName: 'Crew', maxWidth: 160 },
    { field: 'created_at', headerName: 'Created', valueFormatter: (p) => new Date(p.value as string).toLocaleDateString() },
  ];

  protected readonly gridOptions: GridOptions<Booking> = {
    defaultColDef: {
      sortable: true,
      filter: true,
      resizable: true,
      flex: 1,
    },
    rowHeight: 44,
    headerHeight: 40,
    suppressCellFocus: true,
    animateRows: true,
  };

  protected readonly rows$ = combineLatest([
    this.bookings.listBookings$(this.bookingsFilter()),
  ]).pipe(map(([rows]) => rows));

  private bookingsFilter(): BookingsFilter {
    const v = this.role.viewAs();
    return { role: v as BookingsFilter['role'] };
  }
}
