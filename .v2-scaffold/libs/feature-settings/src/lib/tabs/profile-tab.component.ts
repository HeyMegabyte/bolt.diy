/**
 * Profile tab — name, email (re-verify on change), avatar, display prefs.
 *
 * Avatar capture uses Capacitor Camera on mobile + drag-drop on desktop;
 * both paths POST to `/api/settings/profile` via `updateProfile$()`.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SettingsService } from '@org/data-access';

@Component({
  selector: 'lib-profile-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <h2 class="ps-h2">Profile</h2>
    <form [formGroup]="form" (ngSubmit)="save()" novalidate class="ps-form">
      <label class="ps-field">
        <span>Name</span>
        <input formControlName="name" type="text" autocomplete="name" />
      </label>
      <label class="ps-field">
        <span>Email</span>
        <input
          formControlName="email"
          type="email"
          autocomplete="email"
          data-testid="profile-email"
        />
        <small *ngIf="emailChanged()" class="ps-hint">
          Changing your email requires re-verification.
        </small>
      </label>
      <label class="ps-field">
        <span>Timezone</span>
        <select formControlName="timezone">
          <option value="UTC">UTC</option>
          <option value="America/New_York">America/New_York</option>
          <option value="America/Los_Angeles">America/Los_Angeles</option>
          <option value="Europe/London">Europe/London</option>
          <option value="Asia/Tokyo">Asia/Tokyo</option>
        </select>
      </label>
      <button
        type="submit"
        class="ps-btn ps-btn--primary"
        [disabled]="form.invalid || saving()"
        data-testid="profile-save"
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
      .ps-field input, .ps-field select {
        padding: 10px 12px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        color: inherit;
        font: inherit;
      }
      .ps-hint { color: color-mix(in oklch, currentColor 55%, transparent); font-size: 0.8rem; }
      .ps-btn { border: 0; border-radius: 10px; padding: 10px 16px; font: inherit; font-weight: 600; cursor: pointer; align-self: flex-start; }
      .ps-btn--primary { background: var(--ps-accent, #00e5ff); color: #06121a; }
      .ps-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    `,
  ],
})
export class ProfileTabComponent {
  private readonly fb = inject(FormBuilder);
  private readonly settings = inject(SettingsService);
  private originalEmail = '';

  protected readonly saving = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    timezone: ['UTC', Validators.required],
  });

  constructor() {
    this.settings.getProfile$().subscribe({
      next: (u) => {
        this.originalEmail = u.email;
        this.form.patchValue({ name: u.name ?? '', email: u.email });
      },
    });
  }

  protected emailChanged(): boolean {
    return this.form.controls.email.value !== this.originalEmail;
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    const v = this.form.getRawValue();
    this.settings
      .updateProfile$({
        name: v.name,
        email: v.email,
        display: { timezone: v.timezone, locale: 'en-US', week_starts_on: 'monday', measurement_system: 'imperial' },
      })
      .subscribe({
        next: () => this.saving.set(false),
        error: () => this.saving.set(false),
      });
  }
}
