import { Injectable } from '@angular/core';

/**
 * Better Auth HTTP client.
 *
 * @remarks
 * Thin wrapper around the Better Auth Cloudflare Worker, exposed at `/api/auth/*`.
 * No SDK — every call is a `fetch` with `credentials: 'include'` so the session
 * cookie minted by the worker round-trips. Each method returns a discriminated
 * union: `{ ok: true, data }` on 2xx, `{ ok: false, error }` otherwise. Callers
 * never see a thrown error for an HTTP failure — only network faults reject, and
 * those are caught and mapped to `{ ok: false }` too.
 *
 * @see https://www.better-auth.com/docs — endpoint shapes
 */

/** Base path for every Better Auth endpoint. */
const AUTH_BASE = '/api/auth';

/** A signed-in user as returned by Better Auth. */
export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  emailVerified?: boolean;
  image?: string | null;
}

/** Session row returned by `list-sessions`. */
export interface AuthSession {
  id: string;
  token: string;
  userId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
}

/** Result of an email/password sign-in or sign-up. */
export interface AuthSignInResult {
  token?: string;
  user?: AuthUser;
  redirect?: boolean;
  url?: string;
}

/** Discriminated result for every method — never throws on HTTP failure. */
export type AuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

@Injectable({ providedIn: 'root' })
export class AuthApiService {
  /**
   * POST a JSON body to a Better Auth endpoint and map the response to AuthResult.
   *
   * @remarks Impure — performs network I/O. Non-2xx maps to `{ ok: false }`.
   */
  private async post<T>(path: string, body: unknown): Promise<AuthResult<T>> {
    return this.request<T>('POST', path, body);
  }

  /** GET a Better Auth endpoint and map the response to AuthResult. */
  private async get<T>(path: string): Promise<AuthResult<T>> {
    return this.request<T>('GET', path);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<AuthResult<T>> {
    try {
      const res = await fetch(`${AUTH_BASE}${path}`, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
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
    if (status === 401) return 'Invalid email or password.';
    if (status === 403) return 'You do not have permission to do that.';
    if (status === 429) return 'Too many attempts. Please wait and try again.';
    return `Request failed (${status}).`;
  }

  /** Sign in with email + password. */
  signInEmail(input: { email: string; password: string }): Promise<AuthResult<AuthSignInResult>> {
    return this.post<AuthSignInResult>('/sign-in/email', input);
  }

  /** Register a new account with name + email + password. */
  signUpEmail(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<AuthResult<AuthSignInResult>> {
    return this.post<AuthSignInResult>('/sign-up/email', input);
  }

  /** Request a passwordless magic link by email. */
  sendMagicLink(input: { email: string }): Promise<AuthResult<{ status?: boolean }>> {
    return this.post<{ status?: boolean }>('/sign-in/magic-link', input);
  }

  /** List the current user's active sessions. */
  listSessions(): Promise<AuthResult<AuthSession[]>> {
    return this.get<AuthSession[]>('/list-sessions');
  }

  /** Revoke a single session by its token. */
  revokeSession(input: { token: string }): Promise<AuthResult<{ status?: boolean }>> {
    return this.post<{ status?: boolean }>('/revoke-session', input);
  }

  /** Sign the current device out. */
  signOut(): Promise<AuthResult<{ success?: boolean }>> {
    return this.post<{ success?: boolean }>('/sign-out', {});
  }

  /** Revoke every session except (optionally) the current one — sign out everywhere. */
  revokeOtherSessions(): Promise<AuthResult<{ status?: boolean }>> {
    return this.post<{ status?: boolean }>('/revoke-other-sessions', {});
  }
}
