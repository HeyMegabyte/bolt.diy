/**
 * Project Sites shared constants
 * All business rules and configuration values
 */

// ============================================================================
// CAPS & LIMITS
// ============================================================================
export const DEFAULT_CAPS = {
  /** Daily LLM spend limit in cents ($20/day) */
  LLM_DAILY_SPEND_CENTS: 2000,
  /** Maximum sites created per day */
  SITES_PER_DAY: 20,
  /** Maximum emails sent per day */
  EMAILS_PER_DAY: 25,
  /** Maximum request payload size in bytes (256KB) */
  MAX_REQUEST_PAYLOAD_BYTES: 256 * 1024,
  /** Maximum AI microtask output in bytes (64KB) */
  MAX_AI_OUTPUT_BYTES: 64 * 1024,
  /** Maximum custom domains per paid site */
  MAX_CUSTOM_DOMAINS: 5,
  /** Maximum queued retries per job */
  MAX_QUEUED_RETRIES: 5,
  /** Maximum compute time per job in milliseconds (5 minutes) */
  MAX_JOB_COMPUTE_MS: 5 * 60 * 1000,
} as const;

// ============================================================================
// PRICING
// ============================================================================
export const PRICING = {
  /** Monthly subscription price in cents ($50/mo) */
  MONTHLY_CENTS: 5000,
  /** Retention offer price in cents ($25/mo for 12 months) */
  RETENTION_MONTHLY_CENTS: 2500,
  /** Retention offer duration in months */
  RETENTION_DURATION_MONTHS: 12,
  /** Currency code */
  CURRENCY: 'usd',
} as const;

// ============================================================================
// DUNNING
// ============================================================================
export const DUNNING = {
  /** Days after due date for reminder emails */
  REMINDER_DAYS: [0, 7, 14, 30] as const,
  /** Days after due date to downgrade (top bar returns) */
  DOWNGRADE_DAYS: 60,
  /** Days after due date to suspend site */
  SUSPEND_DAYS: 90,
} as const;

// ============================================================================
// AUTH
// ============================================================================
export const AUTH = {
  /** Magic link expiry in hours */
  MAGIC_LINK_EXPIRY_HOURS: 24,
  /** OTP expiry in minutes */
  OTP_EXPIRY_MINUTES: 5,
  /** Maximum OTP verification attempts */
  OTP_MAX_ATTEMPTS: 3,
  /** Session expiry in days */
  SESSION_EXPIRY_DAYS: 30,
  /** Session token length */
  SESSION_TOKEN_LENGTH: 64,
  /** Magic link token length */
  MAGIC_LINK_TOKEN_LENGTH: 48,
  /** OTP code length */
  OTP_CODE_LENGTH: 6,
  /** Rate limit: auth requests per minute per IP */
  RATE_LIMIT_AUTH_PER_MINUTE: 10,
  /** Rate limit: magic link requests per hour per email */
  RATE_LIMIT_MAGIC_LINK_PER_HOUR: 5,
} as const;

// ============================================================================
// ENTITLEMENTS
// ============================================================================
export const ENTITLEMENTS = {
  FREE: {
    topBarHidden: false,
    maxCustomDomains: 0,
    analyticsAccess: 'basic',
    supportPriority: 'community',
  },
  PAID: {
    topBarHidden: true,
    maxCustomDomains: 5,
    analyticsAccess: 'full',
    supportPriority: 'priority',
  },
} as const;

// ============================================================================
// ROLES & PERMISSIONS
// ============================================================================
export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const;

export const PERMISSIONS = {
  // Site permissions
  SITE_CREATE: 'site:create',
  SITE_READ: 'site:read',
  SITE_UPDATE: 'site:update',
  SITE_DELETE: 'site:delete',
  SITE_PUBLISH: 'site:publish',
  // Hostname permissions
  HOSTNAME_CREATE: 'hostname:create',
  HOSTNAME_READ: 'hostname:read',
  HOSTNAME_DELETE: 'hostname:delete',
  // Billing permissions
  BILLING_VIEW: 'billing:view',
  BILLING_MANAGE: 'billing:manage',
  // Org permissions
  ORG_READ: 'org:read',
  ORG_UPDATE: 'org:update',
  ORG_DELETE: 'org:delete',
  ORG_INVITE: 'org:invite',
  // Admin permissions
  ADMIN_ACCESS: 'admin:access',
} as const;

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  [ROLES.OWNER]: Object.values(PERMISSIONS),
  [ROLES.ADMIN]: [
    PERMISSIONS.SITE_CREATE,
    PERMISSIONS.SITE_READ,
    PERMISSIONS.SITE_UPDATE,
    PERMISSIONS.SITE_DELETE,
    PERMISSIONS.SITE_PUBLISH,
    PERMISSIONS.HOSTNAME_CREATE,
    PERMISSIONS.HOSTNAME_READ,
    PERMISSIONS.HOSTNAME_DELETE,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.ORG_UPDATE,
    PERMISSIONS.ORG_INVITE,
  ],
  [ROLES.MEMBER]: [
    PERMISSIONS.SITE_CREATE,
    PERMISSIONS.SITE_READ,
    PERMISSIONS.SITE_UPDATE,
    PERMISSIONS.SITE_PUBLISH,
    PERMISSIONS.HOSTNAME_READ,
    PERMISSIONS.ORG_READ,
  ],
  [ROLES.VIEWER]: [
    PERMISSIONS.SITE_READ,
    PERMISSIONS.HOSTNAME_READ,
    PERMISSIONS.ORG_READ,
  ],
};

