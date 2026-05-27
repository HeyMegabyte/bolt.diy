/**
 * Capability SSOT — every gateable surface in the v2 admin.
 *
 * Capabilities are fine-grained permission strings of the form
 * `<resource>:<action>`. They compose into roles via
 * {@link roleCapabilities} below. Server middleware MUST validate the
 * user's effective capability set on every mutation.
 *
 * @remarks Derived from the 27 admin sections inventoried in AUDIT.md §3.2.
 */
import { z } from 'zod';

export const CapabilitySchema = z.enum([
  // Sites
  'sites:read',
  'sites:write',
  'sites:delete',
  'sites:publish',
  'sites:transfer',

  // Snapshots + diff
  'snapshots:read',
  'snapshots:write',
  'snapshots:delete',
  'snapshots:diff',

  // Analytics
  'analytics:read',
  'analytics:export',

  // Billing
  'billing:read',
  'billing:write',
  'billing:refund',
  'billing:checkout',
  'billing:portal',

  // Audit
  'audit:read',
  'audit:export',

  // Forms
  'forms:read',
  'forms:write',
  'forms:delete',
  'forms:reply',

  // Docs
  'docs:read',

  // AI / traces
  'ai:read',
  'ai:write',
  'ai:dispatch',
  'traces:read',
  'traces:explain',

  // Settings
  'settings:read',
  'settings:write',
  'settings:mcp',
  'settings:env',

  // Users + team
  'users:read',
  'users:write',
  'team:invite',
  'team:remove',

  // Domains
  'domains:read',
  'domains:write',
  'domains:purchase',

  // SEO
  'seo:read',
  'seo:write',

  // Apps + templates
  'apps:read',
  'apps:install',
  'apps:uninstall',
  'apps:dispatch',

  // Social
  'social:read',
  'social:write',
  'social:publish',

  // Media
  'media:read',
  'media:write',
  'media:generate',

  // Voice
  'voice:read',
  'voice:write',
  'voice:dispatch',

  // Bookings + quotes + jobs + crew
  'bookings:read',
  'bookings:write',
  'bookings:cancel',
  'quotes:read',
  'quotes:write',
  'jobs:read',
  'jobs:dispatch',
  'jobs:cancel',
  'crew:read',
  'crew:write',
  'crew:approve',

  // Super-admin
  'super_admin',
  'impersonate',
] as const);

export type Capability = z.infer<typeof CapabilitySchema>;
