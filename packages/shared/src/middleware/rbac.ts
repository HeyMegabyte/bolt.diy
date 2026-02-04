/**
 * RBAC (Role-Based Access Control) middleware helpers
 * All permission checks must use this shared module
 */

import { ROLES, ROLE_PERMISSIONS, PERMISSIONS } from '../constants/index.js';
import { ForbiddenError, AuthError } from '../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

export interface AuthContext {
  user_id: string;
  org_id?: string;
  role?: string;
  billing_admin?: boolean;
  permissions?: string[];
}

export interface RequestContext {
  auth?: AuthContext;
  request_id: string;
  ip_address?: string;
  user_agent?: string;
}

// ============================================================================
// PERMISSION CHECKS
// ============================================================================

/**
 * Check if a role has a specific permission
 */
export function roleHasPermission(role: string, permission: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) {
    return false;
  }
  return permissions.includes(permission);
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role: string): string[] {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Check if user has permission (from their role)
 */
export function hasPermission(
  ctx: AuthContext,
  permission: string
): boolean {
  // Check explicit permissions first
  if (ctx.permissions?.includes(permission)) {
    return true;
  }

  // Check role-based permissions
  if (ctx.role && roleHasPermission(ctx.role, permission)) {
    return true;
  }

  return false;
}

/**
 * Check if user has any of the given permissions
 */
export function hasAnyPermission(
  ctx: AuthContext,
  permissions: string[]
): boolean {
  return permissions.some((p) => hasPermission(ctx, p));
}

/**
 * Check if user has all of the given permissions
 */
export function hasAllPermissions(
  ctx: AuthContext,
  permissions: string[]
): boolean {
  return permissions.every((p) => hasPermission(ctx, p));
}

// ============================================================================
// AUTH GUARDS (throw on failure)
// ============================================================================

/**
 * Require authentication (throws AuthError if not authenticated)
 */
export function requireAuth(ctx: RequestContext): AuthContext {
  if (!ctx.auth?.user_id) {
    throw new AuthError('Authentication required');
  }
  return ctx.auth;
}

/**
 * Get optional auth context (returns undefined if not authenticated)
 */
export function optionalAuth(ctx: RequestContext): AuthContext | undefined {
  return ctx.auth?.user_id ? ctx.auth : undefined;
}

/**
 * Require organization membership
 */
export function requireOrg(ctx: RequestContext): AuthContext & { org_id: string } {
  const auth = requireAuth(ctx);
  if (!auth.org_id) {
    throw new ForbiddenError('Organization membership required');
  }
  return auth as AuthContext & { org_id: string };
}

/**
 * Require a specific role or higher
 */
export function requireRole(ctx: RequestContext, role: string): AuthContext {
  const auth = requireOrg(ctx);

  const roleHierarchy = [ROLES.VIEWER, ROLES.MEMBER, ROLES.ADMIN, ROLES.OWNER];
  const requiredLevel = roleHierarchy.indexOf(role);
  const userLevel = roleHierarchy.indexOf(auth.role || ROLES.VIEWER);

  if (userLevel < requiredLevel) {
    throw new ForbiddenError(`Role '${role}' or higher required`);
  }

  return auth;
}

/**
 * Require a specific permission
 */
export function requirePermission(
  ctx: RequestContext,
  permission: string
): AuthContext {
  const auth = requireAuth(ctx);

  if (!hasPermission(auth, permission)) {
    throw new ForbiddenError(`Permission '${permission}' required`);
  }

  return auth;
}

/**
 * Require billing admin access
 */
export function requireBillingAdmin(ctx: RequestContext): AuthContext {
  const auth = requireOrg(ctx);

  // Owner always has billing access
  if (auth.role === ROLES.OWNER) {
    return auth;
  }

  // Check billing_admin flag
  if (!auth.billing_admin) {
    throw new ForbiddenError('Billing admin access required');
  }

  return auth;
}

/**
 * Require site access with specific permission
 */
export function requireSiteAccess(
  ctx: RequestContext,
  permission: string,
  siteOrgId: string
): AuthContext {
  const auth = requireAuth(ctx);

  // Must be in the same org as the site
  if (auth.org_id !== siteOrgId) {
    throw new ForbiddenError('Access to this site is denied');
  }

  // Check permission
  if (!hasPermission(auth, permission)) {
    throw new ForbiddenError(`Permission '${permission}' required for this site`);
  }

  return auth;
}

/**
 * Require admin access (for admin dashboard)
 */
export function requireAdmin(ctx: RequestContext): AuthContext {
  const auth = requireAuth(ctx);

  if (!hasPermission(auth, PERMISSIONS.ADMIN_ACCESS)) {
    throw new ForbiddenError('Admin access required');
  }

  return auth;
}

// ============================================================================
// POLICY HELPERS
// ============================================================================

/**
 * Check if user can perform action on a resource
 */
export function canPerformAction(
  ctx: AuthContext,
  resourceOrgId: string,
  permission: string
): boolean {
  // Must be in the same org
  if (ctx.org_id !== resourceOrgId) {
    return false;
  }

  return hasPermission(ctx, permission);
}

/**
 * Filter a list of resources to only those the user can access
 */
export function filterAccessible<T extends { org_id: string }>(
  ctx: AuthContext,
  resources: T[],
  permission: string
): T[] {
  return resources.filter((r) => canPerformAction(ctx, r.org_id, permission));
}

/**
 * Create a policy object for frontend use
 */
export function createPolicy(ctx: AuthContext): {
  canCreateSite: boolean;
  canManageBilling: boolean;
  canInviteMembers: boolean;
  canManageHostnames: boolean;
  canAccessAdmin: boolean;
} {
  return {
    canCreateSite: hasPermission(ctx, PERMISSIONS.SITE_CREATE),
    canManageBilling: hasPermission(ctx, PERMISSIONS.BILLING_MANAGE),
    canInviteMembers: hasPermission(ctx, PERMISSIONS.ORG_INVITE),
    canManageHostnames: hasPermission(ctx, PERMISSIONS.HOSTNAME_CREATE),
    canAccessAdmin: hasPermission(ctx, PERMISSIONS.ADMIN_ACCESS),
  };
}
