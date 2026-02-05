/**
 * Billing Service Implementation
 * Handles Stripe integration, subscriptions, entitlements, and dunning
 */
import {
  generateId,
  nowISO,
  daysFromNow,
  isExpired,
  PRICING,
  DUNNING,
  ENTITLEMENTS,
} from '@project-sites/shared';

// =============================================================================
// TYPES
// =============================================================================

export interface BillingServiceDeps {
  db: Database;
  kv: KVNamespace;
  stripe: StripeClient;
  saleWebhookUrl?: string;
  saleWebhookSecret?: string;
}

interface Database {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ rowsAffected: number }>;
}

interface StripeClient {
  customers: {
    create(params: any): Promise<{ id: string; email: string }>;
    retrieve(id: string): Promise<{ id: string; email: string }>;
    update(id: string, params: any): Promise<{ id: string }>;
  };
  checkout: {
    sessions: {
      create(params: any): Promise<{ id: string; url: string }>;
      retrieve(id: string): Promise<any>;
    };
  };
  subscriptions: {
    retrieve(id: string): Promise<any>;
    update(id: string, params: any): Promise<any>;
    cancel(id: string): Promise<any>;
  };
  billingPortal: {
    sessions: {
      create(params: any): Promise<{ url: string }>;
    };
  };
}

export interface Subscription {
  id: string;
  orgId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: 'active' | 'past_due' | 'canceled' | 'unpaid' | 'trialing';
  priceId: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Entitlements {
  orgId: string;
  plan: 'free' | 'paid';
  topBarHidden: boolean;
  maxCustomDomains: number;
  maxSites: number;
  features: string[];
  validUntil: string | null;
}

export interface DunningState {
  orgId: string;
  stage: 0 | 1 | 2 | 3 | 4;
  daysPastDue: number;
  lastInvoiceId: string | null;
  lastReminderAt: string | null;
  downgradeAt: string | null;
}

// =============================================================================
// BILLING SERVICE CLASS
// =============================================================================

export class BillingService {
  private db: Database;
  private kv: KVNamespace;
  private stripe: StripeClient;
  private saleWebhookUrl?: string;
  private saleWebhookSecret?: string;

  constructor(deps: BillingServiceDeps) {
    this.db = deps.db;
    this.kv = deps.kv;
    this.stripe = deps.stripe;
    this.saleWebhookUrl = deps.saleWebhookUrl;
    this.saleWebhookSecret = deps.saleWebhookSecret;
  }

  // ===========================================================================
  // STRIPE CUSTOMER
  // ===========================================================================

  async getOrCreateStripeCustomer(orgId: string, email: string): Promise<{
    customerId: string;
    isNew: boolean;
  }> {
    // Get org
    const orgs = await this.db.query<{ id: string; stripe_customer_id: string | null }>(
      `SELECT id, stripe_customer_id FROM orgs WHERE id = $1 AND deleted_at IS NULL`,
      [orgId],
    );

    const org = orgs[0];
    if (!org) {
      throw new Error('Organization not found');
    }

    if (org.stripe_customer_id) {
      return { customerId: org.stripe_customer_id, isNew: false };
    }

    // Create new customer
    const customer = await this.stripe.customers.create({
      email,
      metadata: { org_id: orgId },
    });

    // Save to org
    await this.db.execute(
      `UPDATE orgs SET stripe_customer_id = $1, updated_at = $2 WHERE id = $3`,
      [customer.id, nowISO(), orgId],
    );

    return { customerId: customer.id, isNew: true };
  }

  async getStripeCustomer(orgId: string): Promise<{ id: string; email: string } | null> {
    const orgs = await this.db.query<{ stripe_customer_id: string | null }>(
      `SELECT stripe_customer_id FROM orgs WHERE id = $1 AND deleted_at IS NULL`,
      [orgId],
    );

    const org = orgs[0];
    if (!org?.stripe_customer_id) {
      return null;
    }

    return this.stripe.customers.retrieve(org.stripe_customer_id);
  }

  // ===========================================================================
  // CHECKOUT
  // ===========================================================================