// ============================================================================
// CONFIDENCE THRESHOLDS
// ============================================================================
export const CONFIDENCE = {
  /** Minimum confidence to create site record */
  MIN_SITE_CREATE: 90,
  /** Minimum email confidence for first email */
  MIN_EMAIL_SEND: 90,
  /** Minimum phone confidence for first email */
  MIN_PHONE_SEND: 80,
  /** Minimum address confidence for first email */
  MIN_ADDRESS_SEND: 80,
  /** Minimum address confidence for postcard eligibility */
  MIN_POSTCARD: 90,
  /** Verified contact confidence */
  VERIFIED: 100,
} as const;

// ============================================================================
// LIGHTHOUSE
// ============================================================================
export const LIGHTHOUSE = {
  /** Minimum acceptable mobile score */
  MIN_MOBILE_SCORE: 90,
  /** Maximum fix attempts before failing */
  MAX_FIX_ATTEMPTS: 5,
} as const;

// ============================================================================
// PERFORMANCE BUDGETS
// ============================================================================
export const PERFORMANCE = {
  /** P95 public site HTML response in ms */
  P95_SITE_RESPONSE_MS: 300,
  /** P95 API endpoint response in ms */
  P95_API_RESPONSE_MS: 500,
  /** Sentry performance sample rate in production */
  SENTRY_SAMPLE_RATE_PROD: 0.1,
  /** Sentry performance sample rate in staging */
  SENTRY_SAMPLE_RATE_STAGING: 1.0,
} as const;

// ============================================================================
// WEBHOOK PROVIDERS
// ============================================================================
export const WEBHOOK_PROVIDERS = {
  STRIPE: 'stripe',
  CHATWOOT: 'chatwoot',
  DUB: 'dub',
  NOVU: 'novu',
  LAGO: 'lago',
} as const;

// ============================================================================
// SUBSCRIPTION STATES
// ============================================================================
export const SUBSCRIPTION_STATES = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  UNPAID: 'unpaid',
  TRIALING: 'trialing',
  PAUSED: 'paused',
} as const;

// ============================================================================
// HOSTNAME STATES
// ============================================================================
export const HOSTNAME_STATES = {
  PENDING: 'pending',
  ACTIVE: 'active',
  FAILED: 'failed',
  DELETED: 'deleted',
} as const;

// ============================================================================
// JOB STATES
// ============================================================================
export const JOB_STATES = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD: 'dead',
} as const;

// ============================================================================
// AUDIT LOG ACTIONS
// ============================================================================
export const AUDIT_ACTIONS = {
  // Auth
  AUTH_MAGIC_LINK_SENT: 'auth.magic_link_sent',
  AUTH_MAGIC_LINK_VERIFIED: 'auth.magic_link_verified',
  AUTH_OTP_SENT: 'auth.otp_sent',
  AUTH_OTP_VERIFIED: 'auth.otp_verified',
  AUTH_GOOGLE_LOGIN: 'auth.google_login',
  AUTH_SESSION_CREATED: 'auth.session_created',
  AUTH_SESSION_REVOKED: 'auth.session_revoked',
  AUTH_LOGOUT: 'auth.logout',
  // Org
  ORG_CREATED: 'org.created',
  ORG_UPDATED: 'org.updated',
  ORG_DELETED: 'org.deleted',
  ORG_MEMBER_INVITED: 'org.member_invited',
  ORG_MEMBER_REMOVED: 'org.member_removed',
  ORG_MEMBER_ROLE_CHANGED: 'org.member_role_changed',
  // Site
  SITE_CREATED: 'site.created',
  SITE_UPDATED: 'site.updated',
  SITE_DELETED: 'site.deleted',
  SITE_PUBLISHED: 'site.published',
  // Hostname
  HOSTNAME_CREATED: 'hostname.created',
  HOSTNAME_VERIFIED: 'hostname.verified',
  HOSTNAME_DELETED: 'hostname.deleted',
  // Billing
  BILLING_CHECKOUT_STARTED: 'billing.checkout_started',
  BILLING_SUBSCRIPTION_CREATED: 'billing.subscription_created',
  BILLING_SUBSCRIPTION_UPDATED: 'billing.subscription_updated',
  BILLING_SUBSCRIPTION_CANCELED: 'billing.subscription_canceled',
  BILLING_PAYMENT_SUCCEEDED: 'billing.payment_succeeded',
  BILLING_PAYMENT_FAILED: 'billing.payment_failed',
  // Webhook
  WEBHOOK_RECEIVED: 'webhook.received',
  WEBHOOK_PROCESSED: 'webhook.processed',
  WEBHOOK_REJECTED: 'webhook.rejected',
  // Admin
  ADMIN_SETTING_CHANGED: 'admin.setting_changed',
  ADMIN_FLAG_TOGGLED: 'admin.flag_toggled',
} as const;

// ============================================================================
// FEATURE FLAGS (default values)
// ============================================================================
export const DEFAULT_FEATURE_FLAGS = {
  /** Use Lago for metering (vs internal) */
  LAGO_ENABLED: false,
  /** Enable postcard sending */
  POSTCARDS_ENABLED: false,
  /** Enable email sending */
  EMAILS_ENABLED: true,
  /** Global kill switch */
  SYSTEM_ENABLED: true,
} as const;

// ============================================================================
// DOMAINS
// ============================================================================
export const DOMAINS = {
  /** Base domain for project sites */
  SITES_BASE: 'sites.megabyte.space',
  /** Bolt editor domain */
  BOLT_DOMAIN: 'bolt.megabyte.space',
  /** Claim link domain */
  CLAIM_DOMAIN: 'claimyour.site',
} as const;
