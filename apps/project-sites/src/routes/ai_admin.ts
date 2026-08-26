/**
 * @module routes/ai_admin
 * @description Authenticated admin surface for the AI platform.
 *
 * Mounted by `index.ts`. Every route requires both an `orgId` and a
 * `userId` on the request context — the {@link need} helper throws
 * `HTTPError(401)` when either is missing. Public counterparts (form
 * ingest, `/api/ai/:slug/:endpoint`) live in `forms.ts` +
 * `ai_endpoints_public.ts`.
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import {
  HTTPError,
  need,
  siteOwned,
  safeJson,
  aiAdminOnError,
  type Ctx,
} from '../lib/ai_admin_kit.js';
import { listUserSessions, revokeUserSession, revokeOtherUserSessions } from '../services/auth.js';
import {
  transferOwnership,
  canInviteMember,
  countSeatUsage,
  resolveSeatLimit,
} from '../services/team_seats.js';
import { getOrgEntitlements } from '../services/billing.js';
import { allProviders } from '../services/mcp_client.js';
import { forecastCost } from '../services/ai_admin_features.js';
import * as auditService from '../services/audit.js';
import { escapeHtml } from '@project-sites/shared';
import { getEmailProvider } from '../platform/email-router.js';

export const aiAdmin = new Hono<{ Bindings: Env; Variables: Variables }>();

// Error/auth scaffolding (HTTPError · need · siteOwned · safeJson · onError) is
// shared via src/lib/ai_admin_kit.ts — imported above (route-decomposition
// installment 17, DRY consolidation). Byte-identical behavior to the prior
// inline copies; see the kit module doc for the siteOwned-vs-requireOwnedSite
// rationale.
aiAdmin.onError(aiAdminOnError);

/* ────────────────────────── Form Submissions + AI Logs ────────────────────────── */

/**
 * `GET /api/sites/:siteId/form-submissions` — List up to 200 most recent form
 * submissions for the requested site.
 *
 * @remarks
 * Requires org membership of the site's owning org. Returns each submission
 * with `fields` parsed from the stored JSON payload.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 *
 * @see {@link aiAdmin.get('/api/sites/:siteId/form-submissions/:subId')}
 */
aiAdmin.get('/api/sites/:siteId/form-submissions', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200), 1), 500);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
  const rows = await c.env.DB.prepare(
    `SELECT id, form_name, email, payload, status, ip_address, origin_url, created_at
     FROM form_submissions WHERE site_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(siteId, limit, offset)
    .all<Record<string, unknown>>();
  // True count so a business owner can reach EVERY lead (offset-page) and the
  // count pill shows the real total — a hardcoded LIMIT with no total silently
  // hides leads (= revenue) past the cap once a site gets popular.
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM form_submissions WHERE site_id = ?`,
  )
    .bind(siteId)
    .first<{ n: number }>();
  const data = (rows.results ?? []).map((r) => ({
    ...r,
    fields: safeJson(r['payload'] as string),
  }));
  const total = Number(countRow?.n ?? data.length);
  return c.json({
    data,
    meta: { limit, offset, total, has_more: offset + data.length < total },
  });
});

/**
 * `GET /api/sites/:siteId/form-submissions/:subId` — Fetch a single form
 * submission by id with parsed `fields`.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 * @throws 404 NOT_FOUND when the submission doesn't exist on that site.
 */
aiAdmin.get('/api/sites/:siteId/form-submissions/:subId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const sub = await c.env.DB.prepare(
    `SELECT id, form_name, email, payload, status, ip_address, origin_url, user_agent, created_at
     FROM form_submissions WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('subId'), siteId)
    .first<Record<string, unknown>>();
  if (!sub) throw new HTTPError(404, 'Submission not found');
  const logs = await c.env.DB.prepare(
    `SELECT * FROM ai_form_logs WHERE submission_id = ? ORDER BY created_at DESC`,
  )
    .bind(c.req.param('subId'))
    .all();
  return c.json({
    data: {
      submission: { ...sub, fields: safeJson(sub['payload'] as string) },
      ai_logs: logs.results ?? [],
    },
  });
});

/**
 * `GET /api/sites/:siteId/ai-logs?kind=&limit=` — List recent AI trace rows
 * for a site (LLM calls, tool calls, router decisions).
 *
 * @remarks
 * `kind` optionally filters by `trace_kind` (`router`, `chat`, `endpoint`,
 * etc.); `limit` is clamped to 1000 and defaults to 200. Each row is a
 * lightweight summary with `output_preview` truncated to 200 chars.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 *
 * @see {@link aiAdmin.get('/api/sites/:siteId/ai-logs/:logId')}
 */
aiAdmin.get('/api/sites/:siteId/ai-logs', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const kind = c.req.query('kind');
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 1000);
  const stmt = kind
    ? c.env.DB.prepare(
        `SELECT id, submission_id, trace_kind, endpoint_slug, model, status, latency_ms,
                tokens_input, tokens_output, credits_debited, tool_name, tool_status,
                substr(output_text, 1, 200) AS output_preview, error_message, created_at
         FROM ai_form_logs WHERE site_id = ? AND trace_kind = ?
         ORDER BY created_at DESC LIMIT ?`,
      ).bind(siteId, kind, limit)
    : c.env.DB.prepare(
        `SELECT id, submission_id, trace_kind, endpoint_slug, model, status, latency_ms,
                tokens_input, tokens_output, credits_debited, tool_name, tool_status,
                substr(output_text, 1, 200) AS output_preview, error_message, created_at
         FROM ai_form_logs WHERE site_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      ).bind(siteId, limit);
  const rows = await stmt.all();
  const list = rows.results ?? [];
  // TRUE count (respecting the same `kind` filter) so the admin "Calls" stat can't
  // under-report once a site's AI traces exceed the page cap — mirrors
  // form-submissions + /logs + audit-logs. A hardcoded LIMIT with no total silently
  // hides calls (cost/debugging signal) on any active AI site.
  const countStmt = kind
    ? c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ai_form_logs WHERE site_id = ? AND trace_kind = ?`,
      ).bind(siteId, kind)
    : c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ai_form_logs WHERE site_id = ?`).bind(siteId);
  const countRow = await countStmt.first<{ n: number }>();
  const total = Number(countRow?.n ?? list.length);
  return c.json({ data: list, meta: { limit, total, has_more: list.length < total } });
});

