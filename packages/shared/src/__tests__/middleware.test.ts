/**
 * Middleware tests
 * TDD: These tests define expected behavior of RBAC and entitlements
 */
import { describe, it, expect } from '@jest/globals';
import {
  // RBAC
  roleHasPermission,
  getRolePermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  requireAuth,
  optionalAuth,
  requireOrg,
  requireRole,
  requirePermission,
  requireBillingAdmin,
  requireSiteAccess,
  requireAdmin,
  canPerformAction,
  filterAccessible,
  createPolicy,
  type AuthContext,
  type RequestContext,
} from '../middleware/rbac.js';

import {
  // Entitlements
  getEntitlements,
  shouldHideTopBar,
  canUseCustomDomains,
  getMaxCustomDomains,
  hasFullAnalytics,
  hasPrioritySupport,
  requirePaidSubscription,
  requireCustomDomains,
  requireFullAnalytics,
  isPaidState,
  needsAttention,
  getSubscriptionStatusMessage,
  checkEntitlementWithFlag,
  type EntitlementContext,
} from '../middleware/entitlements.js';

import { ROLES, PERMISSIONS, ENTITLEMENTS, SUBSCRIPTION_STATES } from '../constants/index.js';
import { AuthError, ForbiddenError, PaymentRequiredError } from '../utils/errors.js';

