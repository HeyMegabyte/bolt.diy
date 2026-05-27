/**
 * DangerZoneTabComponent — workspace deletion confirm flow. Typed-slug
 * confirmation gates the delete button (same pattern as the
 * SiteDelete and SnapshotRollback dialogs).
 */
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { take } from 'rxjs';
import { SettingsService } from '@org/data-access';

@Component({
  selector: 'lib-danger-zone-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonModule],
  template: `
    <section class="danger" data-testid="settings-tab-danger">
      <header>
        <h2>Danger zone</h2>
        <p>Deleting your workspace is permanent. All sites, jobs, and team data are removed.</p>
      </header>
      <label class="field">
        <span>Type the workspace slug to confirm</span>
        <input
          type="text"
          [(ngModel)]="typed"
          [placeholder]="expectedSlug()"
          class="plain-input"
          data-testid="settings-danger-input"
        />
      </label>
      <button
        pButton
        severity="danger"
        label="Delete workspace permanently"
        [disabled]="!isMatch() || busy()"
        (click)="confirm()"
        data-testid="settings-danger-confirm"
      ></button>
    </section>
  `,
  styles: [
    `
      .danger { display: flex; flex-direction: column; gap: 1rem; padding: 1rem; border: 1px solid var(--red-500, #ef4444); border-radius: 0.5rem; }
      .danger h2 { margin: 0; color: var(--red-500, #ef4444); }
      .field { display: grid; gap: 0.25rem; }
      .plain-input { background: var(--surface-card, #15151f); border: 1px solid var(--border, #2a2a3a); color: var(--text-color, #fff); padding: 0.45rem 0.6rem; border-radius: 0.4rem; font: inherit; }
    `,
  ],
})
export class DangerZoneTabComponent {
  private readonly settings = inject(SettingsService);

  protected typed = '';
  protected readonly busy = signal(false);
  protected readonly expectedSlug = signal<string>('workspace-slug');

  protected isMatch(): boolean {
    return this.typed.trim() === this.expectedSlug();
  }

  protected confirm(): void {
    if (!this.isMatch() || this.busy()) return;
    this.busy.set(true);
    this.settings
      .deleteWorkspace$(this.typed.trim())
      .pipe(take(1))
      .subscribe({
        next: () => this.busy.set(false),
        error: () => this.busy.set(false),
      });
  }
}
