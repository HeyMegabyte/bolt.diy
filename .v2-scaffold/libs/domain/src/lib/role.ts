/**
 * Role + view-as model.
 *
 * The v2 product has three actual roles plus a super-admin "view-as"
 * mechanism that lets operators preview the UI from any role's
 * perspective. {@link RoleSchema} drives navigation gating; the
 * effective capability set is derived from {@link roleCapabilities}.
 */
import { z } from 'zod';
import { type Capability, CapabilitySchema } from './capabilities.js';

export const RoleSchema = z.enum(['customer', 'crew', 'super_admin'] as const);
export type Role = z.infer<typeof RoleSchema>;

export const ViewAsSchema = RoleSchema;
export type ViewAs = z.infer<typeof ViewAsSchema>;

/**
 * Static role -> capability map. Augment via tenant-level grants in
 * the data-access layer; never mutate this object at runtime.
 */
export const roleCapabilities: Readonly<Record<Role, readonly Capability[]>> = {
  customer: [
    'sites:read',
    'sites:write',
    'sites:publish',
    'snapshots:read',
    'snapshots:diff',
    'analytics:read',
    'billing:read',
    'billing:checkout',
    'billing:portal',
    'forms:read',
    'forms:reply',
    'docs:read',
    'ai:read',
    'ai:write',
    'settings:read',
    'settings:write',
    'settings:mcp',
    'settings:env',
    'users:read',
    'team:invite',
    'domains:read',
    'domains:write',
    'domains:purchase',
    'seo:read',
    'seo:write',
    'apps:read',
    'apps:install',
    'apps:uninstall',
    'social:read',
    'social:write',
    'social:publish',
    'media:read',
    'media:write',
    'media:generate',
    'voice:read',
    'voice:write',
    'bookings:read',
    'bookings:write',
    'bookings:cancel',
    'quotes:read',
    'quotes:write',
    'jobs:read',
  ],
  crew: [
    'jobs:read',
    'jobs:dispatch',
    'bookings:read',
    'crew:read',
    'crew:write',
    'media:read',
    'docs:read',
    'voice:read',
    'ai:read',
    'settings:read',
  ],
  super_admin: CapabilitySchema.options,
};

/**
 * Schema validating a capability list against {@link CapabilitySchema}.
 * Used by RBAC middleware to whittle a JWT down to a strict subset.
 */
export const CapabilityListSchema = z.array(CapabilitySchema).readonly();
export type CapabilityList = z.infer<typeof CapabilityListSchema>;
