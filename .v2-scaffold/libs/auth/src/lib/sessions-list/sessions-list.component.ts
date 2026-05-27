/**
 * SessionsListComponent — active sessions for the current user.
 *
 * @remarks
 * Renders one row per session: device fingerprint summary, IP, user-agent,
 * created + last-seen timestamps, expires-at. Each row gets a one-click
 * "Revoke" CTA. There's a "Sign out of everywhere else" footer action
 * that calls `revokeAllOther$`.
 */
import { CommonModule, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { MessageModule } from 'primeng/message';
import { type Observable, Subject, merge, of, startWith, switchMap, tap } from 'rxjs';
// TODO: lock in once domain agent lands the Zod runtime exports on @org/domain.
import type { Session } from '@org/domain';
import { SessionsService } from '../services/sessions.service.js';

@Component({
  selector: 'lib-sessions-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DatePipe, ButtonModule, TableModule, MessageModule],
  templateUrl: './sessions-list.component.html',
  styleUrl: './sessions-list.component.css',
})
export class SessionsListComponent {
  private readonly sessions = inject(SessionsService);

  private readonly refresh$$ = new Subject<void>();

  readonly error = signal<string | null>(null);

  readonly sessions$: Observable<readonly Session[]> = merge(
    of<void>(undefined),
    this.refresh$$,
  ).pipe(
    switchMap(() => this.sessions.listSessions$()),
    startWith<readonly Session[]>([]),
  );

  readonly rows = toSignal(this.sessions$, { initialValue: [] });

  revoke(row: Session): void {
    this.error.set(null);
    this.sessions
      .revokeSession$(row.id)
      .pipe(tap(() => this.refresh$$.next()))
      .subscribe({
        error: () => this.error.set('Could not revoke that session.'),
      });
  }

  revokeAllOther(): void {
    this.error.set(null);
    this.sessions
      .revokeAllOther$()
      .pipe(tap(() => this.refresh$$.next()))
      .subscribe({
        error: () => this.error.set('Could not sign out the other devices.'),
      });
  }

  /** Short-form device summary for the table. */
  describe(s: Session): string {
    const fp = s.device_fingerprint?.slice(0, 8) ?? 'unknown';
    const ua = s.ua ?? 'Unknown browser';
    return `${fp} • ${ua}`;
  }
}
