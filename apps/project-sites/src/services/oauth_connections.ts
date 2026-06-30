/**
 * ProjectSites OAuth Connection Hub — canonical OAuth connection model.
 *
 * ProjectSites.dev permanently owns customer OAuth via self-hosted Nango at
 * integrations.projectsites.dev. Composio and Pipedream are execution-only —
 * never the canonical OAuth owner.
 *
 * @module services/oauth_connections
 * @packageDocumentation
 */

/** Known OAuth providers ProjectSites supports. */
export type OAuthProvider =
  | 'google'
  | 'microsoft'
  | 'slack'
  | 'github'
  | 'hubspot'
  | 'notion'
  | 'salesforce'
  | 'stripe'
  | 'airtable'
  | 'linear'
  | 'asana'
  | 'trello'
  | 'other';

/** Connection lifecycle states. */
export type OAuthConnectionStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'reauth_required'
  | 'disabled';

/** Canonical OAuth connection stored in `mcp_connections` (D1). */
export interface OAuthConnection {
  id: string;
  orgId: string;
  siteId?: string;
  userId: string;
  provider: OAuthProvider;
  providerAccountId: string;
  providerAccountEmail?: string;
  nangoConnectionId: string;
  nangoProviderConfigKey: string;
  scopes: string[];
  status: OAuthConnectionStatus;
  createdAt: string;
  updatedAt: string;
}

/** RFC7807-style capability error. */
export interface CapabilityError {
  code: string;
  message: string;
  reauthRequired?: boolean;
  missingScopes?: string[];
  requiresExternalAuth?: boolean;
}

/** Runtime selection for capability execution. */
export type CapabilityRuntime = 'native' | 'composio' | 'pipedream';

/** Inbound capability request from MCP or app. */
export interface CapabilityRequest {
  orgId: string;
  siteId?: string;
  userId: string;
  provider: OAuthProvider;
  capability: string;
  action: string;
  input: unknown;
}

/** Router decision before execution. */
export interface CapabilityRouteDecision {
  runtime: CapabilityRuntime;
  provider: OAuthProvider;
  action: string;
  reason: string;
  requiresExternalAuth: boolean;
}

/** Execution result returned to caller. */
export interface CapabilityExecutionResult<T = unknown> {
  runtime: CapabilityRuntime;
  provider: OAuthProvider;
  action: string;
  success: boolean;
  data?: T;
  error?: CapabilityError;
}

/** Capability registry entry — one row per tool action. */
export interface CapabilityRegistryEntry {
  /** Preferred runtime (native | composio | pipedream). */
  preferred: CapabilityRuntime;
  /** Ordered fallback runtimes. */
  fallbacks: CapabilityRuntime[];
  /** Required OAuth scopes. Empty = no scope gate. */
  requiredScopes: string[];
  /** Metering unit key for billing. */
  meteringUnit: string;
}

/** Metering event emitted on every capability execution. */
export interface CapabilityMeteringEvent {
  orgId: string;
  siteId?: string;
  userId: string;
  provider: OAuthProvider;
  action: string;
  runtime: CapabilityRuntime;
  connectionId: string;
  nangoConnectionId: string;
  success: boolean;
  errorCode?: string;
  durationMs: number;
  usageUnits: number;
  meteringUnit: string;
  createdAt: string;
}

/** Scope→description map for provider OAuth scopes. */
export const OAUTH_SCOPE_LABELS: Record<string, string> = {
  'https://www.googleapis.com/auth/gmail.send': 'Send email via Gmail',
  'https://www.googleapis.com/auth/gmail.readonly': 'Read Gmail threads',
  'https://www.googleapis.com/auth/calendar.events': 'Create/modify Calendar events',
  'https://www.googleapis.com/auth/calendar.freebusy': 'Check Calendar availability',
  'https://www.googleapis.com/auth/drive.metadata.readonly': 'Search Drive files',
  'chat:write': 'Send Slack messages',
  repo: 'Access GitHub repositories',
  'crm.objects.contacts.write': 'Create HubSpot contacts',
};
