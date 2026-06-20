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
import { dbQuery, dbQueryOne, dbInsert, dbUpdate, dbExecute } from '../services/db.js';
import { requirePro } from '../services/pro.js';
import { notifySiteOwner } from '../services/notify.js';
import { unauthorized } from '@project-sites/shared';

const agency = new Hono<{ Bindings: Env; Variables: Variables }>();

agency.use('/api/agency/*', requirePro);

/**
 * `GET /api/agency/whoami` — Resolve the agency org context for the
 * current user (tier, custom admin hostname, markup, brand overrides).
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
 */
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

/**
 * `GET /api/agency/clients` — List the child orgs owned by the agency
 * (caller's org) with site counts.
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
 */
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

/**
 * `POST /api/agency/clients` — Invite a new client (creates a child-org
 * invitation token with 7-day expiry).
 *
 * @remarks
 * Body: {@link inviteSchema}. Returns `{ invitation_id, token, expires_at }`.
 *
 * @remarks
 * The caller (agency) relays the returned `token` to the client; the client
 * redeems it at `POST /api/invitations/agency/accept` (see below) which creates
 * their child org + membership. Wiring an invite EMAIL here (via `sendEmail` /
 * Novu, never a new Resend call) is the remaining enhancement.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
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
    await dbUpdate(
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
    // Email delivery (sendEmail/Novu) is the remaining enhancement.
    return c.json({ invitation_id: existing.id, token, expires_at: expiresAt });
  }

  const id = crypto.randomUUID();
  await dbInsert(c.env.DB, 'agency_invitations', {
    id,
    agency_org_id: agencyOrgId,
    client_email: body.email,
    role: body.role,
    preselected_template_id: body.preselected_template_id ?? null,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  // Email delivery (sendEmail/Novu) is the remaining enhancement — the caller
  // relays the token meanwhile; the client redeems at the accept route below.
  return c.json({ invitation_id: id, token, expires_at: expiresAt });
});

/**
 * `GET /api/invitations/agency/:token` — Read-only preview of an agency client
 * invitation by its raw token (the link a client clicks before signing in).
 *
 * @remarks
 * Mounted OUTSIDE the `/api/agency/*` `requirePro` guard (the invitee is a client,
 * not Pro) and needs no session — the secret token IS the auth. Returns just
 * enough to render an accept screen (agency name, role, validity) WITHOUT
 * mutating anything. `status` is `valid | expired | claimed`; only `valid`
 * invitations can be redeemed at the accept route. Never echoes the token back.
 *
 * @throws 404 NOT_FOUND when no invitation matches the token.
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
 * `DELETE /api/agency/clients/invitations/:id` — Revoke a PENDING invitation.
 *
 * @remarks
 * Pro-gated (under `/api/agency/*`) + org-scoped: an agency can revoke ONLY its
 * own unclaimed invitations. A claimed invite already created a child org —
 * deleting the row wouldn't undo that — so claimed/foreign/unknown ids all return
 * 404 (the `claimed_at IS NULL` + `agency_org_id` guards are the boundary).
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 404 NOT_FOUND when there is no pending invitation with that id to revoke.
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
 * @remarks
 * Invitation roles (`client_owner|client_editor|client_viewer`) are NOT valid
 * `memberships.role` values — that column has `CHECK (role IN
 * ('owner','admin','member','viewer'))`, so a `client_*` value would 500 the
 * INSERT. This is the single mapping point: owner→owner, editor→member (standard
 * non-admin write role), viewer→viewer. Any unknown role falls back to the
 * least-privilege `viewer`.
 *
 * @param inviteRole - The `agency_invitations.role` value.
 * @returns A membership role that satisfies the CHECK constraint.
 * @example membershipRoleForInvite('client_editor') // 'member'
 */
export function membershipRoleForInvite(inviteRole: string): 'owner' | 'member' | 'viewer' {
  if (inviteRole === 'client_owner') return 'owner';
  if (inviteRole === 'client_editor') return 'member';
  return 'viewer';
}

const acceptSchema = z.object({ token: z.string().min(1).max(200) });

/**
 * `POST /api/invitations/agency/accept` — Redeem an agency client invitation.
 *
 * @remarks
 * Mounted OUTSIDE the `/api/agency/*` `requirePro` guard on purpose: the invitee
 * is a CLIENT, not a Pro agency, so requiring Pro would make every invite
 * un-acceptable. The bearer of the secret `token` (+ a signed-in user) is the
 * auth. Flow is claim-then-create — the `claimed_at IS NULL` UPDATE is the lock,
 * so a concurrent or replayed accept sees `changes:0` and is rejected (no
 * duplicate child org). On success: a child org (`parent_org_id = agency_org_id`)
 * + the caller's membership with the {@link membershipRoleForInvite} role.
 *
 * Body: `{ token }`. Returns `{ data: { org_id, slug, role, preselected_template_id? } }`.
 *
 * @throws 401 UNAUTHORIZED when no user is signed in.
 * @throws 404 NOT_FOUND when the token is unknown, expired, or already claimed.
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

  await dbInsert(c.env.DB, 'orgs', {
    id: childOrgId,
    name: invite.client_email,
    slug,
    parent_org_id: invite.agency_org_id,
    deleted_at: null,
  });
  await dbInsert(c.env.DB, 'memberships', {
    id: crypto.randomUUID(),
    org_id: childOrgId,
    user_id: userId,
    role,
    billing_admin: role === 'owner' ? 1 : 0,
    deleted_at: null,
  });

  // Close the feedback loop: tell the agency owner their client accepted. Fire-
  // and-forget — notifySiteOwner never throws; waitUntil'd so it never delays the
  // 200. Resolves the agency org's owner email + triggers the Novu bell/channels.
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

/**
 * `GET /api/agency/brand` — Read white-label brand overrides JSON for
 * the caller's agency org.
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
 */
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

/**
 * `PUT /api/agency/brand` — Update white-label brand overrides (logo,
 * favicon, palette, sender email, hide-branding toggle).
 *
 * @remarks
 * Body: {@link brandSchema} — merged onto existing JSON. Invalidates the
 * KV cache key `brand:{orgId}` so the next request to the agency's
 * hostnames picks up the new brand.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
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
  await dbUpdate(c.env.DB, 'orgs', { brand_overrides_json: JSON.stringify(merged) }, 'id = ?', [
    orgId,
  ]);
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

/**
 * `POST /api/agency/upgrade` — Convert the caller's org into an agency
 * with the selected tier + markup percentage.
 *
 * @remarks
 * Body: {@link upgradeSchema}. Idempotent — re-running just updates the
 * tier/markup. Does NOT charge anything; pricing is handled separately
 * via Stripe checkout.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
 */
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

/**
 * `GET /api/agency/snapshots` — List clonable site snapshots (templates)
 * available to the agency — both its own and global public templates.
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
 */
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