/**
 * `GET /api/sites/:siteId/ai-logs/:logId` — Fetch a single AI trace row
 * including full input/output text and timing breakdown.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 * @throws 404 NOT_FOUND when the log row doesn't exist on that site.
 */
aiAdmin.get('/api/sites/:siteId/ai-logs/:logId', async (c) => {
  const { orgId } = need(c);
  await siteOwned(c, orgId, c.req.param('siteId'));
  const row = await c.env.DB.prepare(`SELECT * FROM ai_form_logs WHERE id = ? AND site_id = ?`)
    .bind(c.req.param('logId'), c.req.param('siteId'))
    .first();
  if (!row) throw new HTTPError(404, 'Log not found');
  return c.json({ data: row });
});

// Per-site AI settings (GET/PUT /api/sites/:siteId/ai-settings) + the
// "Improve with AI" rewrite (POST …/ai-settings/improve) + the per-site AI
// credit cap (GET/PUT /api/sites/:siteId/credit-cap) moved to
// `libs/features/ai_settings/handlers.ts` (route-decomposition installment 18).

// AI credit balance/top-up + per-site cost rollup moved to
// `libs/features/billing/handlers.ts` (route-decomposition installment 14):
//   GET  /api/billing/credits, POST /api/billing/credits/topup, GET /api/billing/site-costs.
// The canonical spend-alerts surface lives in `libs/features/billing/handlers.ts`
// (behind `createSpendAlertSchema` + the migration-0024 `spend_alerts` schema).

/* ────────────────────────── MCP connections (list + disconnect) ────────────────────────── */

/**
 * `GET /api/sites/:siteId/mcp/connections` — List MCP (Model Context
 * Protocol) provider connections for a site.
 *
 * @remarks
 * Returns one row per provider (Mailchimp, Stripe, HubSpot, GitHub, …) with
 * connection status + last-sync timestamp. Never returns access tokens.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 */
aiAdmin.get('/api/sites/:siteId/mcp/connections', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, provider, display_name, status, scopes_json, account_metadata_json, connected_at
     FROM mcp_connections WHERE site_id = ? AND status = 'active'`,
  )
    .bind(siteId)
    .all();
  return c.json({
    data: {
      providers: allProviders(),
      connections: (rows.results ?? []).map((r) => ({
        ...r,
        metadata: safeJson(r['account_metadata_json'] as string | null),
      })),
    },
  });
});

/**
 * `DELETE /api/sites/:siteId/mcp/connections/:id` — Revoke an MCP provider
 * connection and clear its encrypted tokens.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 * @throws 404 NOT_FOUND when the connection id doesn't exist on that site.
 */
aiAdmin.delete('/api/sites/:siteId/mcp/connections/:id', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const connectionId = c.req.param('id');
  const connection = await c.env.DB.prepare(
    `SELECT provider FROM mcp_connections WHERE id = ? AND site_id = ?`,
  )
    .bind(connectionId, siteId)
    .first<{ provider: string }>();
  await c.env.DB.prepare(
    `UPDATE mcp_connections SET status = 'revoked', updated_at = datetime('now') WHERE id = ? AND site_id = ?`,
  )
    .bind(connectionId, siteId)
    .run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'mcp.disconnected',
      message: `MCP '${connection?.provider ?? 'unknown'}' disconnected from site '${siteId}'`,
      target_type: 'mcp_connection',
      target_id: connectionId,
      metadata_json: { site_id: siteId, provider: connection?.provider ?? null },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({ data: { revoked: true } });
});

/* ────────────────────────── Team (Settings → Team) ────────────────────────── */

/**
 * `GET /api/team` — List active members + pending invites for the caller's org.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
aiAdmin.get('/api/team', async (c) => {
  const { orgId } = need(c);
  const members = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.display_name AS name, m.role, m.created_at
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ? AND m.deleted_at IS NULL ORDER BY m.created_at ASC`,
  )
    .bind(orgId)
    .all();
  const invites = await c.env.DB.prepare(
    `SELECT id, email, role, created_at, expires_at FROM team_invites
     WHERE org_id = ? AND accepted_at IS NULL AND deleted_at IS NULL ORDER BY created_at DESC`,
  )
    .bind(orgId)
    .all();
  return c.json({ data: { members: members.results ?? [], invites: invites.results ?? [] } });
});

/**
 * `POST /api/team/invites` — Invite a new member to the caller's org.
 *
 * @remarks
 * Body: `{ email, role }`. Generates a one-shot invite token and sends a
 * magic-link email via Resend. Audit-logged. Idempotent on `(org, email)`
 * — re-invites refresh the token rather than creating duplicates.
 *
 * @throws 400 BAD_REQUEST when email is invalid or role is unknown.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 409 CONFLICT when the email already belongs to the org.
 */
