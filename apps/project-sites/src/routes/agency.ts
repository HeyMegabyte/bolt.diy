/**
 * @module routes/agency
 * @description White-label / agency surface.
 *
 * Agencies sub-account their clients under one parent org. Pricing tier
 * gates max sub-accounts + agency-only features (branded admin, Stripe
 * Connect Express payouts, snapshot library).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate, dbExecute } from '../services/db.js';
import { requirePro } from '../services/pro.js';
import { notifySiteOwner } from '../services/notify.js';
import { unauthorized, internalError } from '@project-sites/shared';

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

/**
 * `GET /api/agency/invitations` — list the caller agency's PENDING invitations.
 *
 * Pro-gated + org-scoped. Returns only ACTIONABLE invites — unclaimed AND
 * unexpired. Never returns `token_hash` (the secret stays server-side).
 */
agency.get('/api/agency/invitations', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, client_email, role, preselected_template_id, expires_at, created_at
       FROM agency_invitations
       WHERE agency_org_id = ? AND claimed_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC`,
    [orgId, new Date().toISOString()],
  );
  return c.json({ invitations: data });
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['client_owner', 'client_editor', 'client_viewer']).default('client_owner'),
  preselected_template_id: z.string().optional(),
});

/**
 * `POST /api/agency/clients` — invite a new client (7-day token). Returns
 * `{ invitation_id, token, expires_at }`; the caller relays `token` to the
 * client, who redeems it at `POST /api/invitations/agency/accept`.
 */
agency.post('/api/agency/clients', zValidator('json', inviteSchema), async (c) => {
  const body = c.req.valid('json');
  const agencyOrgId = c.get('orgId');
  const userId = c.get('userId');
  if (!agencyOrgId || !userId) throw unauthorized();
  const token = crypto.randomUUID();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // One pending invite per (agency, email): a re-invite REFRESHES the existing
  // unclaimed row (new token + role + expiry) instead of minting a duplicate.
  // Critical now that accept creates an org — N duplicate tokens would each
  // redeem into their OWN child org. Claimed invites don't block a fresh one.
  const existing = await dbQueryOne<{ id: string }>(
    c.env.DB,
    `SELECT id FROM agency_invitations
       WHERE agency_org_id = ? AND client_email = ? AND claimed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    [agencyOrgId, body.email],
  );
  if (existing) {
    const { error: reinviteErr } = await dbUpdate(
      c.env.DB,
      'agency_invitations',
      {
        token_hash: tokenHash,
        role: body.role,
        preselected_template_id: body.preselected_template_id ?? null,
        expires_at: expiresAt,
      },
      'id = ?',
      [existing.id],
    );
    if (reinviteErr) throw internalError(`Failed to refresh invitation: ${reinviteErr}`);
    return c.json({ invitation_id: existing.id, token, expires_at: expiresAt });
  }

  const id = crypto.randomUUID();
  const { error: inviteErr } = await dbInsert(c.env.DB, 'agency_invitations', {
    id,
    agency_org_id: agencyOrgId,
    client_email: body.email,
    role: body.role,
    preselected_template_id: body.preselected_template_id ?? null,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (inviteErr) throw internalError(`Failed to create agency invitation: ${inviteErr}`);
  return c.json({ invitation_id: id, token, expires_at: expiresAt });
});

/**
 * `GET /api/invitations/agency/:token` — read-only preview of an invitation.
 *
 * Mounted OUTSIDE the `/api/agency/*` `requirePro` guard (the invitee is a client,
 * not Pro) and needs no session — the secret token IS the auth. Read-only, never
 * echoes the token back. `status` is `valid | expired | claimed`; only `valid`
 * can be redeemed at the accept route.
 */
agency.get('/api/invitations/agency/:token', async (c) => {
  const token = c.req.param('token');
  const tokenHash = await sha256(token);
  const invite = await dbQueryOne<{
    agency_org_id: string;
    role: string;
    expires_at: string;
    claimed_at: string | null;
  }>(
    c.env.DB,
    `SELECT agency_org_id, role, expires_at, claimed_at
       FROM agency_invitations WHERE token_hash = ?`,
    [tokenHash],
  );
  if (!invite) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Invitation not found.' } }, 404);
  }

  const status = invite.claimed_at
    ? 'claimed'
    : invite.expires_at <= new Date().toISOString()
      ? 'expired'
      : 'valid';
  const agencyOrg = await dbQueryOne<{ name: string }>(
    c.env.DB,
    `SELECT name FROM orgs WHERE id = ? AND deleted_at IS NULL`,
    [invite.agency_org_id],
  );

  return c.json({
    data: {
      status,
      valid: status === 'valid',
      role: invite.role,
      agency_name: agencyOrg?.name ?? null,
      expires_at: invite.expires_at,
    },
  });
});