  async createCheckoutSession(params: {
    orgId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    siteId?: string;
    promotionCode?: string;
  }): Promise<{ sessionId: string; url: string }> {
    // Validate URLs
    const validateUrl = (url: string) => {
      if (url.startsWith('javascript:') || url.startsWith('data:')) {
        throw new Error('Invalid URL');
      }
      try {
        new URL(url);
      } catch {
        throw new Error('Invalid URL');
      }
    };

    validateUrl(params.successUrl);
    validateUrl(params.cancelUrl);

    // Ensure customer exists
    const orgs = await this.db.query<{ id: string; stripe_customer_id: string | null; name: string }>(
      `SELECT id, stripe_customer_id, name FROM orgs WHERE id = $1 AND deleted_at IS NULL`,
      [params.orgId],
    );

    const org = orgs[0];
    if (!org) {
      throw new Error('Organization not found');
    }

    let customerId = org.stripe_customer_id;
    if (!customerId) {
      const result = await this.getOrCreateStripeCustomer(params.orgId, `${org.name}@placeholder.com`);
      customerId = result.customerId;
    }

    // Build checkout params
    const checkoutParams: any = {
      mode: 'subscription',
      customer: customerId,
      payment_method_types: ['card', 'link'],
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: {
        org_id: params.orgId,
        ...(params.siteId && { site_id: params.siteId }),
      },
      allow_promotion_codes: !params.promotionCode,
    };

    if (params.promotionCode) {
      checkoutParams.discounts = [{ promotion_code: params.promotionCode }];
    }

    const session = await this.stripe.checkout.sessions.create(checkoutParams);

    return { sessionId: session.id, url: session.url };
  }

