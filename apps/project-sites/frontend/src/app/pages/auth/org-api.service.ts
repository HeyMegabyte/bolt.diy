import { Injectable } from '@angular/core';
import type { AuthResult } from './auth-api.service';

/**
 * Better Auth organization HTTP client (idea #24 — org invites).
 *
 * @remarks
 * Thin wrapper around the Better Auth organization plugin, exposed at
 * `/api/auth/organization/*`. No SDK — every call is a `fetch` with
 * `credentials: 'include'` so the session cookie minted by the worker
 * round-trips. Each method returns a discriminated {@link AuthResult}:
 * `{ ok: true, data }` on 2xx, `{ ok: false, error }` otherwise. Callers
 * never see a thrown error for an HTTP failure — only network faults reject,
 * and those are caught and mapped to `{ ok: false }` too.
 *
 * Mirrors {@link AuthApiService}'s request/extract-error shape exactly so the
 * two clients behave identically on the wire.
 *
 * @see https://www.better-auth.com/docs/plugins/organization — endpoint shapes
 */

/** Base path for every Better Auth organization endpoint. */
const ORG_BASE = '/api/auth/organization';

/** A member of an organization as returned by Better Auth. */
export interface OrgMember {
  id: string;
  organizationId?: string;
  userId?: string;
  role: string;
  createdAt?: string;
  /** Some Better Auth versions embed the user; we read either shape. */
  user?: { id?: string; email?: string; name?: string | null } | null;
  email?: string | null;
  name?: string | null;
}

/** A pending invitation row returned by `get-full-organization`. */
export interface OrgInvitation {
  id: string;
  organizationId?: string;
  email: string;
  role: string;
  status?: string;
  expiresAt?: string;
  inviterId?: string;
  createdAt?: string;
}

/** Full organization payload — members + pending invitations. */
export interface FullOrganization {
  id?: string;
  name?: string;
  slug?: string;
  /** Authoritative seat cap from plan entitlements (`-1` = unlimited). */
  seatLimit?: number;
  /** Seats consumed = active members + pending invites. */
  seatUsed?: number;
  members: OrgMember[];
  invitations: OrgInvitation[];
}

/** Roles a member can hold / be invited as. */
export type OrgRole = 'owner' | 'admin' | 'member';

@Injectable({ providedIn: 'root' })
export class OrgApiService {
  /** POST a JSON body to an org endpoint and map the response to AuthResult. */
  private async post<T>(path: string, body: unknown): Promise<AuthResult<T>> {
    return this.request<T>('POST', path, body);
  }

  /** GET an org endpoint and map the response to AuthResult. */
  private async get<T>(path: string): Promise<AuthResult<T>> {
    return this.request<T>('GET', path);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<AuthResult<T>> {
    try {
      // Attach the custom-auth Bearer session (ps_session) so authed org calls
      // reach our custom handlers authenticated — native fetch bypasses Angular's
      // HttpClient interceptor (same fix as auth-api.service).
      const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
      try {
        const raw = localStorage.getItem('ps_session');
        const token = raw ? (JSON.parse(raw) as { token?: string })?.token : null;
        if (token) headers['authorization'] = `Bearer ${token}`;
      } catch {
        /* no session / private mode */
      }
      const res = await fetch(`${ORG_BASE}${path}`, {
        method,
        credentials: 'include',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      if (!res.ok) {
        return { ok: false, status: res.status, error: this.extractError(parsed, res.status) };
      }
      return { ok: true, data: (parsed ?? {}) as T };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network request failed' };
    }
  }

  /** Pull a human-readable message out of a Better Auth error body. */
  private extractError(parsed: unknown, status: number): string {
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const msg = obj['message'] ?? obj['error'] ?? obj['code'];
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
    if (typeof parsed === 'string' && parsed.trim()) return parsed;
    if (status === 401) return 'You need to sign in to manage your team.';
    if (status === 403) return 'You do not have permission to do that.';
    if (status === 404) return 'No active organization found.';
    if (status === 429) return 'Too many attempts. Please wait and try again.';
    return `Request failed (${status}).`;
  }

  /**
   * Fetch the active organization with its members + pending invitations.
   *
   * @returns members[] + invitations[] for the caller's active org.
   * @example
   * const res = await org.getFullOrganization();
   * if (res.ok) console.log(res.data.members.length);
   */
  getFullOrganization(): Promise<AuthResult<FullOrganization>> {
    return this.get<FullOrganization>('/get-full-organization');
  }

  /**
   * Invite a member by email with a role.
   *
   * @param input.email - recipient email address.
   * @param input.role - `owner` | `admin` | `member`.
   */
  inviteMember(input: { email: string; role: OrgRole }): Promise<AuthResult<OrgInvitation>> {
    return this.post<OrgInvitation>('/invite-member', input);
  }

  /** Cancel a pending invitation by id. */
  cancelInvitation(input: { invitationId: string }): Promise<AuthResult<{ status?: boolean }>> {
    return this.post<{ status?: boolean }>('/cancel-invitation', input);
  }

  /** Remove a member by member id or email. */
  removeMember(input: { memberIdOrEmail: string }): Promise<AuthResult<{ status?: boolean }>> {
    return this.post<{ status?: boolean }>('/remove-member', input);
  }
}
