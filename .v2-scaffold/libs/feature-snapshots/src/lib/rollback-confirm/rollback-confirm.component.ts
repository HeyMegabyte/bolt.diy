/**
 * `RollbackConfirmComponent` — typed-slug confirmation modal.
 *
 * User must type the site slug verbatim before the rollback button
 * enables. On confirm we POST to `/api/sites/:siteId/snapshots/:id/rollback`
 * (via `SnapshotsService`) and write an audit-trail entry server-side
 * (the route handler logs `snapshot.rollback`).
 *
 * Cancel-able via Escape, click-outside, or the explicit Cancel button.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { SnapshotsService } from '@org/data-access';
import type { Snapshot } from '@org/domain';

@Component({
  selector: 'lib-rollback-confirm',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './rollback-confirm.component.html',
  styleUrl: './rollback-confirm.component.css',
})
export class RollbackConfirmComponent {
  @Input({ required: true }) snapshot!: Snapshot;
  @Input({ required: true }) siteSlug = '';

  @Output() readonly close = new EventEmitter<void>();
  @Output() readonly confirmed = new EventEmitter<string>();

  private readonly snapshots = inject(SnapshotsService);

  readonly typedCtrl = new FormControl<string>('', { nonNullable: true });
  readonly typed = toSignal(this.typedCtrl.valueChanges, { initialValue: '' });

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly canConfirm = computed(
    () => !this.busy() && this.typed().trim() === this.siteSlug,
  );

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.busy()) this.close.emit();
  }

  onBackdrop(event: MouseEvent): void {
    if (
      event.target instanceof HTMLElement &&
      event.target.classList.contains('backdrop') &&
      !this.busy()
    ) {
      this.close.emit();
    }
  }

  doRollback(): void {
    if (!this.canConfirm()) return;
    this.busy.set(true);
    this.error.set(null);
    this.snapshots
      .rollback$(this.snapshot.site_id, this.snapshot.id, this.siteSlug)
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.confirmed.emit(this.snapshot.id);
          this.close.emit();
        },
        error: (err: Error) => {
          this.busy.set(false);
          this.error.set(err.message || 'Rollback failed. Try again.');
        },
      });
  }
}