aiAdmin.post('/api/team/invites', async (c) => {
  const { orgId, userId } = need(c);
  // Zod boundary (zod-everywhere): `role` is privilege-bearing — the old cast
  // let ANY string land in `team_invites.role` (e.g. an injected 'superadmin'),
  // and a malformed JSON body threw an unhandled 500. Constrain role to the real
  // enum + require a non-empty email; every failure → the same 400.
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPError(400, 'email + role required');
  }
  const parsed = z
    .object({ email: z.string().min(1), role: z.enum(['owner', 'editor', 'viewer']) })
    .safeParse(raw);
  if (!parsed.success) throw new HTTPError(400, 'email + role required');
  const { email, role } = parsed.data;

  // Seat-cap enforcement (#8): active members + pending invites both consume a
  // seat. The limit is resolved from the org's plan entitlements (free=1,
  // paid=10, -1=unlimited) — not a new table or flag. 409 + reason when full.
  const seatLimit = resolveSeatLimit(await getOrgEntitlements(c.env.DB, orgId));
  const decision = canInviteMember(await countSeatUsage(c.env, orgId), seatLimit);
  if (!decision.allowed) throw new HTTPError(409, decision.reason ?? 'Seat limit reached');

  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replace(/-/g, '');
  const tokenHash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const expires = new Date(Date.now() + 14 * 86400 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO team_invites (id, org_id, email, role, token_hash, invited_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, orgId, email, role, tokenHash, userId, expires)
    .run();
  // Invites route through SES when configured, else Resend fallback. The SES
  // seam is html-only, so the plain-text invite is wrapped in an escaped <pre>.
  // Fire-and-forget — the invite row is already persisted.
  const inviteSubject = 'You’ve been invited to a Project Sites team';
  const inviteText = `You were invited as ${role}. Accept here: https://projectsites.dev/admin/accept-invite?token=${token}`;
  if (c.env.AWS_ACCESS_KEY_ID && c.env.AWS_SECRET_ACCESS_KEY && c.env.SES_FROM_EMAIL) {
    await getEmailProvider(c.env)
      .sendTransactional({
        kind: 'transactional',
        from: 'team@projectsites.dev',
        to: email,
        subject: inviteSubject,
        html: `<pre>${escapeHtml(inviteText)}</pre>`,
      })
      .catch(() => {});
  } else if (c.env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'team@projectsites.dev',
        to: [email],
        subject: inviteSubject,
        text: inviteText,
      }),
    }).catch(() => {});
  }

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'team.invite_sent',
      message: `Team invite sent to '${email}' as '${role}'`,
      target_type: 'team_invite',
      target_id: id,
      metadata_json: { email, role, expires_at: expires },
      request_id: c.get('requestId'),
    }),
  );

  // Typed in-app bell event for the org owner (best-effort, never blocks).
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const { notifyOwnerEvent } = await import('../services/notify.js');
        await notifyOwnerEvent(c.env, c.env.DB, {
          orgId,
          event: { event: 'member.invited', tenantId: orgId, email, role },
        });
      } catch {
        /* bell is best-effort */
      }
    })(),
  );

  return c.json({ data: { id, token } }, 201);
});

/**
 * `POST /api/team/transfer-ownership` — Hand org ownership to an existing member.
 *
 * @remarks
 * Body: `{ targetUserId }`. Only the current owner may transfer, and only to an
 * existing team member; the old owner steps down to `admin`. Org-scoped +
 * audit-logged. Adopts the {@link transferOwnership} policy (#8).
 *
 * @throws 400 BAD_REQUEST when targetUserId is missing or the transfer is not allowed.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
aiAdmin.post('/api/team/transfer-ownership', async (c) => {
  const { orgId, userId } = need(c);
  const { targetUserId } = (await c.req.json().catch(() => ({}))) as { targetUserId?: string };
  if (!targetUserId) throw new HTTPError(400, 'targetUserId required');

  const res = await transferOwnership(c.env, orgId, userId, targetUserId);
  if (!res.ok) throw new HTTPError(400, res.error ?? 'Ownership transfer failed');

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'team.ownership_transferred',
      message: `Ownership transferred from '${userId}' to '${targetUserId}'`,
      target_type: 'membership',
      target_id: targetUserId,
      metadata_json: { from: userId, to: targetUserId },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({ ok: true });
});

/**
 * `DELETE /api/team/invites/:id` — Cancel a pending team invite.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the invite id doesn't exist for the caller's org.
 */
aiAdmin.delete('/api/team/invites/:id', async (c) => {
  const { orgId } = need(c);
  const inviteId = c.req.param('id');
  const invite = await c.env.DB.prepare(
    `SELECT email, role FROM team_invites WHERE id = ? AND org_id = ?`,
  )
    .bind(inviteId, orgId)
    .first<{ email: string; role: string }>();
  await c.env.DB.prepare(`DELETE FROM team_invites WHERE id = ? AND org_id = ?`)
    .bind(inviteId, orgId)
    .run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'team.invite_revoked',
      message: `Team invite revoked for '${invite?.email ?? 'unknown'}' (${invite?.role ?? 'unknown role'})`,
      target_type: 'team_invite',
      target_id: inviteId,
      metadata_json: { email: invite?.email ?? null, role: invite?.role ?? null },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({ data: { revoked: true } });
});

/**
 * `DELETE /api/team/members/:userId` — Remove a member from the caller's org.
 *
 * @remarks
 * Soft-deletes the `memberships` row. The user keeps their account but
 * loses access to org resources. Audit-logged. The org's last admin
 * cannot be removed.
 *
 * @throws 400 BAD_REQUEST when removing the last admin.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the userId isn't a current member.
 */
aiAdmin.delete('/api/team/members/:userId', async (c) => {
  const { orgId } = need(c);
  const targetUserId = c.req.param('userId');
  // Last-owner guard — every org must keep at least one owner. Refuse the
  // delete if removing this member would leave zero owners. Mirrors the
  // client-side disabled state on the Settings → Team list.
  const target = await c.env.DB.prepare(
    `SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND deleted_at IS NULL`,
  )
    .bind(targetUserId, orgId)
    .first<{ role: string }>();
  if (target?.role === 'owner') {
    const ownerCount = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner' AND deleted_at IS NULL`,
    )
      .bind(orgId)
      .first<{ n: number }>();
    if ((ownerCount?.n ?? 0) <= 1) {
      throw new HTTPError(
        409,
        'Cannot remove the last owner. Promote another member to owner first.',
      );
    }
  }
  await c.env.DB.prepare(`DELETE FROM memberships WHERE user_id = ? AND org_id = ?`)
    .bind(targetUserId, orgId)
    .run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'team.member_removed',
      message: `Team member '${targetUserId}' removed from org`,
      target_type: 'membership',
      target_id: targetUserId,
      metadata_json: { user_id: targetUserId, prior_role: target?.role ?? null },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({ data: { removed: true } });
});

