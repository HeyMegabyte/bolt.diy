/**
 * @module libs/features/agency_white_label/service
 * @description Service for the White-Label Agency Tier (idea #34).
 *
 * Resolves brand-chrome by hostname for the Worker router, plus tenant CRUD.
 * Owner-scoped (only the org that created the tenant can edit it).
 *
 * @packageDocumentation
 */

import { dbInsert, dbQuery, dbQueryOne, dbUpdate } from '../../../src/services/db.js';
import type {
  AgencyConfig,
  AgencyStatus,
  AgencyTenant,
  AgencyTier,
  BrandChrome,
} from './schemas.js';

interface AgencyRow extends Omit<AgencyTenant, 'tier' | 'status'> {
  tier: string;
  status: string;
}

function rowToTenant(row: AgencyRow): AgencyTenant {
  return {
    ...row,
    tier: row.tier as AgencyTier,
    status: row.status as AgencyStatus,
  };
}

/**
 * Hostname-router lookup: cheap, indexed, called on every request hitting
 * a non-default admin domain. Returns `null` for built-in domains so the
 * caller falls back to the projectsites default chrome.
 */
export async function resolveBrandChrome(
  db: D1Database,
  hostname: string,
): Promise<BrandChrome | null> {
  const row = await dbQueryOne<{
    brand_name: string;
    logo_url: string | null;
    primary_color: string | null;
    support_email: string | null;
    tier: string;
  }>(
    db,
    `SELECT brand_name, logo_url, primary_color, support_email, tier
       FROM agency_tenants
       WHERE custom_domain = ? AND status = 'active'
       LIMIT 1`,
    [hostname.toLowerCase()],
  );
  if (!row) return null;
  return {
    brand_name: row.brand_name,
    logo_url: row.logo_url,
    primary_color: row.primary_color,
    support_email: row.support_email,
    tier: row.tier as AgencyTier,
  };
}

export async function createTenant(
  db: D1Database,
  args: {
    ownerUserId: string;
    ownerOrgId: string;
    tier: AgencyTier;
    config: AgencyConfig;
  },
): Promise<AgencyTenant> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error } = await dbInsert(db, 'agency_tenants', {
    id,
    owner_user_id: args.ownerUserId,
    owner_org_id: args.ownerOrgId,
    brand_name: args.config.brand_name,
    logo_url: args.config.logo_url ?? null,
    primary_color: args.config.primary_color ?? null,
    custom_domain: args.config.custom_domain?.toLowerCase() ?? null,
    support_email: args.config.support_email ?? null,
    tier: args.tier,
    status: 'pending',
    created_at: now,
    updated_at: now,
  });
  if (error) throw new Error(`Failed to create agency tenant: ${error}`);
  const created = await getTenantById(db, id);
  if (!created) throw new Error('Created tenant disappeared');
  return created;
}

export async function getTenantById(
  db: D1Database,
  id: string,
): Promise<AgencyTenant | null> {
  const row = await dbQueryOne<AgencyRow>(
    db,
    `SELECT id, owner_user_id, owner_org_id, brand_name, logo_url, primary_color,
            custom_domain, stripe_account_id, support_email, tier, status,
            created_at, updated_at, activated_at
       FROM agency_tenants
       WHERE id = ?
       LIMIT 1`,
    [id],
  );
  return row ? rowToTenant(row) : null;
}

export async function listTenantsForOrg(
  db: D1Database,
  ownerOrgId: string,
): Promise<AgencyTenant[]> {
  const result = await dbQuery<AgencyRow>(
    db,
    `SELECT id, owner_user_id, owner_org_id, brand_name, logo_url, primary_color,
            custom_domain, stripe_account_id, support_email, tier, status,
            created_at, updated_at, activated_at
       FROM agency_tenants
       WHERE owner_org_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
    [ownerOrgId],
  );
  return result.data.map(rowToTenant);
}

export async function updateTenant(
  db: D1Database,
  args: { id: string; ownerOrgId: string; patch: Partial<AgencyConfig> },
): Promise<AgencyTenant | null> {
  const existing = await getTenantById(db, args.id);
  if (!existing) return null;
  if (existing.owner_org_id !== args.ownerOrgId) return null;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (args.patch.brand_name !== undefined) updates.brand_name = args.patch.brand_name;
  if (args.patch.logo_url !== undefined) updates.logo_url = args.patch.logo_url;
  if (args.patch.primary_color !== undefined) updates.primary_color = args.patch.primary_color;
  if (args.patch.custom_domain !== undefined) {
    updates.custom_domain = args.patch.custom_domain
      ? args.patch.custom_domain.toLowerCase()
      : null;
  }
  if (args.patch.support_email !== undefined) updates.support_email = args.patch.support_email;
  await dbUpdate(db, 'agency_tenants', updates, 'id = ?', [args.id]);
  return getTenantById(db, args.id);
}

/**
 * Mark a tenant active once domain verification + Stripe Connect onboarding
 * complete. Both pre-conditions are the caller's responsibility — this is
 * the activation pen-stroke once they pass.
 */
export async function activateTenant(
  db: D1Database,
  id: string,
  stripeAccountId: string,
): Promise<void> {
  await dbUpdate(
    db,
    'agency_tenants',
    {
      stripe_account_id: stripeAccountId,
      status: 'active',
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    'id = ?',
    [id],
  );
}
