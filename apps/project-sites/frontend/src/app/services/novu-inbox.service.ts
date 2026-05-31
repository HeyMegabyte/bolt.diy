import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Public, client-safe Novu **application identifier** (NOT the secret key —
 * that lives server-side only). Safe to ship in the bundle by Novu's design.
 */
const NOVU_APP_ID = 'Z_iGtmk4pMwF';

/** Flat, framework-agnostic inbox item the admin bell merges into its feed. */
export interface NovuInboxItem {
  /** Already namespaced `novu-<id>` so it never collides with audit/seed ids. */
  id: string;
  title: string;
  body: string;
  read: boolean;
  ts: number;
  href: string | null;
}

/**
 * Reusable wrapper around headless `@novu/js` — the doctrine notification
 * backbone. Connects to Novu Cloud for the current subscriber and returns the
 * inbox mapped to a flat shape.
 *
 * @remarks Every method is fully guarded: any failure resolves to a safe empty
 * value and NEVER throws or rethrows, so callers can merge results without
 * risking the surface that depends on them. The `@novu/js` module is loaded
 * lazily (dynamic import) so it stays out of the initial bundle.
 *
 * @example
 * ```ts
 * const items = await inject(NovuInboxService).list(20);
 * ```
 */
@Injectable({ providedIn: 'root' })
export class NovuInboxService {
  private auth = inject(AuthService);
  private novu: NovuClient | null = null;

  /** True once a Novu Cloud session has been established for this subscriber. */
  readonly connected = signal(false);

  /**
   * Return the latest inbox items for the signed-in subscriber. Resolves to
   * `[]` when signed out, when Novu is unreachable, or on any error.
   */
  async list(limit = 20): Promise<NovuInboxItem[]> {
    try {
      const subscriberId = this.auth.email();
      if (!subscriberId) return [];
      const novu = await this.client(subscriberId);
      if (!novu) return [];
      const res = await novu.notifications.list({ limit });
      const rows = res?.data?.notifications ?? [];
      return rows.map((n) => this.map(n)).filter((x): x is NovuInboxItem => x !== null);
    } catch {
      return [];
    }
  }

  /** Mark a single Novu notification read. Best-effort, swallows errors. */
  async read(namespacedId: string): Promise<void> {
    try {
      const id = namespacedId.startsWith('novu-') ? namespacedId.slice(5) : namespacedId;
      await this.novu?.notifications?.read?.({ notificationId: id });
    } catch {
      /* swallow — read receipts are non-critical */
    }
  }

  private async client(subscriberId: string): Promise<NovuClient | null> {
    if (this.novu) return this.novu;
    try {
      const mod = (await import('@novu/js')) as unknown as { Novu: NovuCtor };
      this.novu = new mod.Novu({ applicationIdentifier: NOVU_APP_ID, subscriber: { subscriberId } });
      this.connected.set(true);
      return this.novu;
    } catch {
      return null;
    }
  }

  private map(n: unknown): NovuInboxItem | null {
    try {
      const o = n as Record<string, unknown>;
      const rawId = String(o['id'] ?? o['_id'] ?? '');
      if (!rawId) return null;
      const subject = typeof o['subject'] === 'string' ? (o['subject'] as string) : '';
      const body = String(o['body'] ?? o['content'] ?? '');
      const createdAt = o['createdAt'] ?? o['created_at'];
      const ts = createdAt ? new Date(String(createdAt)).getTime() : Date.now();
      const redirect = (o['redirect'] as { url?: string } | undefined)?.url ?? null;
      return {
        id: `novu-${rawId}`,
        title: subject || body || 'Notification',
        body,
        read: Boolean(o['isRead'] ?? o['read'] ?? false),
        ts: Number.isFinite(ts) ? ts : Date.now(),
        href: redirect,
      };
    } catch {
      return null;
    }
  }
}

// Minimal structural types for the slice of `@novu/js` we use — avoids a hard
// compile-time dependency on the SDK's exported types (which vary by version).
interface NovuClient {
  notifications: {
    list(args: { limit: number }): Promise<{ data?: { notifications?: unknown[] } }>;
    read?(args: { notificationId: string }): Promise<unknown>;
  };
}
type NovuCtor = new (opts: { applicationIdentifier: string; subscriber: { subscriberId: string } }) => NovuClient;