describe('RBAC Middleware', () => {
  describe('roleHasPermission', () => {
    it('owner has all permissions', () => {
      expect(roleHasPermission(ROLES.OWNER, PERMISSIONS.SITE_CREATE)).toBe(true);
      expect(roleHasPermission(ROLES.OWNER, PERMISSIONS.BILLING_MANAGE)).toBe(true);
      expect(roleHasPermission(ROLES.OWNER, PERMISSIONS.ADMIN_ACCESS)).toBe(true);
    });

    it('admin has most permissions but not admin access', () => {
      expect(roleHasPermission(ROLES.ADMIN, PERMISSIONS.SITE_CREATE)).toBe(true);
      expect(roleHasPermission(ROLES.ADMIN, PERMISSIONS.BILLING_VIEW)).toBe(true);
      expect(roleHasPermission(ROLES.ADMIN, PERMISSIONS.ADMIN_ACCESS)).toBe(false);
    });

    it('member has limited permissions', () => {
      expect(roleHasPermission(ROLES.MEMBER, PERMISSIONS.SITE_CREATE)).toBe(true);
      expect(roleHasPermission(ROLES.MEMBER, PERMISSIONS.SITE_DELETE)).toBe(false);
      expect(roleHasPermission(ROLES.MEMBER, PERMISSIONS.BILLING_MANAGE)).toBe(false);
    });

    it('viewer has read-only permissions', () => {
      expect(roleHasPermission(ROLES.VIEWER, PERMISSIONS.SITE_READ)).toBe(true);
      expect(roleHasPermission(ROLES.VIEWER, PERMISSIONS.SITE_CREATE)).toBe(false);
      expect(roleHasPermission(ROLES.VIEWER, PERMISSIONS.SITE_UPDATE)).toBe(false);
    });

    it('returns false for unknown role', () => {
      expect(roleHasPermission('unknown', PERMISSIONS.SITE_READ)).toBe(false);
    });
  });

  describe('getRolePermissions', () => {
    it('returns all permissions for role', () => {
      const ownerPerms = getRolePermissions(ROLES.OWNER);
      expect(ownerPerms).toContain(PERMISSIONS.SITE_CREATE);
      expect(ownerPerms).toContain(PERMISSIONS.ADMIN_ACCESS);
    });

    it('returns empty array for unknown role', () => {
      expect(getRolePermissions('unknown')).toEqual([]);
    });
  });

  describe('hasPermission', () => {
    const memberAuth: AuthContext = {
      user_id: 'user-1',
      org_id: 'org-1',
      role: ROLES.MEMBER,
    };

    it('checks role-based permissions', () => {
      expect(hasPermission(memberAuth, PERMISSIONS.SITE_CREATE)).toBe(true);
      expect(hasPermission(memberAuth, PERMISSIONS.SITE_DELETE)).toBe(false);
    });

    it('checks explicit permissions', () => {
      const authWithExplicit: AuthContext = {
        ...memberAuth,
        permissions: [PERMISSIONS.SITE_DELETE],
      };
      expect(hasPermission(authWithExplicit, PERMISSIONS.SITE_DELETE)).toBe(true);
    });
  });

  describe('hasAnyPermission', () => {
    const viewerAuth: AuthContext = {
      user_id: 'user-1',
      org_id: 'org-1',
      role: ROLES.VIEWER,
    };

    it('returns true if user has any of the permissions', () => {
      expect(hasAnyPermission(viewerAuth, [PERMISSIONS.SITE_READ, PERMISSIONS.SITE_CREATE])).toBe(true);
    });

    it('returns false if user has none of the permissions', () => {
      expect(hasAnyPermission(viewerAuth, [PERMISSIONS.SITE_CREATE, PERMISSIONS.SITE_DELETE])).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    const memberAuth: AuthContext = {
      user_id: 'user-1',
      org_id: 'org-1',
      role: ROLES.MEMBER,
    };

    it('returns true if user has all permissions', () => {
      expect(hasAllPermissions(memberAuth, [PERMISSIONS.SITE_READ, PERMISSIONS.SITE_CREATE])).toBe(true);
    });

    it('returns false if user is missing any permission', () => {
      expect(hasAllPermissions(memberAuth, [PERMISSIONS.SITE_READ, PERMISSIONS.SITE_DELETE])).toBe(false);
    });
  });

  describe('requireAuth', () => {
    it('returns auth context when authenticated', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1' },
      };
      const auth = requireAuth(ctx);
      expect(auth.user_id).toBe('user-1');
    });

    it('throws AuthError when not authenticated', () => {
      const ctx: RequestContext = { request_id: 'req-1' };
      expect(() => requireAuth(ctx)).toThrow(AuthError);
    });

    it('throws AuthError when user_id is missing', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: {} as AuthContext,
      };
      expect(() => requireAuth(ctx)).toThrow(AuthError);
    });
  });

  describe('optionalAuth', () => {
    it('returns auth context when authenticated', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1' },
      };
      expect(optionalAuth(ctx)?.user_id).toBe('user-1');
    });

    it('returns undefined when not authenticated', () => {
      const ctx: RequestContext = { request_id: 'req-1' };
      expect(optionalAuth(ctx)).toBeUndefined();
    });
  });

  describe('requireOrg', () => {
    it('returns auth with org_id when in org', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', org_id: 'org-1' },
      };
      const auth = requireOrg(ctx);
      expect(auth.org_id).toBe('org-1');
    });

    it('throws ForbiddenError when not in org', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1' },
      };
      expect(() => requireOrg(ctx)).toThrow(ForbiddenError);
    });
  });

  describe('requireRole', () => {
    it('allows equal role', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', org_id: 'org-1', role: ROLES.ADMIN },
      };
      expect(() => requireRole(ctx, ROLES.ADMIN)).not.toThrow();
    });

    it('allows higher role', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', org_id: 'org-1', role: ROLES.OWNER },
      };
      expect(() => requireRole(ctx, ROLES.MEMBER)).not.toThrow();
    });

    it('rejects lower role', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', org_id: 'org-1', role: ROLES.VIEWER },
      };
      expect(() => requireRole(ctx, ROLES.ADMIN)).toThrow(ForbiddenError);
    });
  });

  describe('requirePermission', () => {
    it('allows when permission exists', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', role: ROLES.ADMIN },
      };
      expect(() => requirePermission(ctx, PERMISSIONS.SITE_CREATE)).not.toThrow();
    });

    it('throws when permission missing', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', role: ROLES.VIEWER },
      };
      expect(() => requirePermission(ctx, PERMISSIONS.SITE_CREATE)).toThrow(ForbiddenError);
    });
  });

  describe('requireBillingAdmin', () => {
    it('allows owner', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', org_id: 'org-1', role: ROLES.OWNER },
      };
      expect(() => requireBillingAdmin(ctx)).not.toThrow();
    });

    it('allows billing_admin flag', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', org_id: 'org-1', role: ROLES.ADMIN, billing_admin: true },
      };
      expect(() => requireBillingAdmin(ctx)).not.toThrow();
    });

    it('rejects non-billing admin', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', org_id: 'org-1', role: ROLES.ADMIN },
      };
      expect(() => requireBillingAdmin(ctx)).toThrow(ForbiddenError);
    });
  });

  describe('requireSiteAccess', () => {
    it('allows access to own org site', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', org_id: 'org-1', role: ROLES.MEMBER },
      };
      expect(() => requireSiteAccess(ctx, PERMISSIONS.SITE_READ, 'org-1')).not.toThrow();
    });

    it('rejects access to different org site', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', org_id: 'org-1', role: ROLES.ADMIN },
      };
      expect(() => requireSiteAccess(ctx, PERMISSIONS.SITE_READ, 'org-2')).toThrow(ForbiddenError);
    });
  });

  describe('requireAdmin', () => {
    it('allows user with admin access', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', role: ROLES.OWNER },
      };
      expect(() => requireAdmin(ctx)).not.toThrow();
    });

    it('rejects user without admin access', () => {
      const ctx: RequestContext = {
        request_id: 'req-1',
        auth: { user_id: 'user-1', role: ROLES.ADMIN },
      };
      expect(() => requireAdmin(ctx)).toThrow(ForbiddenError);
    });
  });

  describe('canPerformAction', () => {
    const memberAuth: AuthContext = {
      user_id: 'user-1',
      org_id: 'org-1',
      role: ROLES.MEMBER,
    };

    it('returns true for allowed action in same org', () => {
      expect(canPerformAction(memberAuth, 'org-1', PERMISSIONS.SITE_READ)).toBe(true);
    });

    it('returns false for different org', () => {
      expect(canPerformAction(memberAuth, 'org-2', PERMISSIONS.SITE_READ)).toBe(false);
    });

    it('returns false for disallowed permission', () => {
      expect(canPerformAction(memberAuth, 'org-1', PERMISSIONS.SITE_DELETE)).toBe(false);
    });
  });

  describe('filterAccessible', () => {
    const memberAuth: AuthContext = {
      user_id: 'user-1',
      org_id: 'org-1',
      role: ROLES.MEMBER,
    };

    it('filters to accessible resources', () => {
      const resources = [
        { id: '1', org_id: 'org-1' },
        { id: '2', org_id: 'org-2' },
        { id: '3', org_id: 'org-1' },
      ];
      const filtered = filterAccessible(memberAuth, resources, PERMISSIONS.SITE_READ);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((r) => r.id)).toEqual(['1', '3']);
    });
  });

  describe('createPolicy', () => {
    it('creates policy object for admin', () => {
      const auth: AuthContext = {
        user_id: 'user-1',
        org_id: 'org-1',
        role: ROLES.ADMIN,
      };
      const policy = createPolicy(auth);
      expect(policy.canCreateSite).toBe(true);
      expect(policy.canManageBilling).toBe(false);
      expect(policy.canInviteMembers).toBe(true);
    });

    it('creates policy object for viewer', () => {
      const auth: AuthContext = {
        user_id: 'user-1',
        org_id: 'org-1',
        role: ROLES.VIEWER,
      };
      const policy = createPolicy(auth);
      expect(policy.canCreateSite).toBe(false);
      expect(policy.canManageBilling).toBe(false);
      expect(policy.canInviteMembers).toBe(false);
    });
  });
});

