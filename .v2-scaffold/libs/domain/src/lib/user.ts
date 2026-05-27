/**
 * User + identity SSOT. Mirrors D1 `users` + `memberships` shape.
 */
import { z } from 'zod';
import { CapabilitySchema } from './capabilities.js';
import { RoleSchema, ViewAsSchema } from './role.js';
import { TenantSchema } from './tenant.js';

export const UserSchema = z
  .object({
    id: z.string().min(1),
    email: z.email(),
    name: z.string().min(1).nullable(),
    avatar_url: z.url().nullable(),
    created_at: z.iso.datetime({ offset: true }),
    role: RoleSchema,
    view_as: ViewAsSchema.nullable(),
    totp_enabled: z.boolean(),
    passkey_count: z.number().int().nonnegative(),
  })
  .strict();

export type User = z.infer<typeof UserSchema>;

/**
 * Response shape for `GET /api/auth/me`.
 *
 * @example
 * ```ts
 * const me = MeSchema.parse(await fetch('/api/auth/me').then(r => r.json()));
 * if (me.isSuperAdmin) showOperatorTools();
 * ```
 */
export const MeSchema = z
  .object({
    user: UserSchema,
    capabilities: z.array(CapabilitySchema).readonly(),
    tenants: z.array(TenantSchema).readonly(),
    currentTenant: TenantSchema.nullable(),
    isSuperAdmin: z.boolean(),
  })
  .strict();

export type Me = z.infer<typeof MeSchema>;