// Analytics + audit-feed routes moved to their own feature modules
// (route-decomposition installment 14):
//   POST /api/analytics/track + GET /api/analytics/overview → libs/features/analytics/handlers.ts
//   GET  /api/audit/rows                                    → libs/features/audit_logs/handlers.ts

/* ────────────────────────── Team invite acceptance ────────────────────────── */
// Email link is /admin/accept-invite?token=…; the frontend POSTs back here.
// We rehash the raw token, find the pending invite row, ensure the caller's
// user matches the invite email, then insert a membership.
/**
 * `POST /api/team/invites/accept` — Accept a pending team invite via token.
 *
 * @remarks
 * Body: `{ token }`. Creates a membership row joining the caller (the
 * authenticated session user) into the invited org with the role set on
 * the invite. One-shot — the invite token is consumed regardless of
 * outcome.
 *
 * @throws 400 BAD_REQUEST when the token is missing, expired or already used.
 * @throws 401 UNAUTHORIZED when the caller isn't signed in.
 */
aiAdmin.post('/api/team/invites/accept', async (c) => {
  const { userId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  const raw = (body.token ?? '').trim();
  if (!raw) return c.json({ error: { code: 'BAD_REQUEST', message: 'token required' } }, 400);
  const hashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const tokenHash = Array.from(new Uint8Array(hashBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const invite = await c.env.DB.prepare(
    `SELECT id, org_id, email, role, expires_at FROM team_invites
     WHERE token_hash = ? AND accepted_at IS NULL AND deleted_at IS NULL`,
  )
    .bind(tokenHash)
    .first<{ id: string; org_id: string; email: string; role: string; expires_at: string }>();
  if (!invite)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Invite not found or already used' } },
      404,
    );
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return c.json(
      { error: { code: 'EXPIRED', message: 'Invite expired — ask the owner to resend' } },
      410,
    );
  }
  const me = await c.env.DB.prepare(`SELECT email FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ email: string }>();
  if (me?.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return c.json(
      {
        error: {
          code: 'WRONG_USER',
          message: `This invite was sent to ${invite.email}; sign in as that account first.`,
        },
      },
      403,
    );
  }
  // Insert membership (ignore conflict if user already in org).
  await c.env.DB.prepare(
    `INSERT INTO memberships (id, org_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role, deleted_at = NULL`,
  )
    .bind(crypto.randomUUID(), invite.org_id, userId, invite.role)
    .run();
  await c.env.DB.prepare(`UPDATE team_invites SET accepted_at = datetime('now') WHERE id = ?`)
    .bind(invite.id)
    .run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: invite.org_id,
      actor_id: userId,
      action: 'team.invite_accepted',
      message: `Team invite accepted by '${invite.email}' — joined as '${invite.role}'`,
      target_type: 'membership',
      target_id: userId,
      metadata_json: { invite_id: invite.id, email: invite.email, role: invite.role },
      request_id: c.get('requestId'),
    }),
  );

  // Typed in-app bell event — tell the org owner a teammate joined (best-effort).
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const { notifyOwnerEvent } = await import('../services/notify.js');
        await notifyOwnerEvent(c.env, c.env.DB, {
          orgId: invite.org_id,
          event: { event: 'member.joined', tenantId: invite.org_id, userId, role: invite.role },
        });
      } catch {
        /* bell is best-effort */
      }
    })(),
  );

  return c.json({ data: { joined: true, org_id: invite.org_id, role: invite.role } });
});

/* ────────────────────────── Org security defaults ────────────────────────── */
aiAdmin.get('/api/admin/security', async (c) => {
  const { orgId } = need(c);
  const row = await c.env.DB.prepare(
    `SELECT session_hours, idle_minutes, allowed_domains, require_2fa, updated_at
     FROM org_security WHERE org_id = ?`,
  )
    .bind(orgId)
    .first();
  return c.json({
    data: row ?? {
      session_hours: 168,
      idle_minutes: 60,
      allowed_domains: null,
      require_2fa: 0,
      updated_at: null,
    },
  });
});
/**
 * `PUT /api/admin/security` — Update the caller org's security settings
 * (SSO enforcement, IP allowlist, session TTL).
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the caller isn't an org admin.
 */
aiAdmin.put('/api/admin/security', async (c) => {
  const { orgId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    session_hours?: number;
    idle_minutes?: number;
    allowed_domains?: string | null;
    require_2fa?: boolean;
  };
  const sessionHours = Math.max(1, Math.min(720, Number(body.session_hours) || 168));
  const idleMinutes = Math.max(5, Math.min(240, Number(body.idle_minutes) || 60));
  const allowed = (body.allowed_domains ?? '').trim() || null;
  const require2fa = body.require_2fa ? 1 : 0;
  await c.env.DB.prepare(
    `INSERT INTO org_security (org_id, session_hours, idle_minutes, allowed_domains, require_2fa, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(org_id) DO UPDATE SET
       session_hours = excluded.session_hours,
       idle_minutes = excluded.idle_minutes,
       allowed_domains = excluded.allowed_domains,
       require_2fa = excluded.require_2fa,
       updated_at = excluded.updated_at`,
  )
    .bind(orgId, sessionHours, idleMinutes, allowed, require2fa)
    .run();
  return c.json({
    data: {
      saved: true,
      session_hours: sessionHours,
      idle_minutes: idleMinutes,
      allowed_domains: allowed,
      require_2fa: require2fa,
    },
  });
});

// "Improve with AI" (POST /api/sites/:siteId/ai-settings/improve) moved to
// `libs/features/ai_settings/handlers.ts` (route-decomposition installment 18).

/* ────────────────────────── Org deletion (real, soft + scheduled purge) ────────────────────────── */
aiAdmin.post('/api/admin/org/delete', async (c) => {
  const { orgId, userId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== 'DELETE') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Confirmation text must be "DELETE"' } },
      400,
    );
  }
  const me = await c.env.DB.prepare(
    `SELECT role FROM memberships WHERE org_id = ? AND user_id = ? AND deleted_at IS NULL`,
  )
    .bind(orgId, userId)
    .first<{ role: string }>();
  if (me?.role !== 'owner') {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Only the org owner can delete it' } },
      403,
    );
  }
  const now = new Date().toISOString();
  // Soft-delete cascade: org → sites → memberships → invites → api_keys.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE sites SET deleted_at = ? WHERE org_id = ? AND deleted_at IS NULL`,
    ).bind(now, orgId),
    c.env.DB.prepare(
      `UPDATE memberships SET deleted_at = ? WHERE org_id = ? AND deleted_at IS NULL`,
    ).bind(now, orgId),
    c.env.DB.prepare(
      `UPDATE team_invites SET deleted_at = ? WHERE org_id = ? AND deleted_at IS NULL`,
    ).bind(now, orgId),
    c.env.DB.prepare(
      `UPDATE api_keys SET revoked_at = ? WHERE org_id = ? AND revoked_at IS NULL`,
    ).bind(now, orgId),
    c.env.DB.prepare(`UPDATE orgs SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).bind(
      now,
      orgId,
    ),
  ]);

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'org.deleted',
      message: `Org '${orgId}' soft-deleted by owner — full purge scheduled in 30 days`,
      target_type: 'org',
      target_id: orgId,
      metadata_json: { scheduled_purge_after_days: 30 },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({ data: { deleted: true, scheduled_purge_after_days: 30 } });
});

/* ────────────────────────── Org data export (queued job) ────────────────────────── */
aiAdmin.post('/api/admin/org/export', async (c) => {
  const { orgId, userId } = need(c);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO org_exports (id, org_id, requested_by, status) VALUES (?, ?, ?, 'queued')`,
  )
    .bind(id, orgId, userId)
    .run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'org.export_queued',
      message: `Org data export queued (export id '${id}')`,
      target_type: 'org_export',
      target_id: id,
      metadata_json: { export_id: id },
      request_id: c.get('requestId'),
    }),
  );

  // Fire-and-forget: bundle the org's D1 rows into a JSON file in R2.
  // Image/asset bundling stays deferred; this hits the 80% "give me my data" case.
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const tables = [
          'sites',
          'site_snapshots',
          'ai_site_settings',
          'ai_endpoints',
          'ai_form_logs',
          'hostnames',
        ];
        const dump: Record<string, unknown[]> = {};
        for (const t of tables) {
          const rows = await c.env.DB.prepare(
            `SELECT * FROM ${t} WHERE ${t === 'sites' ? 'org_id' : 'site_id'} IN
             (SELECT id FROM sites WHERE org_id = ? AND deleted_at IS NULL) OR
             ${t === 'sites' ? 'org_id = ?' : '0'}`,
          )
            .bind(orgId, orgId)
            .all()
            .catch(() => ({ results: [] as unknown[] }));
          dump[t] = rows.results ?? [];
        }
        const memberships = await c.env.DB.prepare(
          `SELECT m.*, u.email, u.display_name FROM memberships m
         JOIN users u ON u.id = m.user_id WHERE m.org_id = ?`,
        )
          .bind(orgId)
          .all()
          .catch(() => ({ results: [] }));
        dump['team'] = memberships.results ?? [];

        const r2Key = `exports/${orgId}/${id}.json`;
        const body = new TextEncoder().encode(JSON.stringify(dump, null, 2));
        await c.env.SITES_BUCKET.put(r2Key, body, {
          httpMetadata: { contentType: 'application/json' },
        });
        await c.env.DB.prepare(
          `UPDATE org_exports SET status = 'ready', r2_key = ?, size_bytes = ?, completed_at = datetime('now') WHERE id = ?`,
        )
          .bind(r2Key, body.byteLength, id)
          .run();
      } catch (err) {
        await c.env.DB.prepare(
          `UPDATE org_exports SET status = 'error', error = ?, completed_at = datetime('now') WHERE id = ?`,
        )
          .bind(err instanceof Error ? err.message : String(err), id)
          .run()
          .catch(() => undefined);
      }
    })(),
  );
  return c.json({ data: { id, status: 'queued', poll: `/api/admin/org/export/${id}` } });
});

