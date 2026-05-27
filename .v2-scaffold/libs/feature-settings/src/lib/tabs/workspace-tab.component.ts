/**
 * Workspace tab — name, slug, logo, plan (read-only; link to billing).
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsService } from '@org/data-access';

@Component({
  selector: 'lib-workspace-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <h2 class="ps-h2">Workspace</h2>
    <form [formGroup]="form" (ngSubmit)="save()" class="ps-form">
      <label class="ps-field">
        <span>Workspace name</span>
        <input formControlName="name" type="text" />
      </label>
      <label class="ps-field">
        <span>Slug</span>
        <input formControlName="slug" type="text" data-testid="workspace-slug" />
        <small class="ps-hint">Used for URLs and tenancy resolution.</small>
      </label>
      <p class="ps-plan">
        Plan: <strong>Pro</strong> ·
        <a href="/dashboard/billing" class="ps-link">Change in Billing →</a>
      </p>
      <button
        type="submit"
        class="ps-btn ps-btn--primary"
        [disabled]="form.invalid || saving()"
      >
        {{ saving() ? 'Saving…' : 'Save changes' }}
      </button>
    </form>
  `,
  styles: [
    `
      .ps-h2 { font-size: 1.25rem; font-weight: 700; margin: 0 0 16px; }
      .ps-form { display: flex; flex-direction: column; gap: 16px; max-width: 480px; }
      .ps-field { display: flex; flex-direction: column; gap: 6px; }
      .ps-field input {
        padding: 10px 12px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        color: inherit;
        font: inherit;
      }
      .ps-hint { color: color-mix(in oklch, currentColor 55%, transparent); font-size: 0.8rem; }
      .ps-plan { font-size: 0.9rem; }
      .ps-link { color: var(--ps-accent, #00e5ff); text-decoration: none; }
      .ps-link:hover { text-decoration: underline; }
      .ps-btn { border: 0; border-radius: 10px; padding: 10px 16px; font: inherit; font-weight: 600; cursor: pointer; align-self: flex-start; }
      .ps-btn--primary { background: var(--ps-accent, #00e5ff); color: #06121a; }
      .ps-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    `,
  ],
})
export class WorkspaceTabComponent {
  private readonly fb = inject(FormBuilder);
  private readonly settings = inject(SettingsService);

  protected readonly saving = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    slug: [
      '',
      [
        Validators.required,
        Validators.pattern(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
      ],
    ],
  });

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.settings.updateWorkspace$(this.form.getRawValue()).subscribe({
      next: () => this.saving.set(false),
      error: () => this.saving.set(false),
    });
  }
}
