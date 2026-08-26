import { Injectable, signal } from '@angular/core';

/** Flat, framework-agnostic inbox item the admin bell merges into its feed. */
export interface NovuInboxItem {
  /** Namespaced `novu-<id>` so it never collides with audit/seed ids. */
  id: string;
  title: string;
  body: string;
  read: boolean;
  ts: number;
  href: string | null;
}

/**
 * INERT Novu shim — Novu is fully decommissioned per ADR-0034
 * (Novu → custom `psnotify`). The previous implementation lazily loaded
 * `@novu/js` and opened a Novu Cloud session on every admin boot, which
 * produced a `400` console error on each load (caught by the Pass-3
 * convergence journey suite). Until `psnotify` (DO-backed inbox + center +
 * prefs + SES/web-push) lands, this service keeps the notification-bell
 * contract intact while doing ZERO network I/O.
 *
 * @remarks `list()` always resolves `[]`, `read()` is a no-op, and
 * {@link connected} stays `false` — the bell degrades to the seeded/audit
 * feed exactly as it did when Novu Cloud was unreachable.
 */
@Injectable({ providedIn: 'root' })
export class NovuInboxService {
  /** Always false — no external notification backend is connected. */
  readonly connected = signal(false);

  /** Resolves to an empty inbox; psnotify will replace this surface. */
  async list(_limit = 20): Promise<NovuInboxItem[]> {
    return [];
  }

  /** No-op read receipt — nothing external to acknowledge. */
  async read(_namespacedId: string): Promise<void> {
    /* intentionally empty */
  }
}