  async getCheckoutSession(sessionId: string): Promise<{
    id: string;
    status: 'open' | 'complete' | 'expired';
    customerId: string;
    subscriptionId?: string;
    amountTotal: number;
    currency: string;
  } | null> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);
      return {
        id: session.id,
        status: session.status,
        customerId: session.customer,
        subscriptionId: session.subscription,
        amountTotal: session.amount_total,
        currency: session.currency,
      };
    } catch (error: any) {
      if (error?.code === 'resource_missing') {
        return null;
      }
      throw error;
    }
  }

  // ===========================================================================
  // SUBSCRIPTION
  // ===========================================================================

  async getOrgSubscription(orgId: string): Promise<Subscription | null> {
    const subscriptions = await this.db.query<Subscription>(
      `SELECT id, org_id as "orgId", stripe_subscription_id as "stripeSubscriptionId",
       stripe_customer_id as "stripeCustomerId", status, price_id as "priceId",
       current_period_start as "currentPeriodStart", current_period_end as "currentPeriodEnd",
       cancel_at_period_end as "cancelAtPeriodEnd", canceled_at as "canceledAt",
       ended_at as "endedAt", created_at as "createdAt", updated_at as "updatedAt"
       FROM subscriptions WHERE org_id = $1 AND status != 'canceled'
       ORDER BY created_at DESC LIMIT 1`,
      [orgId],
    );

    return subscriptions[0] ?? null;
  }

  async cancelSubscription(orgId: string, params: {
    immediate?: boolean;
    feedback?: string;
    offerRetention?: boolean;
  }): Promise<{
    canceled: boolean;
    effectiveAt: string;
    retentionOfferAccepted?: boolean;
  }> {
    const subscription = await this.getOrgSubscription(orgId);
    if (!subscription) {
      throw new Error('No active subscription');
    }

    // Store feedback if provided
    if (params.feedback) {
      await this.db.execute(
        `UPDATE subscriptions SET cancellation_feedback = $1, updated_at = $2 WHERE id = $3`,
        [params.feedback, nowISO(), subscription.id],
      );
    }

    if (params.offerRetention) {
      // Return retention offer info
      return {
        canceled: false,
        effectiveAt: subscription.currentPeriodEnd,
        retentionOfferAccepted: undefined,
      };
    }

    if (params.immediate) {
      await this.stripe.subscriptions.cancel(subscription.stripeSubscriptionId);

      await this.db.execute(
        `UPDATE subscriptions SET status = 'canceled', ended_at = $1, updated_at = $2 WHERE id = $3`,
        [nowISO(), nowISO(), subscription.id],
      );

      return { canceled: true, effectiveAt: nowISO() };
    }

    // Cancel at period end
    await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await this.db.execute(
      `UPDATE subscriptions SET cancel_at_period_end = true, updated_at = $1 WHERE id = $2`,
      [nowISO(), subscription.id],
    );

    return { canceled: true, effectiveAt: subscription.currentPeriodEnd };
  }

  // ===========================================================================
  // ENTITLEMENTS
  // ===========================================================================

  async getOrgEntitlements(orgId: string): Promise<Entitlements> {
    // Check cache
    const cacheKey = `entitlements:${orgId}`;
    const cached = await this.kv.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const entitlements = await this.computeEntitlements(orgId);

    // Cache for 5 minutes
    await this.kv.put(cacheKey, JSON.stringify(entitlements), { expirationTtl: 300 });

    return entitlements;
  }

  async refreshEntitlements(orgId: string): Promise<Entitlements> {
    // Clear cache
    await this.kv.delete(`entitlements:${orgId}`);
    return this.getOrgEntitlements(orgId);
  }

  private async computeEntitlements(orgId: string): Promise<Entitlements> {
    const subscription = await this.getOrgSubscription(orgId);

    // Free entitlements
    if (!subscription) {
      return {
        orgId,
        plan: 'free',
        ...ENTITLEMENTS.FREE,
        validUntil: null,
      };
    }

    // Check if past_due too long (60+ days)
    if (subscription.status === 'past_due') {
      const dunning = await this.getDunningState(orgId);
      if (dunning.daysPastDue >= DUNNING.DOWNGRADE_DAYS) {
        return {
          orgId,
          plan: 'free',
          ...ENTITLEMENTS.FREE,
          validUntil: null,
        };
      }
    }

    // Canceled subscription
    if (subscription.status === 'canceled') {
      return {
        orgId,
        plan: 'free',
        ...ENTITLEMENTS.FREE,
        validUntil: null,
      };
    }

    // Active or grace period
    return {
      orgId,
      plan: 'paid',
      ...ENTITLEMENTS.PAID,
      validUntil: subscription.currentPeriodEnd,
    };
  }

  // ===========================================================================
  // WEBHOOK HANDLERS
  // ===========================================================================

  async handleCheckoutCompleted(event: {
    id: string;
    data: { object: any };
  }): Promise<void> {
    const session = event.data.object;
    const orgId = session.metadata?.org_id;
    const siteId = session.metadata?.site_id;

    if (!orgId) {
      console.error('Missing org_id in checkout metadata');
      return;
    }

    // Check idempotency
    const idempKey = `checkout:${event.id}`;
    if (await this.kv.get(idempKey)) {
      return;
    }

    // Get subscription details
    const stripeSub = await this.stripe.subscriptions.retrieve(session.subscription);

    // Upsert subscription record
    const existingSub = await this.getOrgSubscription(orgId);

    if (existingSub) {
      await this.db.execute(
        `UPDATE subscriptions SET stripe_subscription_id = $1, status = 'active',
         current_period_start = $2, current_period_end = $3, updated_at = $4 WHERE id = $5`,
        [
          session.subscription,
          new Date(stripeSub.current_period_start * 1000).toISOString(),
          new Date(stripeSub.current_period_end * 1000).toISOString(),
          nowISO(),
          existingSub.id,
        ],
      );
    } else {
      await this.db.execute(
        `INSERT INTO subscriptions (id, org_id, stripe_subscription_id, stripe_customer_id,
         status, price_id, current_period_start, current_period_end, cancel_at_period_end,
         created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          generateId(),
          orgId,
          session.subscription,
          session.customer,
          'active',
          stripeSub.items.data[0]?.price?.id,
          new Date(stripeSub.current_period_start * 1000).toISOString(),
          new Date(stripeSub.current_period_end * 1000).toISOString(),
          false,
          nowISO(),
          nowISO(),
        ],
      );
    }

    // Update org status
    await this.db.execute(
      `UPDATE orgs SET subscription_status = 'active', updated_at = $1 WHERE id = $2`,
      [nowISO(), orgId],
    );

    // Refresh entitlements
    await this.refreshEntitlements(orgId);

    // Call sale webhook if configured
    if (this.saleWebhookUrl) {
      await this.callSaleWebhook({
        site_id: siteId,
        org_id: orgId,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        amount: session.amount_total,
        currency: session.currency,
        timestamp: nowISO(),
      });
    }

    // Mark idempotency
    await this.kv.put(idempKey, nowISO(), { expirationTtl: 86400 * 7 });
  }

  async handleSubscriptionUpdated(event: {
    id: string;
    data: { object: any };
  }): Promise<void> {
    const stripeSub = event.data.object;

    // Find subscription by stripe ID
    const subs = await this.db.query<{ id: string; org_id: string }>(
      `SELECT id, org_id FROM subscriptions WHERE stripe_subscription_id = $1`,
      [stripeSub.id],
    );

    const sub = subs[0];
    if (!sub) {
      return;
    }

    // Update subscription
    await this.db.execute(
      `UPDATE subscriptions SET status = $1, current_period_start = $2,
       current_period_end = $3, cancel_at_period_end = $4, updated_at = $5 WHERE id = $6`,
      [
        stripeSub.status,
        new Date(stripeSub.current_period_start * 1000).toISOString(),
        new Date(stripeSub.current_period_end * 1000).toISOString(),
        stripeSub.cancel_at_period_end,
        nowISO(),
        sub.id,
      ],
    );

    // Refresh entitlements
    await this.refreshEntitlements(sub.org_id);
  }

  async handleSubscriptionDeleted(event: {
    id: string;
    data: { object: any };
  }): Promise<void> {
    const stripeSub = event.data.object;

    const subs = await this.db.query<{ id: string; org_id: string }>(
      `SELECT id, org_id FROM subscriptions WHERE stripe_subscription_id = $1`,
      [stripeSub.id],
    );

    const sub = subs[0];
    if (!sub) {
      return;
    }

    await this.db.execute(
      `UPDATE subscriptions SET status = 'canceled', ended_at = $1, updated_at = $2 WHERE id = $3`,
      [nowISO(), nowISO(), sub.id],
    );

    await this.db.execute(
      `UPDATE orgs SET subscription_status = 'cancelled', updated_at = $1 WHERE id = $2`,
      [nowISO(), sub.org_id],
    );

    await this.refreshEntitlements(sub.org_id);
  }

  async handleInvoicePaid(event: {
    id: string;
    data: { object: any };
  }): Promise<void> {
    const invoice = event.data.object;

    // Check idempotency
    const idempKey = `invoice:${invoice.id}`;
    if (await this.kv.get(idempKey)) {
      return;
    }

    // Store invoice
    await this.db.execute(
      `INSERT INTO invoices (id, stripe_invoice_id, stripe_customer_id, stripe_subscription_id,
       amount_paid, currency, status, paid_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (stripe_invoice_id) DO UPDATE SET status = $7, paid_at = $8`,
      [
        generateId(),
        invoice.id,
        invoice.customer,
        invoice.subscription,
        invoice.amount_paid,
        invoice.currency,
        'paid',
        nowISO(),
        nowISO(),
      ],
    );

    // Reset dunning if subscription exists
    if (invoice.subscription) {
      const subs = await this.db.query<{ id: string; org_id: string }>(
        `SELECT id, org_id FROM subscriptions WHERE stripe_subscription_id = $1`,
        [invoice.subscription],
      );

      const sub = subs[0];
      if (sub) {
        await this.db.execute(
          `UPDATE subscriptions SET status = 'active', last_payment_failed_at = NULL,
           last_dunning_stage = 0, updated_at = $1 WHERE id = $2`,
          [nowISO(), sub.id],
        );

        await this.refreshEntitlements(sub.org_id);
      }
    }

    await this.kv.put(idempKey, nowISO(), { expirationTtl: 86400 * 7 });
  }

  async handleInvoicePaymentFailed(event: {
    id: string;
    data: { object: any };
  }): Promise<void> {
    const invoice = event.data.object;

    if (!invoice.subscription) {
      return;
    }

    const subs = await this.db.query<{ id: string; org_id: string }>(
      `SELECT id, org_id FROM subscriptions WHERE stripe_subscription_id = $1`,
      [invoice.subscription],
    );

    const sub = subs[0];
    if (!sub) {
      return;
    }

    // Update subscription status
    await this.db.execute(
      `UPDATE subscriptions SET status = 'past_due', last_payment_failed_at = COALESCE(last_payment_failed_at, $1),
       updated_at = $2 WHERE id = $3`,
      [nowISO(), nowISO(), sub.id],
    );

    // Process dunning
    await this.processDunning(sub.org_id);
  }

  // ===========================================================================
  // DUNNING
  // ===========================================================================

  async getDunningState(orgId: string): Promise<DunningState> {
    const subs = await this.db.query<{
      status: string;
      last_payment_failed_at: string | null;
      last_dunning_stage: number;
      last_reminder_at: string | null;
    }>(
      `SELECT status, last_payment_failed_at, last_dunning_stage, last_reminder_at
       FROM subscriptions WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [orgId],
    );

    const sub = subs[0];

    if (!sub || sub.status !== 'past_due' || !sub.last_payment_failed_at) {
      return {
        orgId,
        stage: 0,
        daysPastDue: 0,
        lastInvoiceId: null,
        lastReminderAt: null,
        downgradeAt: null,
      };
    }

    const failedAt = new Date(sub.last_payment_failed_at);
    const daysPastDue = Math.floor((Date.now() - failedAt.getTime()) / (1000 * 60 * 60 * 24));

    let stage: 0 | 1 | 2 | 3 | 4 = 0;
    if (daysPastDue >= 60) stage = 4;
    else if (daysPastDue >= 30) stage = 3;
    else if (daysPastDue >= 14) stage = 2;
    else if (daysPastDue >= 7) stage = 1;

    return {
      orgId,
      stage,
      daysPastDue,
      lastInvoiceId: null,
      lastReminderAt: sub.last_reminder_at,
      downgradeAt: daysPastDue >= 60 ? failedAt.toISOString() : null,
    };
  }

  async processDunning(orgId: string): Promise<void> {
    const state = await this.getDunningState(orgId);

    if (state.stage === 0) {
      return;
    }

    // Check if we've already processed this stage
    const subs = await this.db.query<{ id: string; last_dunning_stage: number }>(
      `SELECT id, last_dunning_stage FROM subscriptions WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [orgId],
    );

    const sub = subs[0];
    if (!sub) return;

    if (sub.last_dunning_stage >= state.stage) {
      // Already processed this stage
      return;
    }

    // Send reminder (would integrate with notification service)
    console.log(`Sending dunning reminder for org ${orgId}, stage ${state.stage}`);

    // Update dunning stage
    await this.db.execute(
      `UPDATE subscriptions SET last_dunning_stage = $1, last_reminder_at = $2, updated_at = $3 WHERE id = $4`,
      [state.stage, nowISO(), nowISO(), sub.id],
    );

    // If stage 4 (60+ days), downgrade entitlements
    if (state.stage === 4) {
      await this.refreshEntitlements(orgId);
    }
  }

  // ===========================================================================
  // BILLING PORTAL
  // ===========================================================================

  async createBillingPortalSession(orgId: string, returnUrl: string): Promise<{ url: string }> {
    // Validate URL
    if (returnUrl.startsWith('javascript:') || returnUrl.startsWith('data:')) {
      throw new Error('Invalid URL');
    }

    const customer = await this.getStripeCustomer(orgId);
    if (!customer) {
      throw new Error('No billing account');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  // ===========================================================================
  // USAGE TRACKING
  // ===========================================================================

  async recordUsageEvent(params: {
    orgId: string;
    eventType: string;
    quantity: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const dedupeKey = params.metadata?.dedupe_key;

    if (dedupeKey) {
      const existing = await this.kv.get(`usage:dedupe:${dedupeKey}`);
      if (existing) {
        return;
      }
    }

    await this.db.execute(
      `INSERT INTO usage_events (id, org_id, event_type, quantity, metadata, timestamp, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        generateId(),
        params.orgId,
        params.eventType,
        params.quantity,
        JSON.stringify(params.metadata ?? {}),
        Date.now(),
        nowISO(),
      ],
    );

    if (dedupeKey) {
      await this.kv.put(`usage:dedupe:${dedupeKey}`, nowISO(), { expirationTtl: 86400 });
    }
  }

  async getUsageSummary(orgId: string, periodStart: string, periodEnd: string): Promise<{
    orgId: string;
    periodStart: string;
    periodEnd: string;
    events: Array<{ eventType: string; totalQuantity: number; count: number }>;
  }> {
    const startTs = new Date(periodStart).getTime();
    const endTs = new Date(periodEnd).getTime();

    const events = await this.db.query<{ event_type: string; total_quantity: number; count: number }>(
      `SELECT event_type, SUM(quantity) as total_quantity, COUNT(*) as count
       FROM usage_events WHERE org_id = $1 AND timestamp >= $2 AND timestamp <= $3
       GROUP BY event_type`,
      [orgId, startTs, endTs],
    );

    return {
      orgId,
      periodStart,
      periodEnd,
      events: events.map((e) => ({
        eventType: e.event_type,
        totalQuantity: Number(e.total_quantity),
        count: Number(e.count),
      })),
    };
  }

  // ===========================================================================
  // SALE WEBHOOK
  // ===========================================================================

  private async callSaleWebhook(payload: Record<string, any>): Promise<void> {
    if (!this.saleWebhookUrl) return;

    const body = JSON.stringify(payload);
    const signature = await this.computeWebhookSignature(body);

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(this.saleWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
          },
          body,
        });

        if (response.ok) {
          return;
        }

        lastError = new Error(`Sale webhook failed: ${response.status}`);
      } catch (error) {
        lastError = error as Error;
      }

      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }

    console.error('Sale webhook failed after retries:', lastError);
  }

  private async computeWebhookSignature(body: string): Promise<string> {
    if (!this.saleWebhookSecret) return '';

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.saleWebhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
