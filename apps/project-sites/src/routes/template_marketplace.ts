/**
 * @module routes/template_marketplace
 * @description Template Marketplace v1 API routes (IDEAS-50 #39).
 *
 * Mount path: `/` (handlers carry their own `/api/template-marketplace/*` prefix).
 *
 * Surfaces:
 *   GET  /api/template-marketplace/templates                  — browse approved
 *   GET  /api/template-marketplace/templates/:id              — single detail
 *   POST /api/template-marketplace/submissions                — creator submit
 *   POST /api/template-marketplace/templates/:id/purchase     — record purchase
 *   GET  /api/template-marketplace/my-templates               — creator's listings
 *   GET  /api/template-marketplace/my-purchases               — buyer's history
 *
 * Every handler:
 *   - Returns 404 when the `template_marketplace` flag is off (never 403 —
 *     don't leak feature existence per [[feature-flags]]).
 *   - Requires auth for any mutation and for personal-data reads.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  getCreatorRevenue,
  getTemplate,
  listBuyerPurchases,
  listTemplates,
  recordPurchase,
  submitTemplate,
} from '../services/template_marketplace.js';
import {
  TemplatePurchaseInputSchema,
  TemplateSubmissionSchema,
} from '../../libs/features/template_marketplace/feature.schemas.js';

const FLAG_KEY = 'template_marketplace';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const templateMarketplace = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Common gate — flag off → 404; auth required → 401 when `requireAuth`. */
async function guard(c: AppContext, requireAuth: boolean): Promise<Response | null> {
  const on = await isFlagOn(c.env, FLAG_KEY, { orgId: c.get('orgId') });
  if (!on) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  if (requireAuth) {
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/template-marketplace/templates — browse approved catalog.
// ─────────────────────────────────────────────────────────────────────────────

templateMarketplace.get('/api/template-marketplace/templates', async (c) => {
  const blocked = await guard(c, false);
  if (blocked) return blocked;

  const category = c.req.query('category') ?? undefined;
  const limit = Number(c.req.query('limit') ?? '200');
  const templates = await listTemplates(c.env, {
    category,
    limit: Number.isFinite(limit) ? limit : 200,
  });
  return c.json({ templates, count: templates.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/template-marketplace/templates/:id — single detail.
// ─────────────────────────────────────────────────────────────────────────────

templateMarketplace.get('/api/template-marketplace/templates/:id', async (c) => {
  const blocked = await guard(c, false);
  if (blocked) return blocked;

  const id = c.req.param('id');
  const tpl = await getTemplate(c.env, id);
  if (!tpl) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404);
  }
  // Hide pending/rejected from anonymous viewers.
  if (tpl.submission_status !== 'approved') {
    const callerId = c.get('userId');
    if (!callerId || callerId !== tpl.creator_user_id) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404);
    }
  }
  return c.json({ template: tpl });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/template-marketplace/submissions — creator submit (auth).
// ─────────────────────────────────────────────────────────────────────────────

templateMarketplace.post('/api/template-marketplace/submissions', async (c) => {
  const blocked = await guard(c, true);
  if (blocked) return blocked;

  const userId = c.get('userId') as string;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }
  const parsed = TemplateSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid submission body',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  try {
    const result = await submitTemplate(c.env, parsed.data, userId);
    return c.json(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'SLUG_TAKEN') {
      return c.json(
        { error: { code: 'CONFLICT', message: 'Template slug already taken' } },
        409,
      );
    }
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Submission failed' } },
      500,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/template-marketplace/templates/:id/purchase — record purchase (auth).
//
// Body validates against TemplatePurchaseInputSchema. The Stripe PaymentIntent
// is the idempotency key; calling this with the same `stripe_payment_intent`
// twice is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

templateMarketplace.post('/api/template-marketplace/templates/:id/purchase', async (c) => {
  const blocked = await guard(c, true);
  if (blocked) return blocked;

  const userId = c.get('userId') as string;
  const templateId = c.req.param('id');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }
  const parsed = TemplatePurchaseInputSchema.safeParse({
    ...(body as Record<string, unknown>),
    template_id: templateId,
  });
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid purchase body',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  try {
    const result = await recordPurchase(c.env, parsed.data, userId);
    return c.json(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'TEMPLATE_NOT_FOUND' || message === 'TEMPLATE_NOT_APPROVED') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Template not available' } }, 404);
    }
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Purchase failed' } },
      500,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/template-marketplace/my-templates — creator's listings + revenue.
// ─────────────────────────────────────────────────────────────────────────────

templateMarketplace.get('/api/template-marketplace/my-templates', async (c) => {
  const blocked = await guard(c, true);
  if (blocked) return blocked;

  const userId = c.get('userId') as string;
  const templates = await listTemplates(c.env, {
    creatorUserId: userId,
    includeUnapproved: true,
    limit: 500,
  });
  const revenue = await getCreatorRevenue(c.env, userId);
  return c.json({ templates, revenue });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/template-marketplace/my-purchases — buyer's history.
// ─────────────────────────────────────────────────────────────────────────────

templateMarketplace.get('/api/template-marketplace/my-purchases', async (c) => {
  const blocked = await guard(c, true);
  if (blocked) return blocked;

  const userId = c.get('userId') as string;
  const limit = Number(c.req.query('limit') ?? '100');
  const purchases = await listBuyerPurchases(c.env, userId, Number.isFinite(limit) ? limit : 100);
  return c.json({ purchases, count: purchases.length });
});

export { templateMarketplace };
export default templateMarketplace;