/**
 * `DELETE /api/agency/clients/invitations/:id` — revoke a PENDING invitation.
 *
 * Pro-gated + org-scoped: an agency can revoke ONLY its own unclaimed
 * invitations. A claimed invite already created a child org (deleting the row
 * wouldn't undo that), so claimed/foreign/unknown ids all return 404 — the
 * `claimed_at IS NULL` + `agency_org_id` guards are the boundary.
 */
agency.delete('/api/agency/clients/invitations/:id', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const id = c.req.param('id');
  const { changes } = await dbExecute(
    c.env.DB,
    `DELETE FROM agency_invitations WHERE id = ? AND agency_org_id = ? AND claimed_at IS NULL`,
    [id, orgId],
  );
  if (changes === 0) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'No pending invitation to revoke.' } },
      404,
    );
  }
  return c.json({ data: { revoked: true, invitation_id: id } });
});

/**
 * Map an agency-invitation role to the constrained `memberships.role` enum.
 *
 * Invitation roles (`client_owner|client_editor|client_viewer`) are NOT valid
 * `memberships.role` values — that column has `CHECK (role IN
 * ('owner','admin','member','viewer'))`, so a `client_*` value would 500 the
 * INSERT. Single mapping point: owner→owner, editor→member, viewer→viewer;
 * any unknown role falls back to least-privilege `viewer`.
 *
 * @param inviteRole - The `agency_invitations.role` value.
 * @returns A membership role that satisfies the CHECK constraint.
 */
export function membershipRoleForInvite(inviteRole: string): 'owner' | 'member' | 'viewer' {
  if (inviteRole === 'client_owner') return 'owner';
  if (inviteRole === 'client_editor') return 'member';
  return 'viewer';
}

const acceptSchema = z.object({ token: z.string().min(1).max(200) });

/**
 * `POST /api/invitations/agency/accept` — redeem an agency client invitation.
 *
 * Mounted OUTSIDE the `/api/agency/*` `requirePro` guard on purpose: the invitee
 * is a CLIENT, not a Pro agency, so requiring Pro would make every invite
 * un-acceptable. The bearer of the secret `token` (+ a signed-in user) is the
 * auth. Flow is claim-then-create — the `claimed_at IS NULL` UPDATE is the lock,
 * so a concurrent or replayed accept sees `changes:0` and is rejected (no
 * duplicate child org). On success: a child org (`parent_org_id = agency_org_id`)
 * + the caller's membership with the {@link membershipRoleForInvite} role.
 */