/**
 * `GET /api/admin/org/export/:id` — Poll status of a long-running org
 * data export job.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the export id doesn't belong to the caller's org.
 */
aiAdmin.get('/api/admin/org/export/:id', async (c) => {
  const { orgId } = need(c);
  const row = await c.env.DB.prepare(
    `SELECT id, status, size_bytes, error, created_at, completed_at, r2_key FROM org_exports
     WHERE id = ? AND org_id = ?`,
  )
    .bind(c.req.param('id'), orgId)
    .first<{
      id: string;
      status: string;
      size_bytes: number | null;
      error: string | null;
      created_at: string;
      completed_at: string | null;
      r2_key: string | null;
    }>();
  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Export not found' } }, 404);
  return c.json({
    data: {
      ...row,
      download_url:
        row.status === 'ready' && row.r2_key ? `/api/admin/org/export/${row.id}/download` : null,
    },
  });
});

/**
 * `GET /api/admin/org/export/:id/download` — Stream the org export ZIP
 * back to the caller once the job is complete.
 *
 * @remarks
 * Returns `application/zip` with `Content-Disposition: attachment`.
 * Export artifacts live in R2 under `exports/{org_id}/{id}.zip` and are
 * lifecycle-purged after 30 days.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the export id doesn't belong to the caller's org.
 * @throws 409 CONFLICT when the export is still in-progress.
 */
