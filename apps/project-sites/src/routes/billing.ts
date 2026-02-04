/**
 * Billing routes
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import {
  checkoutSessionInputSchema,
  billingPortalInputSchema,
  ValidationError,
  NotFoundError,
  requireOrg,
  requireBillingAdmin,
  getEntitlements,
  PRICING,
  generateUuid,
  type RequestContext,
  type EntitlementContext,
} from '@project-sites/shared';
import { BillingService } from '../services/billing.js';

export const billingRoutes = new Hono<AppEnv>();

// Get subscription status
billingRoutes.get('/subscription', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireOrg(ctx);
  const db = c.get('db');

  const { data: subscription, error } = await db
    .from('subscriptions')
    .select('*')
    .eq('org_id', auth.org_id)
    .is('ended_at', null)
    .single();

  const entitlementCtx: EntitlementContext = {
    org_id: auth.org_id,
    subscription: subscription ? { state: subscription.state } : undefined,
  };

  const entitlements = getEntitlements(entitlementCtx);

  return c.json({
    success: true,
    data: {
      subscription,
      entitlements,
      pricing: {
        monthly_cents: PRICING.MONTHLY_CENTS,
        currency: PRICING.CURRENCY,
      },
    },
    request_id: c.get('request_id'),
  });
});

// Create checkout session
billingRoutes.post('/checkout', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireOrg(ctx);

  const body = await c.req.json();
  const result = checkoutSessionInputSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  const db = c.get('db');

  // Verify site belongs to org
  const { data: site } = await db
    .from('sites')
    .select('id, org_id')
    .eq('id', result.data.site_id)
    .eq('org_id', auth.org_id)
    .single();

  if (!site) {
    throw new NotFoundError('Site');
  }

  const billingService = new BillingService(c);
  const checkout = await billingService.createCheckoutSession({
    org_id: auth.org_id,
    site_id: result.data.site_id,
    success_url: result.data.success_url,
    cancel_url: result.data.cancel_url,
    customer_email: result.data.customer_email,
  });

  return c.json({
    success: true,
    data: checkout,
    request_id: c.get('request_id'),
  });
});

// Create billing portal session
billingRoutes.post('/portal', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireBillingAdmin(ctx);

  const body = await c.req.json();
  const result = billingPortalInputSchema.safeParse(body);

  if (!result.success) {
    throw new ValidationError('Invalid input', { errors: result.error.errors });
  }

  const billingService = new BillingService(c);
  const portal = await billingService.createBillingPortalSession({
    org_id: auth.org_id!,
    return_url: result.data.return_url,
  });

  return c.json({
    success: true,
    data: portal,
    request_id: c.get('request_id'),
  });
});

// Get invoices
billingRoutes.get('/invoices', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireBillingAdmin(ctx);
  const db = c.get('db');

  const { data: invoices, error } = await db
    .from('invoices')
    .select('*')
    .eq('org_id', auth.org_id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  return c.json({
    success: true,
    data: { invoices: invoices || [] },
    request_id: c.get('request_id'),
  });
});

// Get usage (for internal metering)
billingRoutes.get('/usage', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireOrg(ctx);
  const db = c.get('db');

  // Get this month's usage
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: usage, error } = await db
    .from('usage_events')
    .select('event_type, quantity')
    .eq('org_id', auth.org_id)
    .gte('created_at', startOfMonth.toISOString());

  if (error) throw error;

  // Aggregate by event type
  const summary = (usage || []).reduce((acc, event) => {
    acc[event.event_type] = (acc[event.event_type] || 0) + event.quantity;
    return acc;
  }, {} as Record<string, number>);

  return c.json({
    success: true,
    data: {
      period_start: startOfMonth.toISOString(),
      period_end: new Date().toISOString(),
      usage: summary,
    },
    request_id: c.get('request_id'),
  });
});

// Cancel subscription (with retention offer)
billingRoutes.post('/cancel', async (c) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };

  const auth = requireBillingAdmin(ctx);

  const body = await c.req.json();
  const reason = body.reason;
  const acceptRetentionOffer = body.accept_retention_offer === true;

  const billingService = new BillingService(c);

  if (acceptRetentionOffer) {
    // Apply retention offer ($25/mo for 12 months)
    const result = await billingService.applyRetentionOffer(auth.org_id!);
    return c.json({
      success: true,
      data: {
        message: 'Retention offer applied',
        new_price_cents: PRICING.RETENTION_MONTHLY_CENTS,
        duration_months: PRICING.RETENTION_DURATION_MONTHS,
      },
      request_id: c.get('request_id'),
    });
  }

  // Cancel at period end
  await billingService.cancelSubscription(auth.org_id!, reason);

  return c.json({
    success: true,
    data: {
      message: 'Subscription will be canceled at period end',
      retention_offer: {
        available: true,
        price_cents: PRICING.RETENTION_MONTHLY_CENTS,
        duration_months: PRICING.RETENTION_DURATION_MONTHS,
      },
    },
    request_id: c.get('request_id'),
  });
});