agency.post('/api/invitations/agency/accept', zValidator('json', acceptSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) throw unauthorized();
  const { token } = c.req.valid('json');
  const tokenHash = await sha256(token);
  const nowIso = new Date().toISOString();

  // Claim-then-create: this UPDATE is the lock. Only the request that flips
  // claimed_at from NULL proceeds; a race/replay sees changes:0 → 404, so the
  // child org is created at most once per invitation.
  const claim = await c.env.DB.prepare(
    `UPDATE agency_invitations SET claimed_at = ?, claimed_by_user_id = ?
       WHERE token_hash = ? AND claimed_at IS NULL AND expires_at > ?`,
  )
    .bind(nowIso, userId, tokenHash, nowIso)
    .run();
  if ((claim.meta?.changes ?? 0) === 0) {
    // Unknown / expired / already-claimed — don't leak which.
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'This invitation is invalid, expired, or already claimed.',
        },
      },
      404,
    );
  }

  const invite = await dbQueryOne<{
    agency_org_id: string;
    role: string;
    client_email: string;
    preselected_template_id: string | null;
  }>(
    c.env.DB,
    `SELECT agency_org_id, role, client_email, preselected_template_id
       FROM agency_invitations WHERE token_hash = ?`,
    [tokenHash],
  );
  if (!invite) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Invitation not found.' } }, 404);
  }

  const childOrgId = crypto.randomUUID();
  const slugBase =
    (invite.client_email.split('@')[0] ?? 'client')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'client';
  const slug = `${slugBase}-${crypto.randomUUID().slice(0, 6)}`;
  const role = membershipRoleForInvite(invite.role);

  const { error: orgErr } = await dbInsert(c.env.DB, 'orgs', {
    id: childOrgId,
    name: invite.client_email,
    slug,
    parent_org_id: invite.agency_org_id,
    deleted_at: null,
  });
  if (orgErr) throw internalError(`Failed to create client org: ${orgErr}`);
  const { error: memErr } = await dbInsert(c.env.DB, 'memberships', {
    id: crypto.randomUUID(),
    org_id: childOrgId,
    user_id: userId,
    role,
    billing_admin: role === 'owner' ? 1 : 0,
    deleted_at: null,
  });
  if (memErr) throw internalError(`Failed to create client membership: ${memErr}`);

  // Tell the agency owner their client accepted. Fire-and-forget — notifySiteOwner
  // never throws; waitUntil'd so it never delays the 200.
  const notify = notifySiteOwner(c.env, c.env.DB, {
    orgId: invite.agency_org_id,
    subject: 'A client accepted your invitation',
    body: `${invite.client_email} joined as ${role} and now has a workspace under your agency.`,
  });
  try {
    c.executionCtx.waitUntil(notify);
  } catch {
    void notify;
  }

  return c.json(
    {
      data: {
        org_id: childOrgId,
        slug,
        role,
        ...(invite.preselected_template_id
          ? { preselected_template_id: invite.preselected_template_id }
          : {}),
      },
    },
    200,
  );
});

const brandSchema = z.object({
  logoUrl: z.string().url().optional(),
  faviconUrl: z.string().url().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
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
  // Corrupt STORED brand JSON is server-side data corruption → 500, not 400.
  // Parse explicitly here so it doesn't fall through to the shared error
  // handler's malformed-request-body net (which maps JSON SyntaxError → 400,
  // correct for client input but wrong for our own stored data).
  let brand: unknown = {};
  if (row?.brand_overrides_json) {
    try {
      brand = JSON.parse(row.brand_overrides_json);
    } catch (err) {
      throw internalError(
        'Stored brand overrides are corrupt',
        err instanceof Error ? err : undefined,
      );
    }
  }
  return c.json({ brand });
});

/**
 * `PUT /api/agency/brand` — update white-label brand overrides.
 *
 * Body {@link brandSchema} is MERGED onto existing JSON. Invalidates KV cache
 * key `brand:{orgId}` so the agency's hostnames pick up the new brand.
 */
agency.put('/api/agency/brand', zValidator('json', brandSchema), async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const body = c.req.valid('json');
  const existing = await dbQueryOne<{ brand_overrides_json: string | null }>(
    c.env.DB,
    'SELECT brand_overrides_json FROM orgs WHERE id = ? LIMIT 1',
    [orgId],
  );
  const merged = {
    ...(existing?.brand_overrides_json ? JSON.parse(existing.brand_overrides_json) : {}),
    ...body,
  };
  const { error: brandErr } = await dbUpdate(
    c.env.DB,
    'orgs',
    { brand_overrides_json: JSON.stringify(merged) },
    'id = ?',
    [orgId],
  );
  if (brandErr) throw internalError(`Failed to save brand overrides: ${brandErr}`);
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

/**
 * `POST /api/agency/upgrade` — convert the caller's org into an agency.
 *
 * Idempotent — re-running just updates tier/markup. Does NOT charge; pricing
 * is handled separately via Stripe checkout.
 */
agency.post('/api/agency/upgrade', zValidator('json', upgradeSchema), async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const body = c.req.valid('json');
  const { error: upgradeErr } = await dbUpdate(
    c.env.DB,
    'orgs',
    { is_agency: 1, agency_tier: body.tier, markup_pct: body.markup_pct },
    'id = ?',
    [orgId],
  );
  // Entitlement change — never report "upgraded" if the org wasn't actually flipped.
  if (upgradeErr) throw internalError(`Failed to upgrade to agency: ${upgradeErr}`);
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