aiAdmin.get('/api/admin/org/export/:id/download', async (c) => {
  const { orgId } = need(c);
  const row = await c.env.DB.prepare(
    `SELECT r2_key FROM org_exports WHERE id = ? AND org_id = ? AND status = 'ready'`,
  )
    .bind(c.req.param('id'), orgId)
    .first<{ r2_key: string }>();
  if (!row?.r2_key) return c.json({ error: { code: 'NOT_READY' } }, 404);
  const obj = await c.env.SITES_BUCKET.get(row.r2_key);
  if (!obj) return c.json({ error: { code: 'GONE' } }, 410);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="projectsites-export-${c.req.param('id')}.json"`,
    },
  });
});

/* ────────────────────────── Org API keys (psk_…) ────────────────────────── */
// Org-scoped programmatic keys for the projectsites.dev REST API. Hash + 8-char
// prefix are stored; the full secret is shown to the user EXACTLY once at
// creation. Pattern: psk_live_<48 url-safe chars>. Bearer-auth callers can
// present either a session token (existing) or one of these keys.
async function hashApiKey(secret: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * `GET /api/admin/api-keys` — List org-scoped API keys (`psk_live_*`,
 * `psk_test_*`) without secret bodies.
 *
 * @remarks
 * Returns name, prefix, created_by, last_used_at, revoked_at. The raw
 * secret is only ever returned once at creation time.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
aiAdmin.get('/api/admin/api-keys', async (c) => {
  const { orgId } = need(c);
  const rows = await c.env.DB.prepare(
    `SELECT id, name, prefix, scopes_json, last_used_at, expires_at, created_at, revoked_at
     FROM api_keys WHERE org_id = ? ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(orgId)
    .all();
  return c.json({
    data: (rows.results ?? []).map((r) => ({
      ...r,
      scopes: r['scopes_json'] ? safeJson(r['scopes_json'] as string) : [],
      active:
        !r['revoked_at'] &&
        (!r['expires_at'] || new Date(r['expires_at'] as string).getTime() > Date.now()),
    })),
  });
});

/**
 * `POST /api/admin/api-keys` — Mint a new org-scoped API key.
 *
 * @remarks
 * Body: `{ name, expires_at? }`. Returns `{ key: 'psk_live_…' }` exactly
 * once — the raw secret is only ever stored as SHA-256 in D1. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when name is missing.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
aiAdmin.post('/api/admin/api-keys', async (c) => {
  const { orgId, userId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    scopes?: string[];
    expires_in_days?: number;
  };
  const name = (body.name ?? '').trim() || 'untitled key';
  // 48 url-safe chars of entropy = ~288 bits.
  const random = Array.from(crypto.getRandomValues(new Uint8Array(36)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 48);
  const secret = `psk_live_${random}`;
  const prefix = secret.slice(0, 16); // "psk_live_AbCdEfGh"
  const hash = await hashApiKey(secret);
  const id = crypto.randomUUID();
  const expiresAt = body.expires_in_days
    ? new Date(
        Date.now() + Math.max(1, Math.min(365, body.expires_in_days)) * 86400 * 1000,
      ).toISOString()
    : null;
  await c.env.DB.prepare(
    `INSERT INTO api_keys (id, org_id, created_by, name, prefix, hash, scopes_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      orgId,
      userId,
      name,
      prefix,
      hash,
      JSON.stringify(body.scopes ?? ['read', 'write']),
      expiresAt,
    )
    .run();
  return c.json(
    {
      data: {
        id,
        name,
        prefix,
        secret, // returned ONCE — never again.
        expires_at: expiresAt,
        scopes: body.scopes ?? ['read', 'write'],
        note: 'Copy this secret now — it cannot be shown again. Send as `Authorization: Bearer <secret>`.',
      },
    },
    201,
  );
});

/**
 * `DELETE /api/admin/api-keys/:id` — Revoke an org-scoped API key.
 *
 * @remarks
 * Sets `revoked_at = now()`; subsequent requests with that key fail auth.
 * Audit-logged.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the key id doesn't belong to the caller's org.
 */
aiAdmin.delete('/api/admin/api-keys/:id', async (c) => {
  const { orgId } = need(c);
  await c.env.DB.prepare(
    `UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND org_id = ? AND revoked_at IS NULL`,
  )
    .bind(c.req.param('id'), orgId)
    .run();
  return c.json({ data: { revoked: true } });
});

/* ────────────────────────── Active sessions (account security) ────────────────────────── */
// Backs the /admin/user "Active sessions" panel — real D1 `sessions` rows,
// list + revoke, scoped to the caller.

/** Extract the caller's raw bearer token (to flag the CURRENT session row). */
function bearerToken(c: Ctx): string | undefined {
  const h = c.req.header('Authorization');
  return h && h.startsWith('Bearer ') ? h.slice(7) : undefined;
}

/**
 * `GET /api/admin/sessions` — List the caller's active sessions (real D1 rows),
 * most-recently-active first, with the current session flagged.
 *
 * @throws 401 UNAUTHORIZED when user context is missing.
 */
aiAdmin.get('/api/admin/sessions', async (c) => {
  const { userId } = need(c);
  const rows = await listUserSessions(c.env.DB, userId, bearerToken(c));
  return c.json({ data: rows });
});

/**
 * `DELETE /api/admin/sessions/:id` — Revoke one of the caller's own sessions.
 * Only succeeds when the session belongs to the caller (no cross-user revoke).
 *
 * @throws 401 UNAUTHORIZED when user context is missing.
 * @throws 404 NOT_FOUND when the session isn't the caller's.
 */
aiAdmin.delete('/api/admin/sessions/:id', async (c) => {
  const { userId } = need(c);
  const revoked = await revokeUserSession(c.env.DB, userId, c.req.param('id'));
  if (!revoked) throw new HTTPError(404, 'Session not found');
  return c.json({ data: { revoked: true } });
});

/**
 * `POST /api/admin/sessions/revoke-others` — Sign out every OTHER device,
 * keeping the caller's current session. Returns the count revoked.
 *
 * @throws 401 UNAUTHORIZED when user context is missing.
 */
aiAdmin.post('/api/admin/sessions/revoke-others', async (c) => {
  const { userId } = need(c);
  const count = await revokeOtherUserSessions(c.env.DB, userId, bearerToken(c));
  return c.json({ data: { revoked: count } });
});

