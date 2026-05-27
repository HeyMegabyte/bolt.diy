/**
 * SiteCreateDialogComponent — "Create from search" flow.
 *
 * User types a brief, POST kicks off the AI workflow, dialog mounts a
 * live progress bar polled via `SitesService.workflowStatus$()`, on
 * `published` we router-navigate to `/dashboard/sites/:id`.
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
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { filter, switchMap, take } from 'rxjs';
import { SitesService, type WorkflowProgress } from '@org/data-access';

@Component({
  selector: 'lib-site-create-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    InputTextModule,
    ButtonModule,
    ProgressBarModule,
  ],
  template: `
    <p-dialog
      [visible]="open"
      (visibleChange)="onVisibleChange($event)"
      header="Create site from search"
      [modal]="true"
      [closable]="!busy()"
      [style]="{ width: '480px' }"
      data-testid="site-create-dialog"
    >
      <div class="body">
        <label class="field">
          <span>What kind of site?</span>
          <input
            pInputText
            type="text"
            [(ngModel)]="brief"
            placeholder="e.g. Plumber in Newark NJ"
            [disabled]="busy()"
            data-testid="site-create-brief"
          />
        </label>
        <div *ngIf="progress() as p" class="progress">
          <p-progressBar [value]="pct(p)"></p-progressBar>
          <span class="step">{{ p.step }} ({{ p.step_index + 1 }} / {{ p.step_count }})</span>
          <p *ngIf="p.message" class="msg">{{ p.message }}</p>
          <p *ngIf="p.error" class="err">{{ p.error }}</p>
        </div>
      </div>
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
          label="Create"
          (click)="submit()"
          [disabled]="busy() || !brief.trim()"
          data-testid="site-create-submit"
        ></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .body { display: flex; flex-direction: column; gap: 1rem; padding: 0.5rem 0; }
      .field { display: grid; gap: 0.35rem; }
      .progress { display: flex; flex-direction: column; gap: 0.5rem; }
      .step { font-size: 0.875rem; color: var(--text-color-secondary, #999); }
      .msg { font-size: 0.875rem; }
      .err { color: var(--red-500, #ef4444); }
    `,
  ],
})
export class SiteCreateDialogComponent {
  @Input() open = false;
  @Output() readonly closed = new EventEmitter<void>();

  private readonly sites = inject(SitesService);
  private readonly router = inject(Router);

  protected brief = '';
  protected readonly busy = signal(false);
  protected readonly progress = signal<WorkflowProgress | null>(null);

  protected onVisibleChange(v: boolean): void {
    if (!v) this.close();
  }

  protected close(): void {
    if (this.busy()) return;
    this.brief = '';
    this.progress.set(null);
    this.closed.emit();
  }

  protected submit(): void {
    if (!this.brief.trim() || this.busy()) return;
    this.busy.set(true);
    this.sites
      .createSite$({ brief: this.brief.trim() })
      .pipe(
        switchMap(({ workflow_id }) => this.sites.workflowStatus$(workflow_id)),
      )
      .subscribe({
        next: (p) => {
          this.progress.set(p);
          if (p.status === 'published') {
            this.busy.set(false);
            this.router.navigate(['/dashboard/sites', p.site_id]);
            this.closed.emit();
          } else if (p.status === 'failed') {
            this.busy.set(false);
          }
        },
        error: () => this.busy.set(false),
      });
  }

  protected pct(p: WorkflowProgress): number {
    if (p.step_count <= 0) return 0;
    return Math.round(((p.step_index + 1) / p.step_count) * 100);
  }
}
