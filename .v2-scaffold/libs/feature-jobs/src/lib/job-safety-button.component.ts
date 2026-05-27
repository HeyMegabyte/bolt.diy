/**
 * JobSafetyButtonComponent — high-contrast emergency button. Single-tap
 * fires a `safetyAlert$` POST; double-confirmation suppresses misfires.
 */
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { take } from 'rxjs';
import { JobsService } from './services/jobs.service';

@Component({
  selector: 'lib-job-safety-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ButtonModule],
  template: `
    <button
      pButton
      severity="danger"
      icon="pi pi-exclamation-triangle"
      [label]="armed() ? 'Tap again to alert' : 'Safety alert'"
      (click)="press()"
      data-testid="safety-button"
    ></button>
  `,
})
export class JobSafetyButtonComponent {
  @Input({ required: true }) jobId = '';
  private readonly api = inject(JobsService);

  protected readonly armed = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  protected press(): void {
    if (!this.armed()) {
      this.armed.set(true);
      this.timer = setTimeout(() => {
        this.armed.set(false);
        this.timer = null;
      }, 3000);
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.armed.set(false);
    this.api
      .safetyAlert$(this.jobId, { source: 'web-dashboard', ts: Date.now() })
      .pipe(take(1))
      .subscribe();
  }
}
