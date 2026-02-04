/**
 * Billing service
 * Stripe integration, entitlements, dunning
 */
import type { AppContext } from '../types.js';
import {
  generateUuid,
  NotFoundError,
  ExternalServiceError,
  PRICING,
  DUNNING,
  SUBSCRIPTION_STATES,
  AUDIT_ACTIONS,
  type SubscriptionState,
} from '@project-sites/shared';
import type Stripe from 'stripe';

export class BillingService {
  constructor(private c: AppContext) {}

  private get db() {
    return this.c.get('db');
  }

  private get stripe() {
    return this.c.get('stripe');
  }

  private get env() {
    return this.c.env;
  }

  // ============================================================================
  // CUSTOMER MANAGEMENT
  // ============================================================================

  async getOrCreateStripeCustomer(orgId: string, email?: string): Promise<string> {
    // Check if org already has a Stripe customer
    const { data: org } = await this.db
      .from('orgs')
      .select('stripe_customer_id, name')
      .eq('id', orgId)
      .single();

    if (org?.stripe_customer_id) {
      return org.stripe_customer_id;
    }

    // Create new Stripe customer
    const customer = await this.stripe.customers.create({
      email,
      name: org?.name,
      metadata: { org_id: orgId },
    });

    // Save customer ID
    await this.db
      .from('orgs')
      .update({
        stripe_customer_id: customer.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orgId);

    return customer.id;
  }

  // ============================================================================
  // CHECKOUT
  // ============================================================================

  async createCheckoutSession(params: {
    org_id: string;
    site_id: string;
    success_url: string;
    cancel_url: string;
    customer_email?: string;
  }): Promise<{ checkout_url: string; session_id: string }> {
    const customerId = await this.getOrCreateStripeCustomer(
      params.org_id,
      params.customer_email
    );

    // Create Stripe Checkout session (optimized for Stripe Link)
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card', 'link'],
      line_items: [
        {
          price_data: {
            currency: PRICING.CURRENCY,
            unit_amount: PRICING.MONTHLY_CENTS,
            recurring: { interval: 'month' },
            product_data: {
              name: 'Project Sites Pro',
              description: 'Remove top bar + custom domains',
            },
          },
          quantity: 1,
        },
      ],
      success_url: params.success_url,
      cancel_url: params.cancel_url,
      metadata: {
        org_id: params.org_id,
        site_id: params.site_id,
      },
      subscription_data: {
        metadata: {
          org_id: params.org_id,
          site_id: params.site_id,
        },
      },
      // Enable Stripe Link
      payment_method_options: {
        link: { persistent_token: undefined },
      },
      // Allow promotion codes
      allow_promotion_codes: true,
    });

    // Log audit event
    await this.logAudit(params.org_id, AUDIT_ACTIONS.BILLING_CHECKOUT_STARTED, 'checkout', session.id, {
      site_id: params.site_id,
    });