describe('Entitlements Middleware', () => {
  describe('getEntitlements', () => {
    it('returns free entitlements for no subscription', () => {
      const ctx: EntitlementContext = { org_id: 'org-1' };
      const entitlements = getEntitlements(ctx);
      expect(entitlements).toEqual(ENTITLEMENTS.FREE);
    });

    it('returns paid entitlements for active subscription', () => {
      const ctx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'active' as const },
      };
      const entitlements = getEntitlements(ctx);
      expect(entitlements).toEqual(ENTITLEMENTS.PAID);
    });

    it('returns paid entitlements for trialing subscription', () => {
      const ctx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'trialing' as const },
      };
      const entitlements = getEntitlements(ctx);
      expect(entitlements).toEqual(ENTITLEMENTS.PAID);
    });

    it('returns paid entitlements for past_due (grace period)', () => {
      const ctx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'past_due' as const },
      };
      const entitlements = getEntitlements(ctx);
      expect(entitlements).toEqual(ENTITLEMENTS.PAID);
    });

    it('returns free entitlements for canceled subscription', () => {
      const ctx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'canceled' as const },
      };
      const entitlements = getEntitlements(ctx);
      expect(entitlements).toEqual(ENTITLEMENTS.FREE);
    });

    it('returns free entitlements for unpaid subscription', () => {
      const ctx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'unpaid' as const },
      };
      const entitlements = getEntitlements(ctx);
      expect(entitlements).toEqual(ENTITLEMENTS.FREE);
    });
  });

  describe('shouldHideTopBar', () => {
    it('returns false for free tier', () => {
      const ctx: EntitlementContext = { org_id: 'org-1' };
      expect(shouldHideTopBar(ctx)).toBe(false);
    });

    it('returns true for paid tier', () => {
      const ctx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'active' as const },
      };
      expect(shouldHideTopBar(ctx)).toBe(true);
    });
  });

  describe('canUseCustomDomains', () => {
    it('returns false for free tier', () => {
      const ctx: EntitlementContext = { org_id: 'org-1' };
      expect(canUseCustomDomains(ctx)).toBe(false);
    });

    it('returns true for paid tier', () => {
      const ctx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'active' as const },
      };
      expect(canUseCustomDomains(ctx)).toBe(true);
    });
  });

  describe('getMaxCustomDomains', () => {
    it('returns 0 for free tier', () => {
      const ctx: EntitlementContext = { org_id: 'org-1' };
      expect(getMaxCustomDomains(ctx)).toBe(0);
    });

    it('returns 5 for paid tier', () => {
      const ctx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'active' as const },
      };
      expect(getMaxCustomDomains(ctx)).toBe(5);
    });
  });

  describe('requirePaidSubscription', () => {
    it('throws for free tier', () => {
      const ctx: EntitlementContext = { org_id: 'org-1' };
      expect(() => requirePaidSubscription(ctx)).toThrow(PaymentRequiredError);
    });

    it('does not throw for paid tier', () => {
      const ctx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'active' as const },
      };
      expect(() => requirePaidSubscription(ctx)).not.toThrow();
    });
  });

  describe('requireCustomDomains', () => {
    it('throws for free tier', () => {
      const ctx: EntitlementContext = { org_id: 'org-1' };
      expect(() => requireCustomDomains(ctx)).toThrow(PaymentRequiredError);
    });

    it('throws when at max domains', () => {
      const ctx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'active' as const },
      };
      expect(() => requireCustomDomains(ctx, 5)).toThrow(ForbiddenError);
    });

    it('does not throw when under limit', () => {
      const ctx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'active' as const },
      };
      expect(() => requireCustomDomains(ctx, 3)).not.toThrow();
    });
  });

  describe('isPaidState', () => {
    it('returns true for active', () => {
      expect(isPaidState(SUBSCRIPTION_STATES.ACTIVE as any)).toBe(true);
    });

    it('returns true for trialing', () => {
      expect(isPaidState(SUBSCRIPTION_STATES.TRIALING as any)).toBe(true);
    });

    it('returns true for past_due', () => {
      expect(isPaidState(SUBSCRIPTION_STATES.PAST_DUE as any)).toBe(true);
    });

    it('returns false for canceled', () => {
      expect(isPaidState(SUBSCRIPTION_STATES.CANCELED as any)).toBe(false);
    });
  });

  describe('needsAttention', () => {
    it('returns false for no subscription', () => {
      expect(needsAttention()).toBe(false);
    });

    it('returns true for past_due', () => {
      expect(needsAttention({ state: 'past_due' as const })).toBe(true);
    });

    it('returns true for cancel_at_period_end', () => {
      expect(needsAttention({ state: 'active' as const, cancel_at_period_end: true })).toBe(true);
    });

    it('returns false for healthy active subscription', () => {
      expect(needsAttention({ state: 'active' as const })).toBe(false);
    });
  });

  describe('getSubscriptionStatusMessage', () => {
    it('returns upgrade prompt for no subscription', () => {
      const result = getSubscriptionStatusMessage();
      expect(result?.type).toBe('info');
      expect(result?.message).toContain('Free plan');
    });

    it('returns null for healthy active subscription', () => {
      const result = getSubscriptionStatusMessage({ state: 'active' as const });
      expect(result).toBe(null);
    });

    it('returns warning for past_due', () => {
      const result = getSubscriptionStatusMessage({ state: 'past_due' as const });
      expect(result?.type).toBe('warning');
      expect(result?.message).toContain('Payment failed');
    });

    it('returns warning for pending cancellation', () => {
      const result = getSubscriptionStatusMessage({
        state: 'active' as const,
        cancel_at_period_end: true,
      });
      expect(result?.type).toBe('warning');
      expect(result?.message).toContain('canceled');
    });
  });

  describe('checkEntitlementWithFlag', () => {
    it('uses flag value when provided', () => {
      const ctx: EntitlementContext = { org_id: 'org-1' };
      expect(checkEntitlementWithFlag(ctx, 'topBarHidden', true)).toBe(true);
      expect(checkEntitlementWithFlag(ctx, 'topBarHidden', false)).toBe(false);
    });

    it('falls back to entitlement when flag not provided', () => {
      const freeCtx: EntitlementContext = { org_id: 'org-1' };
      expect(checkEntitlementWithFlag(freeCtx, 'topBarHidden')).toBe(false);

      const paidCtx: EntitlementContext = {
        org_id: 'org-1',
        subscription: { state: 'active' as const },
      };
      expect(checkEntitlementWithFlag(paidCtx, 'topBarHidden')).toBe(true);
    });
  });
});
