/**
 * `InviteDialogComponent` — batch invite UX.
 *
 * Adds N email/role rows (default 1 with an "Add another" button), validates
 * every email client-side, then dispatches one POST `/api/team/invite` per
 * row via `TeamService.invite$()` (the service uses `forkJoin` under the hood
 * so the dialog observes a single completion). Per spec:
 * `team-invite.spec.ts` — "calls POST /api/team/invite once per email".
 */
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  TeamService,
  WorkspaceRoleSchema,
  type WorkspaceRole,
} from '@org/data-access';

@Component({
  selector: 'lib-invite-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './invite-dialog.component.html',
  styleUrls: ['./invite-dialog.component.css'],
})
export class InviteDialogComponent {
  @Output() readonly closed = new EventEmitter<boolean>();

  private readonly fb = inject(FormBuilder);
  private readonly team = inject(TeamService);

  protected readonly roles: readonly WorkspaceRole[] = WorkspaceRoleSchema.options;
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    rows: this.fb.array([this.makeRow()]),
  });

  protected get rows(): FormArray {
    return this.form.get('rows') as FormArray;
  }

  protected addRow(): void {
    this.rows.push(this.makeRow());
  }

  protected removeRow(index: number): void {
    if (this.rows.length > 1) this.rows.removeAt(index);
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const batch = (this.rows.value as Array<{ email: string; role: WorkspaceRole }>).map(
      (r) => ({ email: r.email.trim().toLowerCase(), role: r.role }),
    );
    this.submitting.set(true);
    this.team.invite$(batch).subscribe({
      next: () => {
        this.submitting.set(false);
        this.closed.emit(true);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(err instanceof Error ? err.message : 'Invite failed');
      },
    });
  }

  protected cancel(): void {
    this.closed.emit(false);
  }

  private makeRow() {
    return this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
      role: ['member' as WorkspaceRole, Validators.required],
    });
  }
}
