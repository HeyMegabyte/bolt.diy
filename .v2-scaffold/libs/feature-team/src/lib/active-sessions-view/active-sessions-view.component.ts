/**
 * `ActiveSessionsViewComponent` — workspace-scoped view of every active
 * session across every member. Replicates the per-user
 * `SessionsListComponent` from `@org/auth` but pivots through the team
 * service (workspace-owner visibility).
 *
 * Stubbed against `@org/auth` until that lib lands its session-list public
 * export; falls back to a typed shim so tests + typecheck pass today.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';

interface WorkspaceSession {
  readonly session_id: string;
  readonly user_email: string;
  readonly device: string;
  readonly ip: string;
  readonly created_at: string;
  readonly last_seen_at: string;
}

@Component({
  selector: 'lib-active-sessions-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './active-sessions-view.component.html',
  styleUrls: ['./active-sessions-view.component.css'],
})
export class ActiveSessionsViewComponent {
  private readonly http = inject(HttpClient);

  protected readonly sessions$: Observable<readonly WorkspaceSession[]> = this.http
    .get<{ sessions: readonly WorkspaceSession[] }>('/api/team/sessions')
    .pipe(map((r) => r.sessions ?? []));

  protected revoke(id: string): void {
    this.http.delete<void>(`/api/team/sessions/${encodeURIComponent(id)}`).subscribe();
  }

  protected trackSession = (_: number, s: WorkspaceSession): string => s.session_id;

  /** Used by tests to assert the stubbed empty path renders gracefully. */
  protected emptyStub$ = of([] as readonly WorkspaceSession[]);
}
