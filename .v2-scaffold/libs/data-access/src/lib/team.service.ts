/**
 * `TeamService` — RxJS-first wrapper for workspace team + invites.
 *
 * Owns:
 *   - `listMembers$()` — current accepted members (workspace + platform role overlay)
 *   - `pendingInvites$()` — pending (unaccepted) invites
 *   - `invite$(batch)` — POST `/api/team/invite` once per email (server batches log)
 *   - `resendInvite$(id)` / `revokeInvite$(id)` — invite lifecycle
 *   - `updateMemberRole$(memberId, role)` / `removeMember$(memberId)` — membership mutations
 *
 * Spec coverage: `feature-team/__tests__/team-invite.spec.ts`.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  type Observable,
  forkJoin,
  map,
  of,
  shareReplay,
  tap,
} from 'rxjs';
import { z } from 'zod';
import {
  MembershipSchema,
  RoleSchema,
  type Membership,
  type Role,
} from '@org/domain';

/** Workspace-scoped role distinct from platform `Role`. */
export const WorkspaceRoleSchema = z.enum([
  'owner',
  'admin',
  'member',
  'viewer',
] as const);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

/** Hydrated member row used by the ag-grid Team table. */
export const TeamMemberSchema = z
  .object({
    member_id: z.string().min(1),
    user_id: z.string().min(1),
    email: z.email(),
    name: z.string().min(1).nullable(),
    avatar_url: z.url().nullable(),
    workspace_role: WorkspaceRoleSchema,
    platform_role: RoleSchema,
    joined_at: z.iso.datetime({ offset: true }).nullable(),
    last_seen_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export type TeamMember = z.infer<typeof TeamMemberSchema>;

/** Single pending invite row. */
export const PendingInviteSchema = z
  .object({
    invite_id: z.string().min(1),
    email: z.email(),
    workspace_role: WorkspaceRoleSchema,
    invited_by: z.string().min(1),
    invited_at: z.iso.datetime({ offset: true }),
    expires_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export type PendingInvite = z.infer<typeof PendingInviteSchema>;

export interface InviteRequest {
  readonly email: string;
  readonly role: WorkspaceRole;
}

export interface InviteResult {
  readonly invite_id: string;
  readonly email: string;
  readonly status: 'sent' | 'already_member' | 'already_invited';
}

interface MembersResponse {
  readonly members: readonly TeamMember[];
}

interface InvitesResponse {
  readonly invites: readonly PendingInvite[];
}

@Injectable({ providedIn: 'root' })
export class TeamService {
  private readonly http = inject(HttpClient);

  /** Current accepted members on the active workspace. */
  listMembers$(): Observable<readonly TeamMember[]> {
    return this.http
      .get<MembersResponse>('/api/team/members')
      .pipe(
        map((r) => r.members ?? []),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
  }

  /** Pending (unaccepted) invites on the active workspace. */
  pendingInvites$(): Observable<readonly PendingInvite[]> {
    return this.http
      .get<InvitesResponse>('/api/team/invites/pending')
      .pipe(map((r) => r.invites ?? []));
  }

  /**
   * Send one POST `/api/team/invite` per email. Per spec
   * (`team-invite.spec.ts`) the dialog must call once per email, not a single
   * bulk request — keeps the audit log granular and the email outbox honest.
   */
  invite$(batch: readonly InviteRequest[]): Observable<readonly InviteResult[]> {
    if (batch.length === 0) return of([]);
    return forkJoin(
      batch.map((req) =>
        this.http.post<InviteResult>('/api/team/invite', req),
      ),
    );
  }

  resendInvite$(inviteId: string): Observable<void> {
    return this.http
      .post<void>(`/api/team/invites/${encodeURIComponent(inviteId)}/resend`, {})
      .pipe(tap(() => undefined));
  }

  revokeInvite$(inviteId: string): Observable<void> {
    return this.http
      .delete<void>(`/api/team/invites/${encodeURIComponent(inviteId)}`)
      .pipe(tap(() => undefined));
  }

  updateMemberRole$(
    memberId: string,
    role: WorkspaceRole,
  ): Observable<TeamMember> {
    return this.http.patch<TeamMember>(
      `/api/team/members/${encodeURIComponent(memberId)}`,
      { workspace_role: role },
    );
  }

  removeMember$(memberId: string): Observable<void> {
    return this.http
      .delete<void>(`/api/team/members/${encodeURIComponent(memberId)}`)
      .pipe(tap(() => undefined));
  }

  /** Operator-only: promote workspace member to platform `super_admin`. */
  promoteToPlatformRole$(
    memberId: string,
    platformRole: Role,
  ): Observable<Membership> {
    return this.http
      .post<Membership>(
        `/api/team/members/${encodeURIComponent(memberId)}/promote`,
        { platform_role: platformRole },
      )
      .pipe(map((m) => MembershipSchema.parse(m)));
  }
}
