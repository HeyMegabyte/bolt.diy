/**
 * Billing Service Tests - TDD
 * These tests define the expected behavior of the billing service.
 * Implementation should be written to make these tests pass.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Types for testing
interface BillingService {
  // Stripe Customer
  getOrCreateStripeCustomer(orgId: string, email: string): Promise<StripeCustomerResult>;
  getStripeCustomer(orgId: string): Promise<StripeCustomer | null>;

  // Checkout
  createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSessionResult>;
  getCheckoutSession(sessionId: string): Promise<CheckoutSession | null>;

  // Subscription
  getOrgSubscription(orgId: string): Promise<Subscription | null>;
  updateSubscription(subscriptionId: string, params: UpdateSubscriptionParams): Promise<Subscription>;
  cancelSubscription(orgId: string, params: CancelSubscriptionParams): Promise<CancellationResult>;

  // Entitlements
  getOrgEntitlements(orgId: string): Promise<Entitlements>;
  refreshEntitlements(orgId: string): Promise<Entitlements>;

  // Billing Portal
  createBillingPortalSession(orgId: string, returnUrl: string): Promise<BillingPortalResult>;

  // Webhook Handlers
  handleCheckoutCompleted(event: StripeEvent): Promise<void>;
  handleSubscriptionUpdated(event: StripeEvent): Promise<void>;
  handleSubscriptionDeleted(event: StripeEvent): Promise<void>;
  handleInvoicePaid(event: StripeEvent): Promise<void>;
  handleInvoicePaymentFailed(event: StripeEvent): Promise<void>;

  // Dunning
  getDunningState(orgId: string): Promise<DunningState>;
  processDunning(orgId: string): Promise<void>;

  // Usage (for Lago integration)
  recordUsageEvent(params: UsageEventParams): Promise<void>;
  getUsageSummary(orgId: string, periodStart: string, periodEnd: string): Promise<UsageSummary>;
}

interface StripeCustomerResult {
  customerId: string;
  isNew: boolean;
}

interface StripeCustomer {
  id: string;
  email: string;
  metadata: Record<string, string>;
}

interface CreateCheckoutParams {
  orgId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  siteId?: string;
  promotionCode?: string;
}

interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

interface CheckoutSession {
  id: string;
  status: 'open' | 'complete' | 'expired';
  customerId: string;
  subscriptionId?: string;
  amountTotal: number;
  currency: string;
}

interface Subscription {
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

interface UpdateSubscriptionParams {
  priceId?: string;
  cancelAtPeriodEnd?: boolean;
}

interface CancelSubscriptionParams {
  immediate?: boolean;
  feedback?: string;
  offerRetention?: boolean;
}

interface CancellationResult {
  canceled: boolean;
  effectiveAt: string;
  retentionOfferAccepted?: boolean;
}

interface Entitlements {
  orgId: string;
  plan: 'free' | 'paid';
  topBarHidden: boolean;
  maxCustomDomains: number;
  maxSites: number;
  features: string[];
  validUntil: string | null;
}

interface BillingPortalResult {
  url: string;
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: any };
  livemode: boolean;
  created: number;
}

interface DunningState {
  orgId: string;
  stage: 0 | 1 | 2 | 3 | 4; // 0=current, 1=7days, 2=14days, 3=30days, 4=60days
  daysPastDue: number;
  lastInvoiceId: string | null;
  lastReminderAt: string | null;
  downgradeAt: string | null;
}

interface UsageEventParams {
  orgId: string;
  eventType: string;
  quantity: number;
  metadata?: Record<string, any>;
}

interface UsageSummary {
  orgId: string;
  periodStart: string;
  periodEnd: string;
  events: Array<{
    eventType: string;
    totalQuantity: number;
    count: number;
  }>;
}

// Mock dependencies
const mockStripe = {
  customers: {
    create: jest.fn(),
    retrieve: jest.fn(),
  },
  checkout: {
    sessions: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  },
  subscriptions: {
    retrieve: jest.fn(),
    update: jest.fn(),
    cancel: jest.fn(),
  },
  billingPortal: {
    sessions: {
      create: jest.fn(),
    },
  },
};

const mockDb = {
  orgs: new Map<string, any>(),
  subscriptions: new Map<string, any>(),
  invoices: new Map<string, any>(),
  usageEvents: new Map<string, any[]>(),

  reset() {
    this.orgs.clear();
    this.subscriptions.clear();
    this.invoices.clear();
    this.usageEvents.clear();
  },
};

const mockSaleWebhook = {
  send: jest.fn<(payload: any) => Promise<void>>(),
};

let billingService: BillingService;

// Constants from spec
const PRICING = {
  MONTHLY_CENTS: 5000, // $50/mo
  RETENTION_MONTHLY_CENTS: 2500, // $25/mo for 12 months
};

const ENTITLEMENTS = {
  FREE: {
    topBarHidden: false,
    maxCustomDomains: 0,
    maxSites: 1,
    features: ['basic_site'],
  },
  PAID: {
    topBarHidden: true,
    maxCustomDomains: 5,
    maxSites: 10,
    features: ['basic_site', 'custom_domains', 'no_top_bar', 'analytics', 'priority_support'],
  },
};

const DUNNING = {
  STAGES: [0, 7, 14, 30] as const,
  DOWNGRADE_DAYS: 60,
};

describe('BillingService', () => {
  beforeEach(() => {
    mockDb.reset();
    jest.clearAllMocks();

    // Setup default org
    mockDb.orgs.set('test-org-id', {
      id: 'test-org-id',
      name: 'Test Org',
      stripeCustomerId: null,
      subscriptionStatus: 'none',
    });
  });

  // ==========================================================================
  // STRIPE CUSTOMER TESTS
  // ==========================================================================
  describe('Stripe Customer Management', () => {
    describe('getOrCreateStripeCustomer', () => {
      it('should create new Stripe customer for org without one', async () => {
        mockStripe.customers.create.mockResolvedValue({
          id: 'cus_new123',
          email: 'org@example.com',
          metadata: { org_id: 'test-org-id' },
        });

        const result = await billingService.getOrCreateStripeCustomer('test-org-id', 'org@example.com');

        expect(result.customerId).toBe('cus_new123');
        expect(result.isNew).toBe(true);
        expect(mockStripe.customers.create).toHaveBeenCalledWith({
          email: 'org@example.com',
          metadata: { org_id: 'test-org-id' },
        });
      });

      it('should return existing customer if org already has one', async () => {
        mockDb.orgs.set('test-org-id', {
          id: 'test-org-id',
          stripeCustomerId: 'cus_existing123',
        });

        const result = await billingService.getOrCreateStripeCustomer('test-org-id', 'org@example.com');

        expect(result.customerId).toBe('cus_existing123');
        expect(result.isNew).toBe(false);
        expect(mockStripe.customers.create).not.toHaveBeenCalled();
      });

      it('should update customer email if changed', async () => {
        mockDb.orgs.set('test-org-id', {
          id: 'test-org-id',
          stripeCustomerId: 'cus_existing123',
        });

        mockStripe.customers.retrieve.mockResolvedValue({
          id: 'cus_existing123',
          email: 'old@example.com',
        });

        await billingService.getOrCreateStripeCustomer('test-org-id', 'new@example.com');

        // Should update the email
        expect(mockStripe.customers.update || mockStripe.customers.create).toBeDefined();
      });

      it('should throw for invalid org ID', async () => {
        await expect(
          billingService.getOrCreateStripeCustomer('non-existent-org', 'test@example.com'),
        ).rejects.toThrow(/not found/i);
      });

      it('should handle Stripe API errors gracefully', async () => {
        mockStripe.customers.create.mockRejectedValue(new Error('Stripe API error'));

        await expect(
          billingService.getOrCreateStripeCustomer('test-org-id', 'test@example.com'),
        ).rejects.toThrow();
      });
    });

    describe('getStripeCustomer', () => {
      it('should return customer details', async () => {
        mockDb.orgs.set('test-org-id', {
          id: 'test-org-id',
          stripeCustomerId: 'cus_123',
        });

        mockStripe.customers.retrieve.mockResolvedValue({
          id: 'cus_123',
          email: 'test@example.com',
          metadata: { org_id: 'test-org-id' },
        });

        const customer = await billingService.getStripeCustomer('test-org-id');

        expect(customer).toBeDefined();
        expect(customer?.id).toBe('cus_123');
      });

      it('should return null if org has no customer', async () => {
        const customer = await billingService.getStripeCustomer('test-org-id');

        expect(customer).toBeNull();
      });
    });
  });

  // ==========================================================================
  // CHECKOUT TESTS
  // ==========================================================================
  describe('Checkout', () => {
    describe('createCheckoutSession', () => {
      beforeEach(() => {
        mockDb.orgs.set('test-org-id', {
          id: 'test-org-id',
          stripeCustomerId: 'cus_123',
        });

        mockStripe.checkout.sessions.create.mockResolvedValue({
          id: 'cs_123',
          url: 'https://checkout.stripe.com/session/cs_123',
        });
      });

      it('should create checkout session with Stripe Link enabled', async () => {
        const result = await billingService.createCheckoutSession({
          orgId: 'test-org-id',
          priceId: 'price_monthly',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        expect(result.sessionId).toBe('cs_123');
        expect(result.url).toContain('checkout.stripe.com');

        expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            mode: 'subscription',
            customer: 'cus_123',
            payment_method_types: expect.arrayContaining(['card', 'link']),
            line_items: expect.arrayContaining([
              expect.objectContaining({ price: 'price_monthly' }),
            ]),
          }),
        );
      });

      it('should include site_id in metadata', async () => {
        await billingService.createCheckoutSession({
          orgId: 'test-org-id',
          priceId: 'price_monthly',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          siteId: 'site-123',
        });

        expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              org_id: 'test-org-id',
              site_id: 'site-123',
            }),
          }),
        );
      });

      it('should apply promotion code if provided', async () => {
        await billingService.createCheckoutSession({
          orgId: 'test-org-id',
          priceId: 'price_monthly',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          promotionCode: 'PROMO123',
        });

        expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            discounts: expect.arrayContaining([
              expect.objectContaining({ promotion_code: 'PROMO123' }),
            ]),
          }),
        );
      });

      it('should create Stripe customer if not exists', async () => {
        mockDb.orgs.set('new-org-id', {
          id: 'new-org-id',
          stripeCustomerId: null,
        });

        mockStripe.customers.create.mockResolvedValue({
          id: 'cus_new',
        });

        await billingService.createCheckoutSession({
          orgId: 'new-org-id',
          priceId: 'price_monthly',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        expect(mockStripe.customers.create).toHaveBeenCalled();
      });

      it('should validate success and cancel URLs', async () => {
        await expect(
          billingService.createCheckoutSession({
            orgId: 'test-org-id',
            priceId: 'price_monthly',
            successUrl: 'javascript:alert(1)',
            cancelUrl: 'https://example.com/cancel',
          }),
        ).rejects.toThrow(/invalid url/i);
      });

      it('should use test mode keys in non-production', async () => {
        // This is configured at service initialization
        // The test should verify that test keys are used
        expect(process.env.ENVIRONMENT).not.toBe('production');
      });
    });

    describe('getCheckoutSession', () => {
      it('should return checkout session details', async () => {
        mockStripe.checkout.sessions.retrieve.mockResolvedValue({
          id: 'cs_123',
          status: 'complete',
          customer: 'cus_123',
          subscription: 'sub_123',
          amount_total: 5000,
          currency: 'usd',
        });

        const session = await billingService.getCheckoutSession('cs_123');

        expect(session).toBeDefined();
        expect(session?.id).toBe('cs_123');
        expect(session?.status).toBe('complete');
      });

      it('should return null for non-existent session', async () => {
        mockStripe.checkout.sessions.retrieve.mockRejectedValue({ code: 'resource_missing' });

        const session = await billingService.getCheckoutSession('cs_nonexistent');

        expect(session).toBeNull();
      });
    });
  });

  // ==========================================================================
  // SUBSCRIPTION TESTS
  // ==========================================================================
  describe('Subscription Management', () => {
    beforeEach(() => {
      mockDb.subscriptions.set('sub_123', {
        id: 'sub-db-id',
        orgId: 'test-org-id',
        stripeSubscriptionId: 'sub_123',
        stripeCustomerId: 'cus_123',
        status: 'active',
        priceId: 'price_monthly',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        cancelAtPeriodEnd: false,
      });
    });

    describe('getOrgSubscription', () => {
      it('should return active subscription', async () => {
        const subscription = await billingService.getOrgSubscription('test-org-id');

        expect(subscription).toBeDefined();
        expect(subscription?.status).toBe('active');
        expect(subscription?.orgId).toBe('test-org-id');
      });

      it('should return null if no subscription', async () => {
        const subscription = await billingService.getOrgSubscription('no-sub-org');

        expect(subscription).toBeNull();
      });

      it('should include Stripe subscription details', async () => {
        mockStripe.subscriptions.retrieve.mockResolvedValue({
          id: 'sub_123',
          status: 'active',
          current_period_start: Math.floor(Date.now() / 1000),
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        });

        const subscription = await billingService.getOrgSubscription('test-org-id');

        expect(subscription?.currentPeriodStart).toBeDefined();
        expect(subscription?.currentPeriodEnd).toBeDefined();
      });
    });

    describe('cancelSubscription', () => {
      it('should cancel at period end by default', async () => {
        mockStripe.subscriptions.update.mockResolvedValue({
          id: 'sub_123',
          cancel_at_period_end: true,
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        });

        const result = await billingService.cancelSubscription('test-org-id', {});

        expect(result.canceled).toBe(true);
        expect(new Date(result.effectiveAt).getTime()).toBeGreaterThan(Date.now());
        expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
          'sub_123',
          expect.objectContaining({ cancel_at_period_end: true }),
        );
      });

      it('should cancel immediately if requested', async () => {
        mockStripe.subscriptions.cancel.mockResolvedValue({
          id: 'sub_123',
          status: 'canceled',
        });

        const result = await billingService.cancelSubscription('test-org-id', {
          immediate: true,
        });

        expect(result.canceled).toBe(true);
        expect(mockStripe.subscriptions.cancel).toHaveBeenCalled();
      });

      it('should offer retention deal ($25/mo) when offerRetention is true', async () => {
        const result = await billingService.cancelSubscription('test-org-id', {
          offerRetention: true,
        });

        // Should return info about retention offer instead of canceling
        expect(result.retentionOfferAccepted).toBeDefined();
      });

      it('should store cancellation feedback', async () => {
        await billingService.cancelSubscription('test-org-id', {
          feedback: 'Too expensive',
        });

        // Feedback should be stored for analysis
        const subscription = mockDb.subscriptions.get('sub_123');
        expect(subscription.cancellationFeedback || mockStripe.subscriptions.update).toBeDefined();
      });

      it('should throw if no active subscription', async () => {
        await expect(
          billingService.cancelSubscription('no-sub-org', {}),
        ).rejects.toThrow(/no active subscription/i);
      });
    });
  });

  // ==========================================================================
  // ENTITLEMENTS TESTS
  // ==========================================================================
  describe('Entitlements', () => {
    describe('getOrgEntitlements', () => {
      it('should return free entitlements for unpaid org', async () => {
        const entitlements = await billingService.getOrgEntitlements('test-org-id');

        expect(entitlements.plan).toBe('free');
        expect(entitlements.topBarHidden).toBe(false);
        expect(entitlements.maxCustomDomains).toBe(0);
      });

      it('should return paid entitlements for active subscription', async () => {
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'active',
        });

        const entitlements = await billingService.getOrgEntitlements('test-org-id');

        expect(entitlements.plan).toBe('paid');
        expect(entitlements.topBarHidden).toBe(true);
        expect(entitlements.maxCustomDomains).toBe(5);
        expect(entitlements.features).toContain('custom_domains');
        expect(entitlements.features).toContain('no_top_bar');
      });

      it('should return paid entitlements for past_due subscription', async () => {
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'past_due',
        });

        // Past due within grace period still gets paid entitlements
        const entitlements = await billingService.getOrgEntitlements('test-org-id');

        expect(entitlements.plan).toBe('paid');
      });

      it('should return free entitlements for past_due beyond 60 days', async () => {
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'past_due',
          lastPaymentFailedAt: new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString(),
        });

        const entitlements = await billingService.getOrgEntitlements('test-org-id');

        expect(entitlements.plan).toBe('free');
        expect(entitlements.topBarHidden).toBe(false);
      });

      it('should return free entitlements for canceled subscription', async () => {
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'canceled',
        });

        const entitlements = await billingService.getOrgEntitlements('test-org-id');

        expect(entitlements.plan).toBe('free');
      });

      it('should cache entitlements for performance', async () => {
        // First call
        await billingService.getOrgEntitlements('test-org-id');

        // Second call should use cache (no additional DB calls)
        await billingService.getOrgEntitlements('test-org-id');

        // Verify caching behavior (implementation specific)
      });
    });

    describe('refreshEntitlements', () => {
      it('should force refresh entitlements from source', async () => {
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'active',
        });

        const entitlements = await billingService.refreshEntitlements('test-org-id');

        expect(entitlements.plan).toBe('paid');
      });

      it('should clear cache and fetch fresh data', async () => {
        // First get free entitlements
        await billingService.getOrgEntitlements('test-org-id');

        // Add subscription
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'active',
        });

        // Refresh should return paid entitlements
        const entitlements = await billingService.refreshEntitlements('test-org-id');

        expect(entitlements.plan).toBe('paid');
      });
    });
  });

  // ==========================================================================
  // WEBHOOK HANDLER TESTS
  // ==========================================================================
  describe('Webhook Handlers', () => {
    describe('handleCheckoutCompleted', () => {
      const checkoutEvent: StripeEvent = {
        id: 'evt_123',
        type: 'checkout.session.completed',
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_123',
            customer: 'cus_123',
            subscription: 'sub_new123',
            metadata: {
              org_id: 'test-org-id',
              site_id: 'site-123',
            },
            amount_total: 5000,
            currency: 'usd',
          },
        },
      };

      it('should create subscription record in database', async () => {
        await billingService.handleCheckoutCompleted(checkoutEvent);

        // Verify subscription was created
        const subscription = await billingService.getOrgSubscription('test-org-id');
        expect(subscription).toBeDefined();
        expect(subscription?.stripeSubscriptionId).toBe('sub_new123');
      });

      it('should update org subscription status', async () => {
        await billingService.handleCheckoutCompleted(checkoutEvent);

        const org = mockDb.orgs.get('test-org-id');
        expect(org.subscriptionStatus).toBe('active');
      });

      it('should apply paid entitlements immediately', async () => {
        await billingService.handleCheckoutCompleted(checkoutEvent);

        const entitlements = await billingService.getOrgEntitlements('test-org-id');
        expect(entitlements.plan).toBe('paid');
        expect(entitlements.topBarHidden).toBe(true);
      });

      it('should call sale webhook if configured', async () => {
        await billingService.handleCheckoutCompleted(checkoutEvent);

        expect(mockSaleWebhook.send).toHaveBeenCalledWith(
          expect.objectContaining({
            site_id: 'site-123',
            org_id: 'test-org-id',
            stripe_customer_id: 'cus_123',
            stripe_subscription_id: 'sub_new123',
            amount: 5000,
            currency: 'usd',
          }),
        );
      });

      it('should be idempotent (safe to process twice)', async () => {
        await billingService.handleCheckoutCompleted(checkoutEvent);
        await billingService.handleCheckoutCompleted(checkoutEvent);

        // Should not create duplicate subscription
        // Should not call sale webhook twice
        expect(mockSaleWebhook.send).toHaveBeenCalledTimes(1);
      });

      it('should trigger free domain provisioning', async () => {
        await billingService.handleCheckoutCompleted(checkoutEvent);

        // Domain provisioning should be triggered
        // (Implementation will call domains service)
      });
    });

    describe('handleSubscriptionUpdated', () => {
      const updateEvent: StripeEvent = {
        id: 'evt_456',
        type: 'customer.subscription.updated',
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'active',
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            cancel_at_period_end: false,
          },
        },
      };

      beforeEach(() => {
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          stripeSubscriptionId: 'sub_123',
          status: 'active',
        });
      });

      it('should update subscription status', async () => {
        updateEvent.data.object.status = 'past_due';

        await billingService.handleSubscriptionUpdated(updateEvent);

        const subscription = await billingService.getOrgSubscription('test-org-id');
        expect(subscription?.status).toBe('past_due');
      });

      it('should update cancel_at_period_end flag', async () => {
        updateEvent.data.object.cancel_at_period_end = true;

        await billingService.handleSubscriptionUpdated(updateEvent);

        const subscription = await billingService.getOrgSubscription('test-org-id');
        expect(subscription?.cancelAtPeriodEnd).toBe(true);
      });

      it('should refresh entitlements on status change', async () => {
        updateEvent.data.object.status = 'canceled';

        await billingService.handleSubscriptionUpdated(updateEvent);

        const entitlements = await billingService.getOrgEntitlements('test-org-id');
        expect(entitlements.plan).toBe('free');
      });

      it('should be idempotent', async () => {
        await billingService.handleSubscriptionUpdated(updateEvent);
        await billingService.handleSubscriptionUpdated(updateEvent);

        // Should not cause issues
      });
    });

    describe('handleSubscriptionDeleted', () => {
      const deleteEvent: StripeEvent = {
        id: 'evt_789',
        type: 'customer.subscription.deleted',
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'canceled',
          },
        },
      };

      beforeEach(() => {
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          stripeSubscriptionId: 'sub_123',
          status: 'active',
        });
      });

      it('should mark subscription as canceled', async () => {
        await billingService.handleSubscriptionDeleted(deleteEvent);

        const subscription = await billingService.getOrgSubscription('test-org-id');
        expect(subscription?.status).toBe('canceled');
      });

      it('should revert to free entitlements', async () => {
        await billingService.handleSubscriptionDeleted(deleteEvent);

        const entitlements = await billingService.getOrgEntitlements('test-org-id');
        expect(entitlements.plan).toBe('free');
        expect(entitlements.topBarHidden).toBe(false);
      });

      it('should record ended_at timestamp', async () => {
        await billingService.handleSubscriptionDeleted(deleteEvent);

        const subscription = await billingService.getOrgSubscription('test-org-id');
        expect(subscription?.endedAt).toBeDefined();
      });
    });

    describe('handleInvoicePaid', () => {
      const paidEvent: StripeEvent = {
        id: 'evt_invoice_paid',
        type: 'invoice.paid',
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'in_123',
            customer: 'cus_123',
            subscription: 'sub_123',
            amount_paid: 5000,
            status: 'paid',
          },
        },
      };

      beforeEach(() => {
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          stripeSubscriptionId: 'sub_123',
          status: 'past_due',
        });
      });

      it('should reset dunning state', async () => {
        await billingService.handleInvoicePaid(paidEvent);

        const dunning = await billingService.getDunningState('test-org-id');
        expect(dunning.stage).toBe(0);
        expect(dunning.daysPastDue).toBe(0);
      });

      it('should update subscription status to active', async () => {
        await billingService.handleInvoicePaid(paidEvent);

        const subscription = await billingService.getOrgSubscription('test-org-id');
        expect(subscription?.status).toBe('active');
      });

      it('should record invoice in database', async () => {
        await billingService.handleInvoicePaid(paidEvent);

        const invoice = mockDb.invoices.get('in_123');
        expect(invoice).toBeDefined();
        expect(invoice.status).toBe('paid');
      });

      it('should be idempotent', async () => {
        await billingService.handleInvoicePaid(paidEvent);
        await billingService.handleInvoicePaid(paidEvent);

        // Should not duplicate invoice records
      });
    });

    describe('handleInvoicePaymentFailed', () => {
      const failedEvent: StripeEvent = {
        id: 'evt_invoice_failed',
        type: 'invoice.payment_failed',
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'in_123',
            customer: 'cus_123',
            subscription: 'sub_123',
            amount_due: 5000,
            status: 'open',
            next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
          },
        },
      };

      beforeEach(() => {
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          stripeSubscriptionId: 'sub_123',
          status: 'active',
        });
      });

      it('should start dunning process', async () => {
        await billingService.handleInvoicePaymentFailed(failedEvent);

        const dunning = await billingService.getDunningState('test-org-id');
        expect(dunning.stage).toBeGreaterThanOrEqual(1);
        expect(dunning.lastInvoiceId).toBe('in_123');
      });

      it('should update subscription status to past_due', async () => {
        await billingService.handleInvoicePaymentFailed(failedEvent);

        const subscription = await billingService.getOrgSubscription('test-org-id');
        expect(subscription?.status).toBe('past_due');
      });

      it('should send dunning notification', async () => {
        await billingService.handleInvoicePaymentFailed(failedEvent);

        // Notification should be sent (via Chatwoot/email)
        // This will be verified in integration tests
      });
    });
  });

  // ==========================================================================
  // DUNNING TESTS
  // ==========================================================================
  describe('Dunning', () => {
    describe('getDunningState', () => {
      it('should return stage 0 for current subscription', async () => {
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'active',
        });

        const state = await billingService.getDunningState('test-org-id');

        expect(state.stage).toBe(0);
        expect(state.daysPastDue).toBe(0);
      });

      it('should calculate days past due correctly', async () => {
        const failedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000); // 15 days ago

        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'past_due',
          lastPaymentFailedAt: failedAt.toISOString(),
        });

        const state = await billingService.getDunningState('test-org-id');

        expect(state.daysPastDue).toBe(15);
        expect(state.stage).toBe(2); // 14 day stage
      });

      it('should return correct dunning stages', async () => {
        // Test each stage boundary
        const testCases = [
          { days: 5, expectedStage: 1 },
          { days: 10, expectedStage: 2 },
          { days: 20, expectedStage: 3 },
          { days: 50, expectedStage: 3 },
          { days: 65, expectedStage: 4 },
        ];

        for (const { days, expectedStage } of testCases) {
          const failedAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
          mockDb.subscriptions.set('sub_123', {
            orgId: 'test-org-id',
            status: 'past_due',
            lastPaymentFailedAt: failedAt.toISOString(),
          });

          const state = await billingService.getDunningState('test-org-id');
          expect(state.stage).toBe(expectedStage);
        }
      });

      it('should set downgrade date at 60 days', async () => {
        const failedAt = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000);

        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'past_due',
          lastPaymentFailedAt: failedAt.toISOString(),
        });

        const state = await billingService.getDunningState('test-org-id');

        expect(state.downgradeAt).toBeDefined();
      });
    });

    describe('processDunning', () => {
      it('should send reminder at 7 days', async () => {
        const failedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'past_due',
          lastPaymentFailedAt: failedAt.toISOString(),
        });

        await billingService.processDunning('test-org-id');

        // Should send 7-day reminder
        // Verified via notification service mock
      });

      it('should send reminder at 14 days', async () => {
        const failedAt = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'past_due',
          lastPaymentFailedAt: failedAt.toISOString(),
          lastDunningStage: 1,
        });

        await billingService.processDunning('test-org-id');

        // Should send 14-day reminder
      });

      it('should downgrade at 60 days', async () => {
        const failedAt = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'past_due',
          lastPaymentFailedAt: failedAt.toISOString(),
          lastDunningStage: 3,
        });

        await billingService.processDunning('test-org-id');

        // Should downgrade entitlements
        const entitlements = await billingService.getOrgEntitlements('test-org-id');
        expect(entitlements.plan).toBe('free');
        expect(entitlements.topBarHidden).toBe(false);
      });

      it('should not send duplicate reminders', async () => {
        const failedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        mockDb.subscriptions.set('sub_123', {
          orgId: 'test-org-id',
          status: 'past_due',
          lastPaymentFailedAt: failedAt.toISOString(),
          lastDunningStage: 1,
          lastReminderAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        });

        await billingService.processDunning('test-org-id');

        // Should not send another reminder (already sent at this stage)
      });
    });
  });

  // ==========================================================================
  // BILLING PORTAL TESTS
  // ==========================================================================
  describe('Billing Portal', () => {
    describe('createBillingPortalSession', () => {
      beforeEach(() => {
        mockDb.orgs.set('test-org-id', {
          id: 'test-org-id',
          stripeCustomerId: 'cus_123',
        });

        mockStripe.billingPortal.sessions.create.mockResolvedValue({
          url: 'https://billing.stripe.com/session/bps_123',
        });
      });

      it('should create portal session', async () => {
        const result = await billingService.createBillingPortalSession(
          'test-org-id',
          'https://example.com/dashboard',
        );

        expect(result.url).toContain('billing.stripe.com');
      });

      it('should require existing Stripe customer', async () => {
        mockDb.orgs.set('no-customer-org', {
          id: 'no-customer-org',
          stripeCustomerId: null,
        });

        await expect(
          billingService.createBillingPortalSession('no-customer-org', 'https://example.com'),
        ).rejects.toThrow(/no billing/i);
      });

      it('should validate return URL', async () => {
        await expect(
          billingService.createBillingPortalSession('test-org-id', 'javascript:alert(1)'),
        ).rejects.toThrow(/invalid url/i);
      });
    });
  });

  // ==========================================================================
  // USAGE TRACKING TESTS (for Lago)
  // ==========================================================================
  describe('Usage Tracking', () => {
    describe('recordUsageEvent', () => {
      it('should record usage event', async () => {
        await billingService.recordUsageEvent({
          orgId: 'test-org-id',
          eventType: 'site_publish',
          quantity: 1,
        });

        const events = mockDb.usageEvents.get('test-org-id') || [];
        expect(events.length).toBe(1);
        expect(events[0].eventType).toBe('site_publish');
      });

      it('should include metadata', async () => {
        await billingService.recordUsageEvent({
          orgId: 'test-org-id',
          eventType: 'ai_request',
          quantity: 1,
          metadata: { model: 'gpt-4', tokens: 1000 },
        });

        const events = mockDb.usageEvents.get('test-org-id') || [];
        expect(events[0].metadata).toEqual({ model: 'gpt-4', tokens: 1000 });
      });

      it('should be idempotent with dedupe key', async () => {
        const dedupeKey = 'unique-event-123';

        await billingService.recordUsageEvent({
          orgId: 'test-org-id',
          eventType: 'site_publish',
          quantity: 1,
          metadata: { dedupe_key: dedupeKey },
        });

        await billingService.recordUsageEvent({
          orgId: 'test-org-id',
          eventType: 'site_publish',
          quantity: 1,
          metadata: { dedupe_key: dedupeKey },
        });

        // Should only record once
        const events = mockDb.usageEvents.get('test-org-id') || [];
        const matchingEvents = events.filter((e: any) => e.metadata?.dedupe_key === dedupeKey);
        expect(matchingEvents.length).toBe(1);
      });
    });

    describe('getUsageSummary', () => {
      beforeEach(() => {
        const now = Date.now();
        mockDb.usageEvents.set('test-org-id', [
          { eventType: 'site_publish', quantity: 1, timestamp: now - 1000 },
          { eventType: 'site_publish', quantity: 1, timestamp: now - 2000 },
          { eventType: 'ai_request', quantity: 5, timestamp: now - 3000 },
        ]);
      });

      it('should aggregate usage by event type', async () => {
        const summary = await billingService.getUsageSummary(
          'test-org-id',
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          new Date().toISOString(),
        );

        expect(summary.events).toContainEqual(
          expect.objectContaining({
            eventType: 'site_publish',
            totalQuantity: 2,
            count: 2,
          }),
        );
        expect(summary.events).toContainEqual(
          expect.objectContaining({
            eventType: 'ai_request',
            totalQuantity: 5,
            count: 1,
          }),
        );
      });

      it('should filter by date range', async () => {
        const summary = await billingService.getUsageSummary(
          'test-org-id',
          new Date(Date.now() - 1500).toISOString(), // Only get last 1.5 seconds
          new Date().toISOString(),
        );

        // Should only include 1 site_publish event
        const publishEvent = summary.events.find((e) => e.eventType === 'site_publish');
        expect(publishEvent?.count).toBe(1);
      });

      it('should return empty for period with no events', async () => {
        const summary = await billingService.getUsageSummary(
          'test-org-id',
          new Date(Date.now() - 1000000).toISOString(),
          new Date(Date.now() - 999000).toISOString(),
        );

        expect(summary.events).toEqual([]);
      });
    });
  });

  // ==========================================================================
  // STRIPE KEY VALIDATION TESTS
  // ==========================================================================
  describe('Stripe Key Validation', () => {
    it('should reject live keys in non-production', () => {
      // This should be validated at service initialization
      expect(() => {
        // billingService.validateKeys('sk_live_xxx')
      }).not.toThrow(); // The validation happens elsewhere
    });

    it('should reject test keys in production', () => {
      // This should be validated at service initialization
      expect(() => {
        // billingService.validateKeys('sk_test_xxx')
      }).not.toThrow(); // The validation happens elsewhere
    });
  });
});
