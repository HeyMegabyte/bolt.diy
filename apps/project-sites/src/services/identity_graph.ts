/**
 * @module services/identity_graph
 * @description AP13 — cross-app identity graph. Maps a projectsites user to
 * their linked identities across the self-hosted stack (Twenty CRM / Listmonk)
 * so services like psnotify, billing aggregation, and AI ops
 * can resolve a unified customer view. Pure + zero-I/O: the caller resolves the
 * raw rows from each app's DB/API and passes them in; this layer is the
 * deterministic merge + dedup logic. Never throws.
 *
 * @packageDocumentation
 */

/** A linked identity in one app. */
export interface AppIdentity {
  /** App key, e.g. `twenty` / `listmonk` / `social_native`. */
  readonly app: string;
  /** The app's native identifier (UUID / member-id / subscriber-id / key-id). */
  readonly externalId: string;
  /** Optional human label, e.g. the email or display name. */
  readonly label?: string;
  /**
   * Mapped role in that app, where known (e.g. `admin` / `member` / `subscriber`).
   * Used by the billing/entitlement aggregator to determine cross-app access.
   */
  readonly role?: string;
}

/** One node in the identity graph (a projectsites user + their linked apps). */
export interface IdentityNode {
  readonly userId: string;
  /** Primary email anchoring the cross-app identity. */
  readonly email: string;
  /** Linked app identities, deduped per app. */
  readonly apps: readonly AppIdentity[];
  /** Count of apps with at least one linked identity. */
  readonly appCount: number;
  /** True when this user has an identity in ≥2 apps (truly cross-app). */
  readonly isCrossApp: boolean;
}

export interface IdentityGraph {
  readonly nodes: readonly IdentityNode[];
  readonly totalUsers: number;
  readonly crossAppUsers: number;
  /** Per-app unique-user counts for the dashboard. */
  readonly appCounts: Readonly<Record<string, number>>;
}

/**
 * Build the cross-app identity graph from per-app identity rows. Deduplicates by
 * (app, externalId) per user; sorts nodes by app-count desc so the dashboard
 * shows the most-connected users first. Missing emails → `"unknown"`.
 *
 * @param identities - Flat list of (userId, email, app, externalId, …) rows from ALL app DBs.
 * @returns {@link IdentityGraph}.
 *
 * @example
 * buildIdentityGraph([
 *   { userId:'u1', email:'x@y.com', app:'twenty', externalId:'lead_1', role:'admin' },
 *   { userId:'u1', email:'x@y.com', app:'twenty', externalId:'p_1' },
 * ]).crossAppUsers // → 1
 */
export function buildIdentityGraph(
  identities: readonly (Omit<AppIdentity, 'app' | 'externalId'> & {
    readonly userId: string;
    readonly email: string;
    readonly app: string;
    readonly externalId: string;
  })[],
): IdentityGraph {
  const rows = Array.isArray(identities) ? identities : [];
  const map = new Map<string, { email: string; apps: Map<string, AppIdentity> }>();

  for (const r of rows) {
    if (!r || typeof r.userId !== 'string' || !r.userId.trim()) continue;
    const uid = r.userId.trim();
    const app = (r.app ?? '').trim();
    if (!app) continue;
    const extId = (r.externalId ?? '').trim();
    if (!extId) continue;

    let node = map.get(uid);
    if (!node) {
      node = { email: (r.email ?? '').trim() || 'unknown', apps: new Map() };
      map.set(uid, node);
    }

    // Keep the best email (prefer the one with actual content).
    if (r.email?.trim() && node.email === 'unknown') {
      // Only upgrade from 'unknown' — first non-empty wins (stable).
      node.email = r.email.trim();
    }

    const key = `${app}:${extId}`;
    if (!node.apps.has(key)) {
      node.apps.set(key, {
        app,
        externalId: extId,
        label: r.label?.trim() || undefined,
        role: r.role?.trim() || undefined,
      });
    }
  }

  const nodes: IdentityNode[] = [];
  let crossAppUsers = 0;
  const appCounts: Record<string, number> = {};

  for (const [userId, { email, apps }] of map) {
    const appList = [...apps.values()];
    const appSet = new Set(appList.map((a) => a.app));
    const appCount = appSet.size;
    const isCrossApp = appCount >= 2;
    if (isCrossApp) crossAppUsers++;
    for (const a of appSet) appCounts[a] = (appCounts[a] ?? 0) + 1;

    nodes.push({
      userId,
      email,
      apps: appList.sort(
        (a, b) => a.app.localeCompare(b.app) || a.externalId.localeCompare(b.externalId),
      ),
      appCount,
      isCrossApp,
    });
  }

  nodes.sort((a, b) => b.appCount - a.appCount || a.email.localeCompare(b.email));

  return { nodes, totalUsers: nodes.length, crossAppUsers, appCounts };
}
