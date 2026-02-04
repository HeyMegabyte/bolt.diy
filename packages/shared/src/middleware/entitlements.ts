/**
 * Entitlements middleware - billing/plan feature gating
 * Used by API routes, UI rendering, and job handlers
 */

import { ENTITLEMENTS, SUBSCRIPTION_STATES } from '../constants/index.js';
import { PaymentRequiredError, ForbiddenError } from '../utils/errors.js';
import type { Entitlements, SubscriptionState } from '../schemas/billing.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SubscriptionInfo {
  state: SubscriptionState;
  plan?: 'free' | 'paid';
  monthly_amount_cents?: number;
  cancel_at_period_end?: boolean;
}

export interface EntitlementContext {
  org_id: string;
  subscription?: SubscriptionInfo;
}

// ============================================================================
// ENTITLEMENT RESOLUTION
// ============================================================================

/**
 * Get entitlements for an org based on subscription state
 */
export function getEntitlements(ctx: EntitlementContext): Entitlements {
  const { subscription } = ctx;

  // No subscription = free tier
  if (!subscription) {
    return { ...ENTITLEMENTS.FREE };
  }

  // Active subscription = paid tier
  if (subscription.state === SUBSCRIPTION_STATES.ACTIVE) {
    return { ...ENTITLEMENTS.PAID };
  }

  // Trialing = paid tier (if we ever add trials)
  if (subscription.state === SUBSCRIPTION_STATES.TRIALING) {
    return { ...ENTITLEMENTS.PAID };
  }

  // Past due - keep paid features for grace period
  if (subscription.state === SUBSCRIPTION_STATES.PAST_DUE) {
    return { ...ENTITLEMENTS.PAID };
  }

  // Canceled, unpaid, paused = free tier (top bar returns)
  return { ...ENTITLEMENTS.FREE };
}

/**
 * Check if top bar should be hidden
 */
export function shouldHideTopBar(ctx: EntitlementContext): boolean {
  const entitlements = getEntitlements(ctx);
  return entitlements.topBarHidden;
}

/**
 * Check if custom domains are allowed
 */
export function canUseCustomDomains(ctx: EntitlementContext): boolean {
  const entitlements = getEntitlements(ctx);
  return entitlements.maxCustomDomains > 0;
}

/**
 * Get max custom domains allowed
 */
export function getMaxCustomDomains(ctx: EntitlementContext): number {
  const entitlements = getEntitlements(ctx);
  return entitlements.maxCustomDomains;
}

/**
 * Check if user has full analytics access
 */
export function hasFullAnalytics(ctx: EntitlementContext): boolean {
  const entitlements = getEntitlements(ctx);
  return entitlements.analyticsAccess === 'full';
}

/**
 * Check if user has priority support
 */
export function hasPrioritySupport(ctx: EntitlementContext): boolean {
  const entitlements = getEntitlements(ctx);
  return entitlements.supportPriority === 'priority';
}

// ============================================================================
// ENTITLEMENT GUARDS (throw on failure)
// ============================================================================

/**
 * Require paid subscription
 */
export function requirePaidSubscription(ctx: EntitlementContext): void {
  const entitlements = getEntitlements(ctx);

  if (!entitlements.topBarHidden) {
    throw new PaymentRequiredError(
      'This feature requires a paid subscription'
    );
  }
}

/**
 * Require custom domains entitlement
 */
export function requireCustomDomains(
  ctx: EntitlementContext,
  currentCount: number = 0
): void {
  const maxDomains = getMaxCustomDomains(ctx);

  if (maxDomains === 0) {
    throw new PaymentRequiredError(
      'Custom domains require a paid subscription'
    );
  }

  if (currentCount >= maxDomains) {
    throw new ForbiddenError(
      `Maximum of ${maxDomains} custom domains allowed on your plan`
    );
  }
}

/**
 * Require full analytics access
 */
export function requireFullAnalytics(ctx: EntitlementContext): void {
  if (!hasFullAnalytics(ctx)) {
    throw new PaymentRequiredError(
      'Full analytics require a paid subscription'
    );
  }
}

// ============================================================================
// SUBSCRIPTION STATE HELPERS
// ============================================================================

/**
 * Check if subscription is in a "paid" state
 */
export function isPaidState(state: SubscriptionState): boolean {
  return (
    state === SUBSCRIPTION_STATES.ACTIVE ||
    state === SUBSCRIPTION_STATES.TRIALING ||
    state === SUBSCRIPTION_STATES.PAST_DUE
  );
}

/**
 * Check if subscription needs attention (payment issues)
 */
export function needsAttention(subscription?: SubscriptionInfo): boolean {
  if (!subscription) {
    return false;
  }

  return (
    subscription.state === SUBSCRIPTION_STATES.PAST_DUE ||
    subscription.state === SUBSCRIPTION_STATES.UNPAID ||
    subscription.cancel_at_period_end === true
  );
}

/**
 * Get subscription status message for UI
 */
export function getSubscriptionStatusMessage(
  subscription?: SubscriptionInfo
): { type: 'info' | 'warning' | 'error'; message: string } | null {
  if (!subscription) {
    return {
      type: 'info',
      message: 'Free plan - upgrade to remove the top bar and add custom domains',
    };
  }

  switch (subscription.state) {
    case SUBSCRIPTION_STATES.ACTIVE:
      if (subscription.cancel_at_period_end) {
        return {
          type: 'warning',
          message: 'Your subscription will be canceled at the end of the billing period',
        };
      }
      return null;

    case SUBSCRIPTION_STATES.PAST_DUE:
      return {
        type: 'warning',
        message: 'Payment failed - please update your payment method to keep your subscription',
      };

    case SUBSCRIPTION_STATES.UNPAID:
      return {
        type: 'error',
        message: 'Your subscription is unpaid - features have been restricted',
      };

    case SUBSCRIPTION_STATES.CANCELED:
      return {
        type: 'info',
        message: 'Your subscription has been canceled - resubscribe to restore features',
      };

    case SUBSCRIPTION_STATES.PAUSED:
      return {
        type: 'info',
        message: 'Your subscription is paused',
      };

    default:
      return null;
  }
}

// ============================================================================
// FEATURE FLAG INTEGRATION
// ============================================================================

/**
 * Check entitlement with feature flag override
 */
export function checkEntitlementWithFlag(
  ctx: EntitlementContext,
  featureName: keyof Entitlements,
  flagValue?: boolean
): boolean {
  // Feature flag overrides entitlement (for testing/gradual rollout)
  if (flagValue !== undefined) {
    return flagValue;
  }

  const entitlements = getEntitlements(ctx);
  const value = entitlements[featureName];

  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value > 0;
  }
  return value !== 'none' && value !== 'community';
}
