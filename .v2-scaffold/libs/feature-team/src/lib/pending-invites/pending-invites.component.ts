/**
 * `PendingInvitesComponent` — table of unaccepted invites with resend/revoke
 * actions. Inputs/outputs only — parent owns the refresh trigger.
 */
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TeamService, type PendingInvite } from '@org/data-access';

@Component({
  selector: 'lib-pending-invites',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './pending-invites.component.html',
  styleUrls: ['./pending-invites.component.css'],
})
export class PendingInvitesComponent {
  @Input({ required: true }) invites: readonly PendingInvite[] = [];
  @Output() readonly changed = new EventEmitter<void>();

  private readonly team = inject(TeamService);

  protected resend(invite: PendingInvite): void {
    this.team.resendInvite$(invite.invite_id).subscribe({
      next: () => this.changed.emit(),
    });
  }

  protected revoke(invite: PendingInvite): void {
    this.team.revokeInvite$(invite.invite_id).subscribe({
      next: () => this.changed.emit(),
    });
  }

  protected trackInvite = (_: number, i: PendingInvite): string => i.invite_id;
}
