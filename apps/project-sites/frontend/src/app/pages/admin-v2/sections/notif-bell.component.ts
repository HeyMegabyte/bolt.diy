/**
 * @module pages/admin-v2/sections/notif-bell
 *
 * Novu notification bell for the v2 topbar — the first live wiring of the
 * permanent Novu doctrine ([[notifications-email-webhooks-supervisor]]). Uses
 * the headless `@novu/js` Inbox SDK (no UI/CSS) + a Spartan-styled bell +
 * dropdown feed. Connects to Novu Cloud with the PUBLIC application identifier
 * (client-safe by design) + the signed-in user as the subscriber. Unread badge,
 * feed list (subject/body + dayjs relative time), per-item mark-read, real-time
 * refresh on `notifications.notification_received`. Server-side workflow
 * triggers (build/deploy/domain/AI/billing) are the next wave; the secret key
 * lives only on the worker.
 *
 * @example `<app-v2-notif-bell />` in the shell topbar.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AuthService } from '../../../services/auth.service';
import { HlmButtonDirective, HlmBadgeDirective } from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';

/** Public Novu application identifier — client-safe by design (the secret key never leaves the worker). */
const NOVU_APP_ID = 'Z_iGtmk4pMwF';

interface FeedItem {
  id: string;
  subject: string;
  body: string;
  createdAt: string;
  isRead: boolean;
}

@Component({
  selector: 'app-v2-notif-bell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButtonDirective, HlmBadgeDirective, RelativeDatePipe],
  template: `
    <div class="relative">
      <button hlmBtn variant="ghost" size="icon" (click)="toggle()" data-testid="v2-notif-bell"
              [attr.aria-label]="'Notifications' + (unread() > 0 ? ', ' + unread() + ' unread' : '')">
        <span class="text-base leading-none">🔔</span>
        @if (unread() > 0) {
          <span hlmBadge variant="info"
                class="absolute -top-1 -right-1 min-w-4 h-4 px-1 justify-center text-[0.55rem] tabular-nums">
            {{ unread() > 9 ? '9+' : unread() }}
          </span>
        }
      </button>

      @if (open()) {
        <div class="absolute right-0 mt-2 w-80 max-h-96 overflow-auto rounded-xl border border-border bg-card shadow-xl z-50"
             role="dialog" aria-label="Notifications" data-testid="v2-notif-panel">
          <div class="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card">
            <span class="text-sm font-medium text-foreground">Notifications</span>
            @if (unread() > 0) {
              <button hlmBtn variant="ghost" size="sm" (click)="markAllRead()" data-testid="v2-notif-readall">Mark all read</button>
            }
          </div>
          @if (loadError()) {
            <p class="px-3 py-6 text-center text-sm text-destructive">Couldn't load notifications.</p>
          } @else if (items().length === 0) {
            <p class="px-3 py-8 text-center text-sm text-muted-foreground" data-testid="v2-notif-empty">You're all caught up.</p>
          } @else {
            <ul>
              @for (n of items(); track n.id) {
                <li class="px-3 py-2 border-b border-border/50 hover:bg-primary/5 cursor-pointer transition-colors"
                    [class.opacity-60]="n.isRead" (click)="markRead(n)">
                  <div class="flex items-start gap-2">
                    @if (!n.isRead) { <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0"></span> }
                    <div class="min-w-0 flex-1">
                      @if (n.subject) { <p class="text-sm font-medium text-foreground truncate">{{ n.subject }}</p> }
                      <p class="text-xs text-muted-foreground line-clamp-2">{{ n.body }}</p>
                      <p class="text-[0.6rem] text-muted-foreground mt-0.5">{{ n.createdAt | relativeDate }}</p>
                    </div>
                  </div>
                </li>
              }
            </ul>
          }
        </div>
      }
    </div>
  `,
})
export class V2NotifBellComponent {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly open = signal(false);
  protected readonly items = signal<FeedItem[]>([]);
  protected readonly unread = signal(0);
  protected readonly loadError = signal(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @novu/js Novu instance
  private novu: any = null;

  constructor() {
    afterNextRender(async () => {
      const subscriberId = this.auth.session()?.identifier || 'anonymous';
      try {
        const { Novu } = await import('@novu/js');
        this.novu = new Novu({ applicationIdentifier: NOVU_APP_ID, subscriber: { subscriberId } });
        await this.refresh();
        // Real-time: refresh on any inbound notification (event name is defensive).
        try {
          this.novu.on?.('notifications.notification_received', () => void this.refresh());
        } catch {
          /* socket events optional */
        }
      } catch {
        this.loadError.set(true);
      }
      this.destroyRef.onDestroy(() => {
        try {
          this.novu?.socket?.disconnect?.();
        } catch {
          /* noop */
        }
      });
    });
  }

  protected readonly hasUnread = computed(() => this.unread() > 0);

  private async refresh(): Promise<void> {
    if (!this.novu) return;
    try {
      const res = await this.novu.notifications.list({ limit: 15 });
      const list = res?.data?.notifications ?? res?.data ?? [];
      this.items.set(
        (Array.isArray(list) ? list : []).map((n: Record<string, unknown>) => ({
          id: String(n['id'] ?? n['_id'] ?? ''),
          subject: String(n['subject'] ?? ''),
          body: String(n['body'] ?? n['content'] ?? ''),
          createdAt: String(n['createdAt'] ?? ''),
          isRead: Boolean(n['isRead'] ?? n['read'] ?? false),
        })),
      );
      // Unread count: prefer the count API, fall back to local tally.
      try {
        const c = await this.novu.notifications.count({ filters: [{ read: false }] });
        const n = c?.data?.counts?.[0]?.count ?? c?.data?.count;
        this.unread.set(typeof n === 'number' ? n : this.items().filter((i) => !i.isRead).length);
      } catch {
        this.unread.set(this.items().filter((i) => !i.isRead).length);
      }
      this.loadError.set(false);
    } catch {
      this.loadError.set(true);
    }
  }

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) void this.refresh();
  }

  protected async markRead(n: FeedItem): Promise<void> {
    if (n.isRead || !this.novu) return;
    try {
      await this.novu.notifications.read({ notificationId: n.id });
    } catch {
      /* optimistic anyway */
    }
    this.items.set(this.items().map((i) => (i.id === n.id ? { ...i, isRead: true } : i)));
    this.unread.set(Math.max(0, this.unread() - 1));
  }

  protected async markAllRead(): Promise<void> {
    const unreadItems = this.items().filter((i) => !i.isRead);
    this.items.set(this.items().map((i) => ({ ...i, isRead: true })));
    this.unread.set(0);
    for (const i of unreadItems) {
      try {
        await this.novu?.notifications.read({ notificationId: i.id });
      } catch {
        /* best-effort */
      }
    }
  }
}