    return {
      checkout_url: session.url!,
      session_id: session.id,
    };
  }

  // ============================================================================
  // BILLING PORTAL
  // ============================================================================

  async createBillingPortalSession(params: {
    org_id: string;
    return_url: string;
  }): Promise<{ portal_url: string }> {
    // Get Stripe customer ID
    const { data: org } = await this.db
      .from('orgs')
      .select('stripe_customer_id')
      .eq('id', params.org_id)
      .single();

    if (!org?.stripe_customer_id) {
      throw new NotFoundError('Billing account');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: params.return_url,
    });

    return { portal_url: session.url };
  }

  // ============================================================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================================================

  async getOrgSubscription(orgId: string): Promise<any | null> {
    const { data: subscription } = await this.db
      .from('subscriptions')
      .select('*')
      .eq('org_id', orgId)
      .is('ended_at', null)
      .single();

    return subscription;
  }

  async cancelSubscription(orgId: string, reason?: string): Promise<void> {
    const { data: subscription } = await this.db
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('org_id', orgId)
      .is('ended_at', null)
      .single();

    if (!subscription?.stripe_subscription_id) {
      throw new NotFoundError('Subscription');
    }

    // Cancel at period end (not immediately)
    await this.stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
      metadata: { cancel_reason: reason },
    });

    // Update local record
    await this.db
      .from('subscriptions')
      .update({
        cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', orgId);

    await this.logAudit(orgId, AUDIT_ACTIONS.BILLING_SUBSCRIPTION_CANCELED, 'subscription', subscription.stripe_subscription_id, {
      reason,
    });
  }

  async applyRetentionOffer(orgId: string): Promise<void> {
    const { data: subscription } = await this.db
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('org_id', orgId)
      .is('ended_at', null)
      .single();

    if (!subscription?.stripe_subscription_id) {
      throw new NotFoundError('Subscription');
    }

    // Get current subscription from Stripe
    const stripeSub = await this.stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
    const itemId = stripeSub.items.data[0]?.id;

    if (!itemId) {
      throw new ExternalServiceError('Stripe', 'No subscription items found');
    }

    // Update to retention price
    await this.stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: false,
      items: [
        {
          id: itemId,
          price_data: {
            currency: PRICING.CURRENCY,
            unit_amount: PRICING.RETENTION_MONTHLY_CENTS,
            recurring: { interval: 'month' },
            product_data: {
              name: 'Project Sites Pro (Retention Offer)',
            },
          },
        },
      ],
      metadata: {
        retention_offer_applied: 'true',
        retention_offer_expires: new Date(
          Date.now() + PRICING.RETENTION_DURATION_MONTHS * 30 * 24 * 60 * 60 * 1000
        ).toISOString(),
      },
    });

    // Update local record
    await this.db
      .from('subscriptions')
      .update({
        monthly_amount_cents: PRICING.RETENTION_MONTHLY_CENTS,
        cancel_at_period_end: false,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', orgId);
  }

  // ============================================================================
  // WEBHOOK HANDLERS
  // ============================================================================

  async handleCheckoutCompleted(session: any): Promise<void> {
    const orgId = session.metadata?.org_id;
    const siteId = session.metadata?.site_id;

    if (!orgId || !session.subscription) {
      console.error('Missing org_id or subscription in checkout session');
      return;
    }

    // Get subscription details
    const subscription = await this.stripe.subscriptions.retrieve(
      session.subscription as string
    );

    // Create or update subscription record
    await this.upsertSubscription(orgId, subscription);

    // Log audit event
    await this.logAudit(orgId, AUDIT_ACTIONS.BILLING_SUBSCRIPTION_CREATED, 'subscription', subscription.id, {
      site_id: siteId,
    });

    // Call sale webhook if configured
    if (this.env.SALE_WEBHOOK_URL) {
      await this.callSaleWebhook({
        site_id: siteId,
        org_id: orgId,
        stripe_customer_id: session.customer,
        stripe_subscription_id: subscription.id,
        plan: 'pro',
        amount_cents: PRICING.MONTHLY_CENTS,
        currency: PRICING.CURRENCY,
        timestamp: new Date().toISOString(),
        request_id: this.c.get('request_id'),
        trace_id: this.c.get('trace_id'),
      });
    }
  }

  async handleSubscriptionUpdated(subscription: any): Promise<void> {
    const orgId = subscription.metadata?.org_id;
    if (!orgId) {
      // Try to find by customer ID
      const { data: org } = await this.db
        .from('orgs')
        .select('id')
        .eq('stripe_customer_id', subscription.customer)
        .single();

      if (!org) {
        console.error('Could not find org for subscription', subscription.id);
        return;
      }

      await this.upsertSubscription(org.id, subscription);
      await this.logAudit(org.id, AUDIT_ACTIONS.BILLING_SUBSCRIPTION_UPDATED, 'subscription', subscription.id, {});
    } else {
      await this.upsertSubscription(orgId, subscription);
      await this.logAudit(orgId, AUDIT_ACTIONS.BILLING_SUBSCRIPTION_UPDATED, 'subscription', subscription.id, {});
    }
  }

  async handleSubscriptionDeleted(subscription: any): Promise<void> {
    const orgId = subscription.metadata?.org_id;

    // Mark subscription as ended
    await this.db
      .from('subscriptions')
      .update({
        state: SUBSCRIPTION_STATES.CANCELED,
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_subscription_id', subscription.id);

    if (orgId) {
      await this.logAudit(orgId, AUDIT_ACTIONS.BILLING_SUBSCRIPTION_CANCELED, 'subscription', subscription.id, {});
    }
  }

  async handleInvoicePaid(invoice: any): Promise<void> {
    const subscriptionId = invoice.subscription;
    if (!subscriptionId) return;

    // Find org
    const { data: subscription } = await this.db
      .from('subscriptions')
      .select('org_id')
      .eq('stripe_subscription_id', subscriptionId)
      .single();

    if (!subscription) return;

    // Store invoice
    await this.db.from('invoices').upsert({
      id: generateUuid(),
      org_id: subscription.org_id,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
      amount_due: invoice.amount_due,
      amount_paid: invoice.amount_paid,
      currency: invoice.currency,
      status: invoice.status,
      due_date: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
      paid_at: invoice.paid_at ? new Date(invoice.paid_at * 1000).toISOString() : null,
      hosted_invoice_url: invoice.hosted_invoice_url,
      invoice_pdf: invoice.invoice_pdf,
    });

    await this.logAudit(subscription.org_id, AUDIT_ACTIONS.BILLING_PAYMENT_SUCCEEDED, 'invoice', invoice.id, {
      amount: invoice.amount_paid,
    });
  }

  async handlePaymentFailed(invoice: any): Promise<void> {
    const subscriptionId = invoice.subscription;
    if (!subscriptionId) return;

    // Find org
    const { data: subscription } = await this.db
      .from('subscriptions')
      .select('org_id')
      .eq('stripe_subscription_id', subscriptionId)
      .single();

    if (!subscription) return;

    // Update subscription state
    await this.db
      .from('subscriptions')
      .update({
        state: SUBSCRIPTION_STATES.PAST_DUE,
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_subscription_id', subscriptionId);

    await this.logAudit(subscription.org_id, AUDIT_ACTIONS.BILLING_PAYMENT_FAILED, 'invoice', invoice.id, {
      amount: invoice.amount_due,
    });

    // Queue dunning notification
    await this.c.env.WORKFLOW_QUEUE.send({
      type: 'dunning_notification',
      payload: {
        org_id: subscription.org_id,
        invoice_id: invoice.id,
        amount_due: invoice.amount_due,
      },
      metadata: {
        request_id: this.c.get('request_id'),
        trace_id: this.c.get('trace_id'),
        attempt: 1,
        max_attempts: 3,
        scheduled_at: new Date().toISOString(),
      },
    });
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private async upsertSubscription(orgId: string, subscription: Stripe.Subscription): Promise<void> {
    const item = subscription.items.data[0];

    await this.db.from('subscriptions').upsert({
      id: generateUuid(),
      org_id: orgId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer as string,
      stripe_price_id: item?.price.id || '',
      state: this.mapStripeStatus(subscription.status),
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      canceled_at: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000).toISOString()
        : null,
      monthly_amount_cents: item?.price.unit_amount || PRICING.MONTHLY_CENTS,
      currency: item?.price.currency || PRICING.CURRENCY,
      updated_at: new Date().toISOString(),
    });
  }

  private mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionState {
    const mapping: Record<string, SubscriptionState> = {
      active: 'active',
      past_due: 'past_due',
      canceled: 'canceled',
      unpaid: 'unpaid',
      trialing: 'trialing',
      paused: 'paused',
      incomplete: 'unpaid',
      incomplete_expired: 'canceled',
    };
    return mapping[status] || 'unpaid';
  }

  private async callSaleWebhook(payload: any): Promise<void> {
    if (!this.env.SALE_WEBHOOK_URL) return;

    try {
      const response = await fetch(this.env.SALE_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': this.env.SALE_WEBHOOK_SECRET || '',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error('Sale webhook failed:', response.status);
      }
    } catch (error) {
      console.error('Sale webhook error:', error);
    }
  }

  private async logAudit(
    orgId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await this.db.from('audit_logs').insert({
      id: generateUuid(),
      org_id: orgId,
      actor_type: 'system',
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
      request_id: this.c.get('request_id'),
    });
  }
}
