/**
 * @module libs/features/conversion_checkout/handlers
 *
 * @description
 * `POST /api/conversion/checkout` — the PUBLIC conversion funnel: creates a Stripe
 * Checkout session for an anonymous visitor upgrading a site (domain/plan). Public
 * (no org auth) — deliberately NOT folded into the org-scoped `billing` module,
 * whose routes require `c.get('orgId')`; the auth models differ.
 *
 * Extracted VERBATIM from the `search.ts` monolith (route-decomposition
 * installment 28) — only the route-registration receiver changed
 * (`search.` → `conversionCheckout.`) and the dynamic `import('../services/db.js')`
 * re-depthed to `../../../src/services/db.js` for the module location. A payments
 * concern that never belonged in the search-routes file.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { DOMAINS } from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const conversionCheckout = new Hono<AppContext>();

conversionCheckout.post('/api/conversion/checkout', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    slug?: string;
    domain?: string;
    email?: string;
  };

  if (!body.slug) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing slug' } }, 400);
  }

  const { dbQueryOne } = await import('../../../src/services/db.js');
  const site = await dbQueryOne<{
    id: string;
    slug: string;
    org_id: string;
    business_name: string;
  }>(
    c.env.DB,
    'SELECT id, slug, org_id, business_name FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [body.slug],
  );
  if (!site) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }

  try {
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][recurring][interval]', 'month');
    params.set('line_items[0][price_data][unit_amount]', '5000');
    params.set(
      'line_items[0][price_data][product_data][name]',
      `${site.business_name} Website — Pro Plan`,
    );
    params.set(
      'line_items[0][price_data][product_data][description]',
      `Custom domain, AI editing, analytics, priority support`,
    );
    params.set('line_items[0][quantity]', '1');
    params.set('metadata[site_id]', site.id);
    params.set('metadata[slug]', site.slug);
    params.set('metadata[org_id]', site.org_id);
    params.set('metadata[domain]', body.domain || '');
    params.set('metadata[source]', 'conversion-flow');
    params.set('success_url', `https://${site.slug}${DOMAINS.SITES_SUFFIX}/?upgraded=1`);
    params.set('cancel_url', `https://${site.slug}${DOMAINS.SITES_SUFFIX}/`);
    if (body.email) params.set('customer_email', body.email);

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!stripeRes.ok) {
      const errText = await stripeRes.text();
      console.warn('[conversion-checkout] Stripe error:', errText);
      return c.json({ error: { code: 'STRIPE_ERROR', message: 'Checkout creation failed' } }, 500);
    }

    const session = (await stripeRes.json()) as { url: string };
    return c.json({ data: { checkout_url: session.url } });
  } catch (err) {
    console.warn('[conversion-checkout] Error:', err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Checkout creation failed' } }, 500);
  }
});
