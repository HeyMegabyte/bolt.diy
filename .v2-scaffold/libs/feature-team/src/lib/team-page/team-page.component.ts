/**
 * `TeamPageComponent` — `/dashboard/team` admin surface.
 *
 * ag-grid table of workspace members with inline workspace-role editing
 * (PrimeNG `p-dropdown` cell editor), platform-role overlay column
 * (read-only, visible only to platform `super_admin`), and per-row
 * actions (resend invite / revoke / promote).
 *
 * RxJS-first per [[rxjs-first-angular]]: every async dep is an Observable
 * piped through `async`. No `effect()` for HTTP.
 *
 * @see ../../../__tests__/team-invite.spec.ts for the spec contract.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef, GridOptions, ICellRendererParams } from 'ag-grid-community';
import { BehaviorSubject, combineLatest, map, switchMap } from 'rxjs';
import {
  TeamService,
  type TeamMember,
  type WorkspaceRole,
  type PendingInvite,
} from '@org/data-access';
import { InviteDialogComponent } from '../invite-dialog/invite-dialog.component';
import { PendingInvitesComponent } from '../pending-invites/pending-invites.component';
import { ActiveSessionsViewComponent } from '../active-sessions-view/active-sessions-view.component';
import { RoleEditDrawerComponent } from '../role-edit-drawer/role-edit-drawer.component';

@Component({
  selector: 'lib-team-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    AgGridAngular,
    InviteDialogComponent,
    PendingInvitesComponent,
    ActiveSessionsViewComponent,
    RoleEditDrawerComponent,
  ],
  templateUrl: './team-page.component.html',
  styleUrls: ['./team-page.component.css'],
})
export class TeamPageComponent {
  private readonly team = inject(TeamService);

  /** Manual refresh trigger — replays member list after mutations. */
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  protected readonly members$ = this.refresh$.pipe(
    switchMap(() => this.team.listMembers$()),
  );
  protected readonly pending$ = this.refresh$.pipe(
    switchMap(() => this.team.pendingInvites$()),
  );

  protected readonly viewModel$ = combineLatest([
    this.members$,
    this.pending$,
  ]).pipe(
    map(([members, pending]) => ({
      members,
      pending,
      memberCount: members.length,
      pendingCount: pending.length,
    })),
  );

  protected inviteOpen = false;
  protected drawerMember: TeamMember | null = null;

  protected readonly columnDefs: ColDef<TeamMember>[] = [
    {
      headerName: '',
      field: 'avatar_url',
      width: 56,
      sortable: false,
      filter: false,
      cellRenderer: (p: ICellRendererParams<TeamMember>) =>
        p.value
          ? `<img src="${p.value}" alt="" class="ps-avatar" />`
          : `<span class="ps-avatar ps-avatar--initials" aria-hidden="true">${
              (p.data?.name ?? p.data?.email ?? '?').charAt(0).toUpperCase()
            }</span>`,
    },
    { headerName: 'Name', field: 'name', flex: 1 },
    { headerName: 'Email', field: 'email', flex: 1.5 },
    {
      headerName: 'Workspace role',
      field: 'workspace_role',
      width: 160,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: ['owner', 'admin', 'member', 'viewer'] satisfies WorkspaceRole[],
      },
    },
    {
      headerName: 'Platform',
      field: 'platform_role',
      width: 120,
      editable: false,
      cellClass: 'ps-platform-role',
    },
    {
      headerName: 'Joined',
      field: 'joined_at',
      width: 140,
      valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleDateString() : '—'),
    },
    {
      headerName: 'Last seen',
      field: 'last_seen_at',
      width: 140,
      valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString() : '—'),
    },
    {
      headerName: 'Actions',
      colId: 'actions',
      width: 220,
      sortable: false,
      filter: false,
      cellRenderer: () =>
        `<button type="button" data-act="drawer" class="ps-btn ps-btn--ghost">Permissions</button>
         <button type="button" data-act="remove" class="ps-btn ps-btn--danger">Remove</button>`,
    },
  ];

  protected readonly gridOptions: GridOptions<TeamMember> = {
    rowHeight: 56,
    suppressCellFocus: false,
    stopEditingWhenCellsLoseFocus: true,
    onCellValueChanged: (e) => {
      if (e.colDef.field === 'workspace_role' && e.data) {
        this.team
          .updateMemberRole$(e.data.member_id, e.newValue as WorkspaceRole)
          .subscribe({
            next: () => this.refresh$.next(),
          });
      }
    },
    onCellClicked: (e) => {
      if (e.colDef.colId !== 'actions') return;
      const target = e.event?.target as HTMLElement | undefined;
      const act = target?.getAttribute('data-act');
      if (!e.data) return;
      if (act === 'drawer') {
        this.drawerMember = e.data;
      } else if (act === 'remove') {
        this.team.removeMember$(e.data.member_id).subscribe({
          next: () => this.refresh$.next(),
        });
      }
    },
  };

  protected openInvite(): void {
    this.inviteOpen = true;
  }

  protected onInviteClosed(refresh: boolean): void {
    this.inviteOpen = false;
    if (refresh) this.refresh$.next();
  }

  protected onDrawerClosed(refresh: boolean): void {
    this.drawerMember = null;
    if (refresh) this.refresh$.next();
  }

  protected onPendingChanged(): void {
    this.refresh$.next();
  }

  protected trackMember = (_: number, m: TeamMember): string => m.member_id;
}
