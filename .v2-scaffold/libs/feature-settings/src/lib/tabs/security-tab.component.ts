/**
 * Security tab — passkeys (link to feature-auth), TOTP enroll,
 * active sessions, idle-timeout slider.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService, type SecuritySettings } from '@org/data-access';

@Component({
  selector: 'lib-security-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <h2 class="ps-h2">Security</h2>

    <section class="ps-block">
      <h3>Passkeys</h3>
      <p class="ps-hint">Manage WebAuthn credentials in
        <a href="/dashboard/security/passkeys" class="ps-link">Passkeys</a>.
      </p>
    </section>

    <section class="ps-block">
      <h3>Two-factor authentication</h3>
      <p class="ps-hint">Enroll TOTP via
        <a href="/dashboard/security/totp" class="ps-link">TOTP setup</a>.
      </p>
    </section>

    <section class="ps-block">
      <h3>Active sessions</h3>
      <p class="ps-hint">
        See and revoke sessions in
        <a href="/dashboard/security/sessions" class="ps-link">Sessions</a>.
      </p>
    </section>

    <section class="ps-block" *ngIf="security() as s">
      <h3>Idle timeout</h3>
      <label class="ps-slider-row">
        <input
          type="range"
          min="5"
          max="240"
          step="5"
          [ngModel]="s.idle_timeout_minutes"
          (ngModelChange)="updateIdle($event)"
          data-testid="security-idle-slider"
        />
        <span class="ps-slider-value">{{ s.idle_timeout_minutes }} min</span>
      </label>
    </section>
  `,
  styles: [
    `
      .ps-h2 { font-size: 1.25rem; font-weight: 700; margin: 0 0 16px; }
      .ps-block { margin-bottom: 20px; }
      .ps-block h3 { font-size: 1rem; font-weight: 600; margin: 0 0 6px; }
      .ps-hint { color: color-mix(in oklch, currentColor 60%, transparent); font-size: 0.9rem; margin: 0; }
      .ps-link { color: var(--ps-accent, #00e5ff); text-decoration: none; }
      .ps-link:hover { text-decoration: underline; }
      .ps-slider-row { display: flex; align-items: center; gap: 12px; max-width: 480px; }
      .ps-slider-row input { flex: 1; }
      .ps-slider-value { font-variant-numeric: tabular-nums; min-width: 60px; }
    `,
  ],
})
export class SecurityTabComponent {
  private readonly settings = inject(SettingsService);
  protected readonly security = signal<SecuritySettings | null>(null);

  constructor() {
    this.settings.getSecurity$().subscribe({
      next: (s) => this.security.set(s),
    });
  }

  protected updateIdle(minutes: number): void {
    const next: SecuritySettings = {
      idle_timeout_minutes: minutes,
      require_passkey_for_admin: this.security()?.require_passkey_for_admin ?? false,
      require_totp_for_super_admin: this.security()?.require_totp_for_super_admin ?? true,
    };
    this.security.set(next);
    this.settings.updateSecurity$({ idle_timeout_minutes: minutes }).subscribe();
  }
}
