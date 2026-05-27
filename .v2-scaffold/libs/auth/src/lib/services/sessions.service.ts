/**
 * SessionsService — list + revoke active sessions for the signed-in user.
 *
 * @remarks
 * Sessions table is owned by control-plane; ARCHITECTURE.md §6 spells out
 * the shape. This service is a typed shim for the
 * {@link SessionsListComponent}.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, map, tap } from 'rxjs';
// TODO: lock in once domain agent lands the Zod runtime exports on @org/domain.
import type { Session } from '@org/domain';

@Injectable({ providedIn: 'root' })
export class SessionsService {
  private readonly http = inject(HttpClient);

  listSessions$(): Observable<readonly Session[]> {
    return this.http
      .get<{ sessions: Session[] }>('/api/auth/sessions')
      .pipe(map((r) => r.sessions));
  }

  revokeSession$(sessionId: string): Observable<void> {
    return this.http
      .delete<void>(`/api/auth/sessions/${encodeURIComponent(sessionId)}`)
      .pipe(tap(() => undefined));
  }

  revokeAllOther$(): Observable<void> {
    return this.http.post<void>('/api/auth/sessions/revoke-others', {});
  }
}
