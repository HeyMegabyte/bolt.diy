/**
 * `RoleEditDrawerComponent` — per-resource permission overrides for a single
 * member. The drawer is the surface where workspace admins fine-tune which
 * resources a member can read/write/publish beyond the role default. Most
 * customers use the role presets and never open this drawer; it exists
 * so power-users aren't locked into the four-role grid.
 */
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  TeamService,
  WorkspaceRoleSchema,
  type TeamMember,
  type WorkspaceRole,
} from '@org/data-access';

interface ResourceToggle {
  readonly key: string;
  readonly label: string;
  enabled: boolean;
}

@Component({
  selector: 'lib-role-edit-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './role-edit-drawer.component.html',
  styleUrls: ['./role-edit-drawer.component.css'],
})
export class RoleEditDrawerComponent {
  @Input({ required: true }) member!: TeamMember;
  @Output() readonly closed = new EventEmitter<boolean>();

  private readonly team = inject(TeamService);

  protected readonly roles = WorkspaceRoleSchema.options;
  protected readonly submitting = signal(false);

  /** Snapshot of resource overrides; UI is read-write but a save is required. */
  protected resourceToggles: ResourceToggle[] = [
    { key: 'sites:publish', label: 'Publish sites', enabled: true },
    { key: 'billing:portal', label: 'Open billing portal', enabled: true },
    { key: 'integrations:manage', label: 'Manage integrations', enabled: false },
    { key: 'snapshots:rollback', label: 'Rollback snapshots', enabled: false },
    { key: 'team:invite', label: 'Invite teammates', enabled: false },
    { key: 'logs:tail', label: 'Tail live logs', enabled: true },
  ];

  protected selectedRole: WorkspaceRole = 'member';

  ngOnInit(): void {
    this.selectedRole = this.member.workspace_role;
  }

  protected save(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.team
      .updateMemberRole$(this.member.member_id, this.selectedRole)
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.closed.emit(true);
        },
        error: () => {
          this.submitting.set(false);
        },
      });
  }

  protected cancel(): void {
    this.closed.emit(false);
  }
}