/* ────────────────────────── Domains aggregator (all sites' hostnames) ────────────────────────── */
// Settings → Domains needs to see every hostname across the org without the
// user having to click into each site. This endpoint joins sites + hostnames
// so the page can render the full picture and inline-act on any row.
/**
 * `GET /api/admin/domains` — List custom hostnames + their CF for SaaS
 * provisioning status across the caller's org.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
aiAdmin.get('/api/admin/domains', async (c) => {
  const { orgId } = need(c);
  const sites = await c.env.DB.prepare(
    `SELECT id, slug, business_name FROM sites WHERE org_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
  )
    .bind(orgId)
    .all();
  const siteRows = (sites.results ?? []) as {
    id: string;
    slug: string;
    business_name: string | null;
  }[];
  if (siteRows.length === 0) return c.json({ data: { sites: [] } });
  const placeholders = siteRows.map(() => '?').join(',');
  const hosts = await c.env.DB.prepare(
    `SELECT id, site_id, hostname, type, status, is_primary, ssl_status,
            verification_errors, last_verified_at, created_at
     FROM hostnames WHERE site_id IN (${placeholders}) AND deleted_at IS NULL
     ORDER BY is_primary DESC, created_at DESC`,
  )
    .bind(...siteRows.map((s) => s.id))
    .all();
  const byId = new Map<
    string,
    { site: { id: string; slug: string; business_name: string | null }; hostnames: unknown[] }
  >();
  for (const s of siteRows) byId.set(s.id, { site: s, hostnames: [] });
  for (const h of (hosts.results ?? []) as Record<string, unknown>[]) {
    const bucket = byId.get(h['site_id'] as string);
    if (bucket) bucket.hostnames.push(h);
  }
  return c.json({ data: { sites: Array.from(byId.values()) } });
});

/* ────────────────────────── Cloudflare auto-config status ────────────────────────── */
// Returns whether Analytics + WFP are fully wired, plus the namespace name
// + masked account id so the UI can replace "Setup needed" with a real
// status badge. POST kicks off a verification round-trip against the CF
// API using whatever auth the worker already has (scoped token preferred,
// global key fallback) so we know the dashboard view matches reality.
/**
 * `GET /api/admin/cloudflare/status` — Probe the Cloudflare account
 * configuration that powers the caller's org.
 *
 * @remarks
 * Verifies API token reachability, Zone, Worker, R2 bucket, D1 binding,
 * and Workers AI access. Used by the onboarding wizard to gate the
 * "Setup Cloudflare" step.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
aiAdmin.get('/api/admin/cloudflare/status', async (c) => {
  need(c);
  const env = c.env as Env & {
    CF_ACCOUNT_ID?: string;
    WFP_NAMESPACE_NAME?: string;
    CLOUDFLARE_API_KEY?: string;
    CLOUDFLARE_EMAIL?: string;
  };
  const accountId = env.CF_ACCOUNT_ID ?? '';
  const namespace = env.WFP_NAMESPACE_NAME ?? '';
  const hasScopedToken = !!env.CF_API_TOKEN;
  const hasGlobalKey = !!(env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_EMAIL);
  const dispatch = !!env.USER_DISPATCH;
  return c.json({
    data: {
      account_id_masked: accountId ? `${accountId.slice(0, 8)}…${accountId.slice(-4)}` : null,
      wfp_namespace_name: namespace || null,
      analytics_configured: !!(accountId && (hasScopedToken || hasGlobalKey)),
      wfp_configured: !!(accountId && namespace && dispatch && (hasScopedToken || hasGlobalKey)),
      auth_mode: hasScopedToken ? 'scoped_token' : hasGlobalKey ? 'global_key' : 'none',
      dispatch_binding_present: dispatch,
    },
  });
});

/**
 * `POST /api/admin/cloudflare/auto-setup` — Run the auto-provisioning
 * flow that creates the R2 bucket, KV namespace, D1 database, and Workers
 * AI binding for the caller's org.
 *
 * @remarks
 * Body: `{ cf_api_token, cf_account_id }`. Encrypts the token via
 * {@link aiCrypto} before persisting. Idempotent — re-running checks
 * existing resources before creating new ones. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when the token doesn't match the account or
 *   lacks the required permission groups.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
aiAdmin.post('/api/admin/cloudflare/auto-setup', async (c) => {
  need(c);
  const env = c.env as Env & {
    CF_ACCOUNT_ID?: string;
    WFP_NAMESPACE_NAME?: string;
    CLOUDFLARE_API_KEY?: string;
    CLOUDFLARE_EMAIL?: string;
  };
  const accountId = env.CF_ACCOUNT_ID;
  if (!accountId) {
    return c.json(
      { error: { code: 'NO_ACCOUNT', message: 'CF_ACCOUNT_ID env var is not set' } },
      503,
    );
  }
  const headers: Record<string, string> = { 'User-Agent': 'project-sites-admin/1.0' };
  if (env.CF_API_TOKEN) {
    headers['Authorization'] = `Bearer ${env.CF_API_TOKEN}`;
  } else if (env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_EMAIL) {
    headers['X-Auth-Email'] = env.CLOUDFLARE_EMAIL;
    headers['X-Auth-Key'] = env.CLOUDFLARE_API_KEY;
  } else {
    return c.json({ error: { code: 'NO_AUTH', message: 'No CF credentials configured' } }, 503);
  }
  // Round-trip: verify account access by listing dispatch namespaces.
  const verifyRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/dispatch/namespaces`,
    { headers },
  );
  const verifyBody = (await verifyRes.json().catch(() => null)) as {
    success: boolean;
    result?: { namespace_name: string }[];
    errors?: { code: number; message: string }[];
  } | null;
  if (!verifyRes.ok || !verifyBody?.success) {
    return c.json(
      {
        error: {
          code: 'CF_AUTH_FAILED',
          message: verifyBody?.errors?.[0]?.message ?? `CF API returned ${verifyRes.status}`,
        },
      },
      502,
    );
  }
  const wantNamespace = env.WFP_NAMESPACE_NAME ?? 'project-sites-endpoints';
  const existsAlready = verifyBody.result?.some((n) => n.namespace_name === wantNamespace) ?? false;
  let created = false;
  if (!existsAlready) {
    const createRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/dispatch/namespaces`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: wantNamespace }),
      },
    );
    const createBody = (await createRes.json().catch(() => null)) as {
      success: boolean;
      errors?: { message: string }[];
    } | null;
    if (!createRes.ok || !createBody?.success) {
      return c.json(
        {
          error: {
            code: 'NAMESPACE_CREATE_FAILED',
            message: createBody?.errors?.[0]?.message ?? `${createRes.status}`,
          },
        },
        502,
      );
    }
    created = true;
  }
  return c.json({
    data: {
      account_id_masked: `${accountId.slice(0, 8)}…${accountId.slice(-4)}`,
      wfp_namespace_name: wantNamespace,
      namespace_created: created,
      namespace_existed: existsAlready,
      analytics_configured: true,
      wfp_configured: !!env.USER_DISPATCH,
      dispatch_binding_present: !!env.USER_DISPATCH,
      note: env.USER_DISPATCH
        ? 'All Cloudflare services are wired and ready.'
        : 'Namespace ready; the worker still needs a USER_DISPATCH binding deploy to dispatch user code.',
    },
  });
});

// Admin AI Chat (POST /api/admin/ai-chat) moved to
// `libs/features/admin_ai/handlers.ts` (route-decomposition installment 18).

// Per-site AI credit cap (GET/PUT /api/sites/:siteId/credit-cap) moved to
// `libs/features/ai_settings/handlers.ts` (route-decomposition installment 18).

/* ────────────────────────── Transfer org ownership (14-day pending) ────────────────────────── */
aiAdmin.post('/api/team/transfer', async (c) => {
  const { orgId, userId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as { to_email?: string };
  const toEmail = (body.to_email ?? '').trim().toLowerCase();
  if (!toEmail.includes('@')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'valid to_email required' } }, 400);
  }
  // Caller must be a CURRENT owner. `deleted_at IS NULL` excludes soft-deleted
  // memberships — a member removed via /api/auth/organization/remove-member is
  // soft-deleted with their `role` intact, so without this filter a removed owner
  // could still pass this gate and initiate a transfer of an org they no longer
  // belong to. Matches every other membership role check in the worker.
  const me = await c.env.DB.prepare(
    `SELECT role FROM memberships WHERE org_id = ? AND user_id = ? AND deleted_at IS NULL`,
  )
    .bind(orgId, userId)
    .first<{ role: string }>();
  if (me?.role !== 'owner') {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Only the owner can transfer ownership.' } },
      403,
    );
  }
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO org_transfers (id, org_id, from_user_id, to_email, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'pending', datetime('now','+14 days'), datetime('now'))`,
  )
    .bind(id, orgId, userId, toEmail)
    .run();
  return c.json({ data: { id, to_email: toEmail, status: 'pending', expires_in_days: 14 } });
});

/**
 * `GET /api/team/transfer` — List pending ownership-transfer requests
 * for the caller's org.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
aiAdmin.get('/api/team/transfer', async (c) => {
  const { orgId } = need(c);
  const rows = await c.env.DB.prepare(
    `SELECT id, to_email, status, expires_at, created_at FROM org_transfers
     WHERE org_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 5`,
  )
    .bind(orgId)
    .all();
  return c.json({ data: rows.results ?? [] });
});

/**
 * `DELETE /api/team/transfer/:id` — Cancel a pending ownership-transfer
 * request before the recipient accepts it.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the transfer id doesn't belong to the caller's org.
 */
aiAdmin.delete('/api/team/transfer/:id', async (c) => {
  const { orgId } = need(c);
  await c.env.DB.prepare(
    `UPDATE org_transfers SET status = 'cancelled' WHERE id = ? AND org_id = ? AND status = 'pending'`,
  )
    .bind(c.req.param('id'), orgId)
    .run();
  return c.json({ data: { cancelled: true } });
});

/* ────────────────────────── AI Chat Extras: uploads + drive + summary ────────────────────────── */

/**
 * GET /api/sites/:siteId/workflows/:wfName/:id
 * Proxy a workflow instance's `.status()` to the client (item #60). Supports
 * `drive-sync` and `image-generation` Workflow names. Verifies the site is
 * owned by the caller's org before exposing the status.
 */
aiAdmin.get('/api/sites/:siteId/workflows/:wfName/:id', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const wfName = c.req.param('wfName');
  const instanceId = c.req.param('id');
  await siteOwned(c, orgId, siteId);

  let binding: Workflow | undefined;
  if (wfName === 'drive-sync') binding = c.env.DRIVE_SYNC_WORKFLOW;
  else if (wfName === 'image-generation') binding = c.env.IMAGE_GENERATION_WORKFLOW;
  else throw new HTTPError(404, 'unknown workflow name');

  if (!binding) {
    return c.json({ data: { status: 'unbound', workflow: wfName } });
  }

  try {
    const instance = await binding.get(instanceId);
    const status = await instance.status();
    return c.json({ data: { workflow: wfName, workflow_id: instanceId, ...status } });
  } catch (err) {
    throw new HTTPError(404, err instanceof Error ? err.message : 'workflow_lookup_failed');
  }
});

// AI Explain Trace (POST /api/admin/traces/:traceId/explain) + AI
// Natural-Language Search (POST /api/admin/search/ai) moved to
// `libs/features/admin_ai/handlers.ts` (route-decomposition installment 18).

/* ────────────────────────── #95 AI Cost Forecaster ────────────────────────── */

/**
 * GET /api/admin/forecast/cost
 *
 * 30-day usage rollup → next-month USD forecast per Cloudflare pricing, plus
 * one LLM-generated savings tip.
 */
aiAdmin.get('/api/admin/forecast/cost', async (c) => {
  const { orgId } = need(c);
  const forecast = await forecastCost(c.env, orgId);
  return c.json({ data: forecast });
});

// Cmd-K Inline AI Streaming (POST /api/admin/ai/stream/palette) + the AI Chat
// Widget SSE handler (POST /api/admin/ai/stream/chat, incl. its EDITOR_TOOL_SURFACE
// const) moved to `libs/features/admin_ai/handlers.ts` (route-decomposition
// installment 18).
