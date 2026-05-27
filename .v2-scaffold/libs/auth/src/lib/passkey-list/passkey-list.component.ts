/**
 * PasskeyListComponent — list + remove enrolled passkeys.
 *
 * @remarks
 * Pulls from `GET /api/auth/passkey` and renders one row per credential.
 * Each row exposes a delete CTA that fires `DELETE /api/auth/passkey/:id`.
 * Last passkey deletion is blocked server-side when TOTP isn't enrolled
 * AND no other factor is configured.
 */
import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
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
import { type Observable, Subject, map, merge, of, startWith, switchMap, tap } from 'rxjs';

export interface PasskeyRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  /** True if this is the only remaining authenticator. */
  is_last: boolean;
}

interface PasskeyListResponse {
  passkeys: PasskeyRow[];
}

@Component({
  selector: 'lib-passkey-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DatePipe, ButtonModule, TableModule, MessageModule],
  templateUrl: './passkey-list.component.html',
  styleUrl: './passkey-list.component.css',
})
export class PasskeyListComponent {
  private readonly http = inject(HttpClient);

  private readonly refresh$$ = new Subject<void>();

  readonly error = signal<string | null>(null);

  readonly passkeys$: Observable<readonly PasskeyRow[]> = merge(
    of<void>(undefined),
    this.refresh$$,
  ).pipe(
    switchMap(() =>
      this.http
        .get<PasskeyListResponse>('/api/auth/passkey')
        .pipe(map((r) => r.passkeys)),
    ),
    startWith<readonly PasskeyRow[]>([]),
  );

  readonly passkeys = toSignal(this.passkeys$, { initialValue: [] });

  remove(row: PasskeyRow): void {
    if (row.is_last) {
      this.error.set(
        'Add another factor (TOTP or a second passkey) before removing your last passkey.',
      );
      return;
    }
    this.error.set(null);
    this.http
      .delete<void>(`/api/auth/passkey/${encodeURIComponent(row.id)}`)
      .pipe(tap(() => this.refresh$$.next()))
      .subscribe({
        error: () => this.error.set('Could not remove that passkey.'),
      });
  }
}
