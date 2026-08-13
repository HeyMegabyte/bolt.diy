import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

/** One appointment, mirrors the worker `BookingAppointment` shape. */
interface Appointment {
  id: string;
  site_id: string;
  visitor_name: string;
  visitor_email: string;
  notes?: string | null;
  status: 'confirmed' | 'cancelled';
  created_at: string;
  cancelled_at?: string | null;
}

/** `GET /api/booking/appointments` response. */
interface AppointmentsResponse {
  appointments: Appointment[];
}

/**
 * Bookings widget — the client for the `native_booking_engine` feature. Surfaces
 * the org's recent appointments (who booked, status) on the getting-started hub so
 * an owner sees inbound bookings at a glance.
 *
 * @remarks
 * The API IS the flag gate: `GET /api/booking/appointments` returns 404 when the
 * `native_booking_engine` flag is off → the widget renders nothing. It also
 * self-hides when there are no appointments yet.
 *
 * @example
 * <app-bookings-widget />
 */
@Component({
  selector: 'app-bookings-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <section class="bk" role="region" aria-labelledby="bk-heading" data-testid="bookings-widget">
        <header class="bk-head">
          <div>
            <p class="bk-eyebrow" id="bk-heading">Bookings</p>
            <p class="bk-sub">{{ confirmedCount() }} confirmed · {{ appointments().length }} total</p>
          </div>
          <span class="bk-count" data-testid="bookings-count">{{ confirmedCount() }}</span>
        </header>
        <ul class="bk-list" data-testid="bookings-list">
          @for (a of appointments(); track a.id) {
            <li class="bk-item" data-testid="bookings-item" [attr.data-status]="a.status">
              <span class="bk-avatar" aria-hidden="true">{{ initials(a.visitor_name) }}</span>
              <span class="bk-body">
                <span class="bk-name">{{ a.visitor_name }}</span>
                <span class="bk-meta">{{ a.visitor_email }} · {{ relTime(a.created_at) }}</span>
              </span>
              <span class="bk-status" [class]="'bk-status--' + a.status" data-testid="bookings-status">{{ a.status }}</span>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .bk { margin: 0 0 1.25rem; padding: 1.1rem 1.3rem; border: 1px solid rgba(255,255,255,0.08); border-radius: var(--ps-radius-xl, 22px); background: rgba(255,255,255,0.015); }
    .bk-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.8rem; }
    .bk-eyebrow { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ps-accent, #00e5ff); margin: 0 0 0.2rem; }
    .bk-sub { font-size: 0.72rem; color: rgba(255,255,255,0.5); margin: 0; }
    .bk-count { font-size: 1.3rem; font-weight: 800; color: var(--ps-accent, #00e5ff); font-variant-numeric: tabular-nums; }
    .bk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .bk-item { display: flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0; border-top: 1px solid rgba(255,255,255,0.04); min-width: 0; }
    .bk-item:first-child { border-top: 0; }
    .bk-avatar { flex-shrink: 0; width: 30px; height: 30px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.68rem; font-weight: 800; color: var(--ps-accent, #00e5ff); background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent); }
    .bk-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .bk-name { font-size: 0.86rem; color: var(--ps-ink, #f4f4ff); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bk-meta { font-size: 0.68rem; color: rgba(255,255,255,0.45); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bk-status { flex-shrink: 0; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 9px; border-radius: 999px; }
    .bk-status--confirmed { color: #34d399; background: color-mix(in oklch, #34d399 14%, transparent); }
    .bk-status--cancelled { color: rgba(255,255,255,0.5); background: rgba(255,255,255,0.06); text-decoration: line-through; }
  `],
})
export class BookingsWidgetComponent implements OnInit {
  private readonly api = inject(ApiService);

  private readonly data = signal<Appointment[] | null>(null);

  readonly appointments = computed(() => this.data() ?? []);
  readonly confirmedCount = computed(() => this.appointments().filter((a) => a.status === 'confirmed').length);
  readonly visible = computed(() => this.appointments().length > 0);

  ngOnInit(): void {
    // `silent: true` — a 404 (flag off) is expected, never a user-facing toast.
    this.api.get<AppointmentsResponse>('/booking/appointments', undefined, { silent: true }).subscribe({
      next: (res) => this.data.set(Array.isArray(res?.appointments) ? res.appointments : []),
      error: () => this.data.set([]),
    });
  }

  initials(name: string): string {
    return (name || '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  /** Compact relative time from an ISO/SQL timestamp. */
  relTime(ts: string): string {
    const then = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z').getTime();
    if (Number.isNaN(then)) return '';
    const m = Math.floor(Math.max(0, Date.now() - then) / 60_000);
    if (m < 60) return `${Math.max(1, m)}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
}
