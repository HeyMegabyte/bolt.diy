/**
 * Local domain shim for the dashboard shell.
 *
 * @remarks
 * TODO: lock in once the foundation lands — replace these types with
 * imports from `@org/domain` once its barrel re-exports `role`,
 * `user`, `tenant`, and `capabilities`. The current `libs/domain/src/index.ts`
 * re-exports a stub path `./lib/domain/domain` that does not exist.
 */

export type Role = 'customer' | 'crew' | 'super_admin';
export type ViewAs = Role;

/** Capability strings of the form `<resource>:<action>`. */
export type Capability = string;

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  plan_tier: 'free' | 'starter' | 'pro' | 'business' | 'enterprise';
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  role: Role;
  view_as: ViewAs | null;
  totp_enabled: boolean;
  passkey_count: number;
}

export interface Me {
  user: User;
  capabilities: readonly Capability[];
  tenants: readonly Tenant[];
  currentTenant: Tenant | null;
  isSuperAdmin: boolean;
}

/** Discriminated WS frame from `/api/notifications/stream`. */
export interface NotificationFrame {
  type: 'notification' | 'snapshot';
  id: string;
  title: string;
  body: string;
  read: boolean;
  source_url: string | null;
  /** ISO-8601 timestamp. */
  created_at: string;
}

/** Discriminated WS frame from `/api/health/stream`. */
export interface HealthFrame {
  type: 'health';
  ok: boolean;
  /** ISO-8601 timestamp. */
  at: string;
}
