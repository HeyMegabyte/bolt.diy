/**
 * Notifications tab — channel toggles per event type + operator shadow inbox.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  NotificationChannelSchema,
  NotificationEventSchema,
  SettingsService,
  type NotificationPrefs,
} from '@org/data-access';

@Component({
  selector: 'lib-notifications-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <h2 class="ps-h2">Notifications</h2>
    <ng-container *ngIf="prefs() as p">
      <table class="ps-prefs">
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th *ngFor="let c of channels" scope="col">{{ c }}</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let e of events">
            <th scope="row">{{ e }}</th>
            <td *ngFor="let c of channels">
              <input
                type="checkbox"
                [checked]="p.per_event[e]?.[c] ?? false"
                (change)="toggle(e, c, $any($event.target).checked)"
                [attr.data-testid]="'notif-' + e + '-' + c"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <label class="ps-shadow">
        <input
          type="checkbox"
          [(ngModel)]="shadowChecked"
          (ngModelChange)="updateShadow($event)"
          data-testid="notif-shadow"
        />
        <span>Also send super-admin shadow copy to <code>brian&#64;megabyte.space</code></span>
      </label>
    </ng-container>
  `,
  styles: [
    `
      .ps-h2 { font-size: 1.25rem; font-weight: 700; margin: 0 0 16px; }
      .ps-prefs { width: 100%; border-collapse: collapse; max-width: 720px; }
      .ps-prefs th, .ps-prefs td {
        padding: 8px 12px;
        text-align: left;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        font-size: 0.9rem;
      }
      .ps-prefs thead th { text-transform: capitalize; font-size: 0.75rem; letter-spacing: 0.05em; }
      .ps-prefs tbody td { text-align: center; }
      .ps-prefs tbody th { font-weight: 400; }
      .ps-shadow { display: flex; align-items: center; gap: 8px; margin-top: 20px; font-size: 0.9rem; }
      code { background: rgba(255,255,255,0.05); padding: 1px 6px; border-radius: 4px; }
    `,
  ],
})
export class NotificationsTabComponent {
  private readonly settings = inject(SettingsService);

  protected readonly prefs = signal<NotificationPrefs | null>(null);
  protected readonly events = NotificationEventSchema.options;
  protected readonly channels = NotificationChannelSchema.options;
  protected shadowChecked = false;

  constructor() {
    this.settings.getNotificationPrefs$().subscribe({
      next: (p) => {
        this.prefs.set(p);
        this.shadowChecked = p.shadow_to_operator;
      },
    });
  }

  protected toggle(event: string, channel: string, checked: boolean): void {
    const current = this.prefs();
    if (!current) return;
    const row = current.per_event[event as keyof typeof current.per_event] ?? {
      email: false,
      sms: false,
      in_app: false,
      web_push: false,
    };
    const next: NotificationPrefs = {
      ...current,
      per_event: {
        ...current.per_event,
        [event]: { ...row, [channel]: checked },
      },
    };
    this.prefs.set(next);
    this.settings.updateNotificationPrefs$({ per_event: next.per_event }).subscribe();
  }

  protected updateShadow(value: boolean): void {
    const current = this.prefs();
    if (!current) return;
    this.prefs.set({ ...current, shadow_to_operator: value });
    this.settings.updateNotificationPrefs$({ shadow_to_operator: value }).subscribe();
  }
}
