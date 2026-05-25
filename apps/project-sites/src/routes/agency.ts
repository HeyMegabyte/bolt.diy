/**
 * @module routes/agency
 * @description White-label / agency surface.
 *
 * Agencies sub-account their clients under one parent org. Pricing tier
 * gates max sub-accounts + agency-only features (branded admin, Stripe
 * Connect Express payouts, snapshot library).
 *
 * | Path                                            | Purpose                                       |
 * | ----------------------------------------------- | --------------------------------------------- |
 * | `GET  /api/agency/whoami`                       | Resolve agency context for current user       |
 * | `GET  /api/agency/clients`                      | List child orgs the agency owns               |
 * | `POST /api/agency/clients`                      | Invite a new client (creates child org stub)  |
 * | `GET  /api/agency/brand`                        | Read brand overrides JSON                     |
 * | `PUT  /api/agency/brand`                        | Update brand overrides (logo, color, email)   |
 * | `POST /api/agency/upgrade`                      | Convert current org → agency (tier select)    |
 * | `GET  /api/agency/snapshots`                    | List clonable site snapshots                  |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import { requirePro } from '../services/pro.js';
import { unauthorized } from '@project-sites/shared';

const agency = new Hono<{ Bindings: Env; Variables: Variables }>();

agency.use('/api/agency/*', requirePro);

agency.get('/api/agency/whoami', async (c) => {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (!userId || !orgId) throw unauthorized();
  const org = await dbQueryOne<{
    id: string;
    name: string;
    is_agency: number;
    agency_tier: string | null;
    custom_admin_hostname: string | null;
    markup_pct: number;
    brand_overrides_json: string | null;
  }>(
    c.env.DB,
    `SELECT id, name, is_agency, agency_tier, custom_admin_hostname,
            markup_pct, brand_overrides_json
       FROM orgs WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [orgId],
  );
  return c.json({ org, user_id: userId });
});

agency.get('/api/agency/clients', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT o.id, o.name, o.slug, o.created_at,
            (SELECT COUNT(*) FROM sites s WHERE s.org_id = o.id AND s.deleted_at IS NULL) AS site_count
       FROM orgs o
       WHERE o.parent_org_id = ? AND o.deleted_at IS NULL
       ORDER BY o.created_at DESC`,
    [orgId],
  );
  return c.json({ clients: data });
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['client_owner', 'client_editor', 'client_viewer']).default('client_owner'),
  preselected_template_id: z.string().optional(),
});

agency.post('/api/agency/clients', zValidator('json', inviteSchema), async (c) => {
  const body = c.req.valid('json');
  const agencyOrgId = c.get('orgId');
  const userId = c.get('userId');
  if (!agencyOrgId || !userId) throw unauthorized();
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await dbInsert(c.env.DB, 'agency_invitations', {
    id,
    agency_org_id: agencyOrgId,
    client_email: body.email,
    role: body.role,
    preselected_template_id: body.preselected_template_id ?? null,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  // TODO: send invite email via Resend once template is ready.
  return c.json({ invitation_id: id, token, expires_at: expiresAt });
});

const brandSchema = z.object({
  logoUrl: z.string().url().optional(),
  faviconUrl: z.string().url().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  supportUrl: z.string().url().optional(),
  fromEmail: z.string().email().optional(),
  fromName: z.string().max(80).optional(),
  appName: z.string().max(60).optional(),
  hideBranding: z.boolean().optional(),
});

agency.get('/api/agency/brand', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const row = await dbQueryOne<{ brand_overrides_json: string | null }>(
    c.env.DB,
    'SELECT brand_overrides_json FROM orgs WHERE id = ? LIMIT 1',
    [orgId],
  );
  const brand = row?.brand_overrides_json ? JSON.parse(row.brand_overrides_json) : {};
  return c.json({ brand });
});

agency.put('/api/agency/brand', zValidator('json', brandSchema), async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const body = c.req.valid('json');
  const existing = await dbQueryOne<{ brand_overrides_json: string | null }>(
    c.env.DB,
    'SELECT brand_overrides_json FROM orgs WHERE id = ? LIMIT 1',
    [orgId],
  );
  const merged = { ...(existing?.brand_overrides_json ? JSON.parse(existing.brand_overrides_json) : {}), ...body };
  await dbUpdate(c.env.DB, 'orgs', { brand_overrides_json: JSON.stringify(merged) }, 'id = ?', [orgId]);
  // Invalidate brand KV cache for this org's hostnames.
  try {
    await c.env.CACHE_KV.delete(`brand:${orgId}`);
  } catch {
    /* cache best-effort */
  }
  return c.json({ brand: merged });
});

const upgradeSchema = z.object({
  tier: z.enum(['starter', 'pro', 'scale']),
  markup_pct: z.number().min(0).max(100).default(0),
});

agency.post('/api/agency/upgrade', zValidator('json', upgradeSchema), async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const body = c.req.valid('json');
  await dbUpdate(
    c.env.DB,
    'orgs',
    { is_agency: 1, agency_tier: body.tier, markup_pct: body.markup_pct },
    'id = ?',
    [orgId],
  );
  return c.json({ ok: true, tier: body.tier, markup_pct: body.markup_pct });
});

agency.get('/api/agency/snapshots', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, slug, name, category, install_count, price_cents
       FROM templates
       WHERE author_org_id = ? OR author_org_id IS NULL
       ORDER BY install_count DESC LIMIT 100`,
    [orgId],
  );
  return c.json({ snapshots: data });
});

async function sha256(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export { agency };
