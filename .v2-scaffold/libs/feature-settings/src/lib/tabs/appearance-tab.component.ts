/**
 * Appearance tab — dark/light/system theme + accent color picker.
 * Saves to user prefs and applies via the `--ps-accent` CSS custom prop.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService, type AppearancePrefs } from '@org/data-access';

@Component({
  selector: 'lib-appearance-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <h2 class="ps-h2">Appearance</h2>
    <ng-container *ngIf="prefs() as p">
      <fieldset class="ps-fieldset">
        <legend>Theme</legend>
        <label *ngFor="let t of themes" class="ps-radio">
          <input
            type="radio"
            name="theme"
            [value]="t"
            [checked]="p.theme === t"
            (change)="patch({ theme: t })"
            [attr.data-testid]="'appearance-theme-' + t"
          />
          <span>{{ t }}</span>
        </label>
      </fieldset>

      <label class="ps-field">
        <span>Accent color</span>
        <input
          type="color"
          [value]="p.accent_color"
          (change)="patch({ accent_color: $any($event.target).value })"
          data-testid="appearance-accent"
        />
      </label>

      <label class="ps-toggle">
        <input
          type="checkbox"
          [checked]="p.reduce_motion"
          (change)="patch({ reduce_motion: $any($event.target).checked })"
        />
        <span>Reduce motion (overrides OS pref)</span>
      </label>

      <label class="ps-toggle">
        <input
          type="checkbox"
          [checked]="p.high_contrast"
          (change)="patch({ high_contrast: $any($event.target).checked })"
        />
        <span>High contrast mode</span>
      </label>
    </ng-container>
  `,
  styles: [
    `
      .ps-h2 { font-size: 1.25rem; font-weight: 700; margin: 0 0 16px; }
      .ps-fieldset { border: 0; padding: 0; margin: 0 0 20px; }
      .ps-fieldset legend { font-weight: 600; margin-bottom: 8px; }
      .ps-radio, .ps-toggle { display: flex; align-items: center; gap: 8px; padding: 6px 0; text-transform: capitalize; }
      .ps-field { display: flex; flex-direction: column; gap: 6px; max-width: 200px; margin-bottom: 20px; }
      input[type='color'] {
        width: 64px; height: 36px; border: 0; border-radius: 8px; cursor: pointer;
      }
    `,
  ],
})
export class AppearanceTabComponent {
  private readonly settings = inject(SettingsService);

  protected readonly prefs = signal<AppearancePrefs | null>(null);
  protected readonly themes: AppearancePrefs['theme'][] = ['dark', 'light', 'system'];

  constructor() {
    this.settings.getAppearance$().subscribe({ next: (p) => this.prefs.set(p) });
  }

  protected patch(partial: Partial<AppearancePrefs>): void {
    const current = this.prefs() ?? {
      theme: 'dark',
      accent_color: '#00E5FF',
      reduce_motion: false,
      high_contrast: false,
    };
    const next: AppearancePrefs = { ...current, ...partial };
    this.prefs.set(next);
    if (typeof document !== 'undefined' && partial.accent_color) {
      document.documentElement.style.setProperty('--ps-accent', partial.accent_color);
    }
    this.settings.setAppearance$(next).subscribe();
  }
}
