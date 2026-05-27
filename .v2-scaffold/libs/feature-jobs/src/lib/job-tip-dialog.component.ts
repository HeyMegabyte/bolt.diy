/**
 * JobTipDialogComponent — preset tip amounts + custom input.
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
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { take } from 'rxjs';
import { JobsService } from './services/jobs.service';

const PRESETS_CENTS = [500, 1000, 1500, 2000, 3000] as const;

@Component({
  selector: 'lib-job-tip-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule, InputNumberModule, CurrencyPipe],
  template: `
    <p-dialog
      [visible]="open"
      (visibleChange)="onVisible($event)"
      header="Add a tip"
      [modal]="true"
      [closable]="!busy()"
      [style]="{ width: '380px' }"
      data-testid="tip-dialog"
    >
      <div class="presets">
        <button
          *ngFor="let p of presets"
          pButton
          severity="secondary"
          [label]="(p / 100) | currency"
          [outlined]="amountCents !== p"
          (click)="amountCents = p"
          [attr.data-testid]="'tip-preset-' + p"
        ></button>
      </div>
      <label class="custom">
        <span>Custom amount</span>
        <p-inputNumber
          [(ngModel)]="amountCents"
          mode="currency"
          currency="USD"
          [step]="100"
          data-testid="tip-amount"
        />
      </label>
      <ng-template pTemplate="footer">
        <button pButton severity="secondary" label="Cancel" (click)="close()" [disabled]="busy()"></button>
        <button
          pButton
          label="Send tip"
          [disabled]="amountCents <= 0 || busy()"
          (click)="submit()"
          data-testid="tip-submit"
        ></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .presets { display: flex; gap: 0.5rem; flex-wrap: wrap; }
      .custom { display: grid; gap: 0.35rem; margin-top: 0.75rem; }
    `,
  ],
})
export class JobTipDialogComponent {
  @Input() jobId = '';
  @Input() open = false;
  @Output() readonly closed = new EventEmitter<void>();

  private readonly api = inject(JobsService);
  protected readonly presets = PRESETS_CENTS;
  protected amountCents = 0;
  protected readonly busy = signal(false);

  protected onVisible(v: boolean): void {
    if (!v) this.close();
  }

  protected close(): void {
    if (this.busy()) return;
    this.amountCents = 0;
    this.closed.emit();
  }

  protected submit(): void {
    if (this.amountCents <= 0 || this.busy()) return;
    this.busy.set(true);
    this.api
      .tip$(this.jobId, this.amountCents)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.amountCents = 0;
          this.closed.emit();
        },
        error: () => this.busy.set(false),
      });
  }
}
