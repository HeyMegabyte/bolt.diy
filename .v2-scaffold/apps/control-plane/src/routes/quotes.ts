/**
 * Quotes — list / get / create / send / accept. Role-aware: customers see only their
 * quotes; staff see all within the tenant.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import { writeAudit } from '../services/audit.js';
import {
  evaluateBundle,
  recordBundleDiscount,
  type BundleBooking,
  type BundleDecision,
} from '../services/loyalty.js';

interface QuoteRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  currency: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

const app = new Hono<HonoEnv>();

function tenantOrThrow(c: any): string {
  requireAuth(c);
  const tenantId = c.get('tenantId') ?? c.get('orgId');
  if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');
  return tenantId;
}

app.get('/', async (c) => {
  const tenantId = tenantOrThrow(c);
  const userId = c.get('userId')!;
  const viewAs = c.get('viewAs');
  let rows: QuoteRow[];
  if (viewAs === 'customer') {
    rows = await dbQuery<QuoteRow>(
      c.env.DB,
      `SELECT * FROM quotes WHERE tenant_id = ?1 AND customer_id = ?2 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [tenantId, userId],
    );
  } else {
    rows = await dbQuery<QuoteRow>(
      c.env.DB,
      `SELECT * FROM quotes WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`,
      [tenantId],
    );
  }
  return c.json({ quotes: rows });
});

app.get('/:id', async (c) => {
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');
  const row = await dbQueryOne<QuoteRow>(
    c.env.DB,
    `SELECT * FROM quotes WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
    [id, tenantId],
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'quote');
  return c.json(row);
});

app.post(
  '/',
  zValidator(
    'json',
    z.object({
      customer_id: z.string().uuid().optional(),
      subtotal_cents: z.number().int().nonnegative(),
      tax_cents: z.number().int().nonnegative().default(0),
      total_cents: z.number().int().nonnegative(),
      currency: z.string().length(3).default('usd'),
      line_items: z.array(z.unknown()).default([]),
      notes: z.string().max(2000).optional(),
      // Optional bundle-discount hints — when present, the worker checks for
      // existing bookings same customer + crew + day and applies a 12% bundle
      // discount on the marketplace application fee (#32).
      crew_id: z.string().uuid().optional(),
      scheduled_for: z.string().datetime().optional(),
      base_application_fee_cents: z.number().int().nonnegative().optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const body = c.req.valid('json');
    const id = crypto.randomUUID();

    // #32 — bundle eligibility check. Only fires when caller passes the
    // schedule hints; otherwise the response is bundle-neutral.
    let bundle: BundleDecision | null = null;
    if (body.customer_id && body.scheduled_for) {
      bundle = await checkBundleEligibility(c.env.DB, {
        tenantId,
        customerId: body.customer_id,
        crewId: body.crew_id ?? null,
        scheduledFor: body.scheduled_for,
        pendingBookingId: id,
      });
      if (
        bundle.bundleApplies &&
        typeof body.base_application_fee_cents === 'number' &&
        body.base_application_fee_cents > 0
      ) {
        await recordBundleDiscount(c.env, {
          tenantId,
          customerId: body.customer_id,
          crewId: body.crew_id ?? null,
          decision: bundle,
          baseApplicationFeeCents: body.base_application_fee_cents,
        });
      }
    }

    await dbInsert(c.env.DB, 'quotes', {
      id,
      tenant_id: tenantId,
      customer_id: body.customer_id ?? null,
      status: 'draft',
      subtotal_cents: body.subtotal_cents,
      tax_cents: body.tax_cents,
      total_cents: body.total_cents,
      currency: body.currency.toLowerCase(),
      metadata_json: JSON.stringify({
        line_items: body.line_items,
        notes: body.notes,
        bundle: bundle ?? undefined,
      }),
    });
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'quote.create',
      target_type: 'quote',
      target_id: id,
      metadata: {
        total_cents: body.total_cents,
        bundle_applied: bundle?.bundleApplies ?? false,
        bundle_pct: bundle?.discountPct ?? 0,
      },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json({
      id,
      status: 'draft',
      bundle: bundle ?? { bundleApplies: false, discountPct: 0, applicationFeeFactor: 1 },
    });
  },
);

/**
 * #32 helper — peek at the same-day same-crew bookings + this pending quote and
 * decide if it qualifies for the 12% bundle. The pending booking is synthesised
 * from the caller-provided `scheduled_for` so the very first quote-create call
 * that completes the pair still triggers the discount.
 */
async function checkBundleEligibility(
  db: D1Database,
  args: {
    tenantId: string;
    customerId: string;
    crewId: string | null;
    scheduledFor: string;
    pendingBookingId: string;
  },
): Promise<BundleDecision> {
  const day = args.scheduledFor.slice(0, 10);
  const stmt = db.prepare(
    `SELECT id, customer_id, scheduled_for FROM bookings
      WHERE tenant_id = ?1
        AND customer_id = ?2
        AND deleted_at IS NULL
        AND status != 'cancelled'
        AND substr(scheduled_for, 1, 10) = ?3`,
  );
  const result = await stmt.bind(args.tenantId, args.customerId, day).all<{
    id: string;
    customer_id: string;
    scheduled_for: string;
  }>();
  const existing: BundleBooking[] = (result.results ?? []).map((r) => ({
    id: r.id,
    customer_id: r.customer_id,
    crew_id: args.crewId,
    scheduled_for: r.scheduled_for,
  }));
  existing.push({
    id: args.pendingBookingId,
    customer_id: args.customerId,
    crew_id: args.crewId,
    scheduled_for: args.scheduledFor,
  });
  return evaluateBundle(existing);
}

app.post('/:id/send', async (c) => {
  const userId = requireAuth(c);
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');
  await dbExecute(
    c.env.DB,
    `UPDATE quotes SET status = 'sent', updated_at = ?1 WHERE id = ?2 AND tenant_id = ?3`,
    [new Date().toISOString(), id, tenantId],
  );
  await writeAudit(c.env, {
    actor_user_id: userId,
    actor_email: c.get('userEmail'),
    tenant_id: tenantId,
    event: 'quote.send',
    target_type: 'quote',
    target_id: id,
    metadata: {},
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  return c.json({ ok: true });
});

app.post('/:id/accept', async (c) => {
  const userId = requireAuth(c);
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');
  await dbExecute(
    c.env.DB,
    `UPDATE quotes SET status = 'accepted', accepted_at = ?1, updated_at = ?1 WHERE id = ?2 AND tenant_id = ?3`,
    [new Date().toISOString(), id, tenantId],
  );
  await writeAudit(c.env, {
    actor_user_id: userId,
    actor_email: c.get('userEmail'),
    tenant_id: tenantId,
    event: 'quote.accept',
    target_type: 'quote',
    target_id: id,
    metadata: {},
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  return c.json({ ok: true });
});

export default app;
