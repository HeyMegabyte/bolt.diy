/**
 * DeleteSiteDialogComponent — typed-confirm before deletion. User must
 * type the site's slug to enable the Delete button. Same pattern as the
 * Snapshots `RollbackConfirmComponent`.
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
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { take } from 'rxjs';
import { SitesService } from '@org/data-access';

@Component({
  selector: 'lib-delete-site-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule, InputTextModule],
  template: `
    <p-dialog
      [visible]="open"
      (visibleChange)="onVisibleChange($event)"
      header="Delete site?"
      [modal]="true"
      [closable]="!busy()"
      [style]="{ width: '460px' }"
      data-testid="site-delete-dialog"
    >
      <p>
        Type <strong>{{ expectedSlug }}</strong> to confirm deletion. This
        cannot be undone.
      </p>
      <input
        pInputText
        type="text"
        [(ngModel)]="typed"
        [placeholder]="expectedSlug"
        data-testid="site-delete-confirm-input"
      />
      <ng-template pTemplate="footer">
        <button
          pButton
          severity="secondary"
          label="Cancel"
          (click)="close()"
          [disabled]="busy()"
        ></button>
        <button
          pButton
          severity="danger"
          label="Delete"
          [disabled]="!isMatch() || busy()"
          (click)="confirm()"
          data-testid="site-delete-confirm"
        ></button>
      </ng-template>
    </p-dialog>
  `,
})
export class DeleteSiteDialogComponent {
  @Input() open = false;
  @Input() siteId = '';
  @Input() expectedSlug = '';
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly deleted = new EventEmitter<void>();

  private readonly sites = inject(SitesService);

  protected typed = '';
  protected readonly busy = signal(false);

  protected isMatch(): boolean {
    return this.typed.trim() === this.expectedSlug;
  }

  protected onVisibleChange(v: boolean): void {
    if (!v) this.close();
  }

  protected close(): void {
    if (this.busy()) return;
    this.typed = '';
    this.closed.emit();
  }

  protected confirm(): void {
    if (!this.isMatch() || this.busy()) return;
    this.busy.set(true);
    this.sites
      .deleteSite$(this.siteId)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.typed = '';
          this.deleted.emit();
        },
        error: () => this.busy.set(false),
      });
  }
}
