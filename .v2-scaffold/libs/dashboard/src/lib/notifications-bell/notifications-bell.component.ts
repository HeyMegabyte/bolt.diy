import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { DrawerModule } from 'primeng/drawer';
import { Router } from '@angular/router';
import { NotificationsStore } from '../services/notifications.store';
import type { NotificationFrame } from '../types/domain';

/**
 * Bell button in the toolbar. Shows unread count badge; opens a
 * PrimeNG `p-sidebar` slide-over grouped by day. Each row supports
 * mark-read / snooze / jump-to-source.
 */
@Component({
  selector: 'lib-notifications-bell',
  standalone: true,
  imports: [ButtonModule, BadgeModule, DrawerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      pButton
      type="button"
      class="p-button-text"
      aria-label="Notifications"
      data-testid="notifications-bell"
      (click)="open.set(true)"
    >
      <span aria-hidden="true">🔔</span>
      @if (unread() > 0) {
        <p-badge
          [value]="unread().toString()"
          severity="danger"
          data-testid="notifications-unread-count"
        />
      }
    </button>

    <p-drawer
      [(visible)]="openModel"
      position="right"
      [style]="{ width: 'min(420px, 96vw)' }"
      ariaCloseLabel="Close notifications"
      header="Notifications"
    >
      @for (group of groups(); track group.dayIso) {
        <section class="ps-bell__day">
          <h3 class="ps-bell__day-h">{{ group.dayIso }}</h3>
          <ul class="ps-bell__list">
            @for (item of group.items; track item.id) {
              <li
                class="ps-bell__row"
                [class.is-unread]="!item.read"
                [attr.data-testid]="'notification-' + item.id"
              >
                <div class="ps-bell__main">
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.body }}</p>
                </div>
                <div class="ps-bell__actions">
                  @if (!item.read) {
                    <button
                      pButton
                      type="button"
                      class="p-button-text p-button-sm"
                      (click)="markRead(item.id)"
                    >
                      Mark read
                    </button>
                  }
                  @if (item.source_url) {
                    <button
                      pButton
                      type="button"
                      class="p-button-text p-button-sm"
                      (click)="jump(item)"
                    >
                      Open
                    </button>
                  }
                </div>
              </li>
            }
          </ul>
        </section>
      } @empty {
        <p class="ps-bell__empty">All caught up.</p>
      }
    </p-drawer>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        position: relative;
      }
      .ps-bell__title {
        margin: 0;
        font-size: 1rem;
      }
      .ps-bell__day {
        margin-block: 12px;
      }
      .ps-bell__day-h {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        opacity: 0.6;
        margin: 0 0 6px;
      }
      .ps-bell__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 8px;
      }
      .ps-bell__row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        padding: 10px 12px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
      }
      .ps-bell__row.is-unread {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent);
      }
      .ps-bell__main p {
        margin: 4px 0 0;
        font-size: 0.85rem;
        opacity: 0.85;
      }
      .ps-bell__actions {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .ps-bell__empty {
        padding: 24px;
        text-align: center;
        opacity: 0.6;
      }
    `,
  ],
})
export class NotificationsBellComponent {
  private readonly store = inject(NotificationsStore);
  private readonly router = inject(Router);

  readonly open = signal(false);
  /** Two-way binding adapter for PrimeNG `[(visible)]`. */
  get openModel(): boolean {
    return this.open();
  }
  set openModel(v: boolean) {
    this.open.set(v);
  }

  readonly unread = computed(() => this.store.unreadCount());
  readonly groups = computed(() => this.store.groupedByDay());

  markRead(id: string): void {
    this.store.markRead(id);
  }

  jump(item: NotificationFrame): void {
    if (!item.source_url) return;
    this.store.markRead(item.id);
    this.open.set(false);
    if (item.source_url.startsWith('/')) {
      void this.router.navigateByUrl(item.source_url);
    } else if (typeof globalThis !== 'undefined') {
      globalThis.open(item.source_url, '_blank', 'noopener');
    }
  }
}
