/**
 * @module types
 * @description Typed shapes for every Public API v1 resource.
 */

export type SiteStatus = 'draft' | 'collecting' | 'generating' | 'published' | 'error' | 'archived';
export type ApiScope = 'sites:read' | 'sites:write' | 'media:read' | 'media:write' | 'forms:read' | 'analytics:read' | 'me:read';
export type AnalyticsRange = '1d' | '7d' | '30d' | '90d';

export interface Site {
  id: string;
  slug: string;
  business_name: string;
  status: SiteStatus;
  current_build_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface Snapshot {
  id: string;
  site_id: string;
  version: string;
  label: string | null;
  created_at: string;
}

export interface MediaAsset {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'document';
  filename: string;
  r2_key?: string;
  size_bytes: number;
  created_at: string;
}

export interface FormSubmission {
  id: string;
  form_slug: string;
  data: Record<string, unknown>;
  submitted_at: string;
}

export interface AnalyticsDailyRow {
  date: string;
  pageviews: number;
  unique_visitors: number;
  avg_duration_seconds: number | null;
}

export interface AnalyticsResponse {
  site_id: string;
  range: AnalyticsRange;
  total_pageviews: number;
  total_visitors: number;
  daily: AnalyticsDailyRow[];
}

export interface MeResponse {
  token_id: string;
  token_name: string;
  org: { id: string; name: string | null };
  scopes: ApiScope[];
  expires_at: string | null;
}

export interface DeployResponse {
  job_id: string;
  site_id: string;
  status: string;
  message: string;
}

export interface ListResponse<T> {
  data: T[];
  total?: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  error: string;
  message: string;
  request_id?: string;
}

export class ProjectSitesApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ProjectSitesApiError';
  }
}

// ─── Trust Center ──────────────────────────────────────────────────────────

export type DataResidency = 'global' | 'us' | 'eu' | 'apac';
export type AuditLogPolicy = 'on-request' | 'self-serve' | 'realtime-stream';
export type AiOutageBehavior =
  | 'graceful-degradation'
  | 'queue-and-retry'
  | 'manual-fallback';

export interface AiModelEntry {
  vendor: string;
  model: string;
  version?: string;
  purpose: string;
  policy_url?: string;
}

export interface ContentProvenanceEntry {
  area: string;
  origin: 'ai-generated' | 'human-authored' | 'ai-assisted';
  reviewed_by?: string;
  notes?: string;
}

export interface TrustProfile {
  id: string;
  org_id: string;
  site_id: string | null;
  ai_models: AiModelEntry[];
  data_residency: DataResidency;
  audit_log_policy: AuditLogPolicy;
  content_provenance: ContentProvenanceEntry[];
  ai_outage_behavior: AiOutageBehavior;
  custom_disclosures: string | null;
  published: boolean;
  published_at: string | null;
  updated_at: string;
}

export interface TrustProfileUpdate {
  ai_models?: AiModelEntry[];
  data_residency?: DataResidency;
  audit_log_policy?: AuditLogPolicy;
  content_provenance?: ContentProvenanceEntry[];
  ai_outage_behavior?: AiOutageBehavior;
  custom_disclosures?: string | null;
}

export interface PublicTrustProfile {
  site_slug: string;
  ai_models: AiModelEntry[];
  data_residency: DataResidency;
  audit_log_policy: AuditLogPolicy;
  content_provenance: ContentProvenanceEntry[];
  ai_outage_behavior: AiOutageBehavior;
  custom_disclosures: string | null;
  published_at: string | null;
}

// ─── Enterprise plan ───────────────────────────────────────────────────────

export type EnterprisePlanTier =
  | 'enterprise-small'
  | 'enterprise-mid'
  | 'enterprise-large';

export type SsoProvider = 'saml' | 'oidc' | 'cloudflare-access';
export type ContractStatus = 'pending' | 'active' | 'churned' | 'cancelled';
export type AuditExportStatus = 'pending' | 'ready' | 'expired' | 'failed';

export interface EnterpriseContract {
  id: string;
  org_id: string;
  plan_tier: EnterprisePlanTier;
  sla_pct: number;
  sso_enabled: boolean;
  sso_provider: SsoProvider | null;
  sso_metadata_url: string | null;
  custom_terms_md: string | null;
  dedicated_slack_channel: string | null;
  annual_value_cents: number;
  contract_start: string | null;
  contract_end: string | null;
  audit_export_enabled: boolean;
  contract_signed_url: string | null;
  status: ContractStatus;
  notes: string | null;
  updated_at: string;
}

export interface EnterpriseContractUpdate {
  plan_tier?: EnterprisePlanTier;
  sla_pct?: number;
  sso_enabled?: boolean;
  sso_provider?: SsoProvider | null;
  sso_metadata_url?: string | null;
  custom_terms_md?: string | null;
  dedicated_slack_channel?: string | null;
  annual_value_cents?: number;
  contract_start?: string | null;
  contract_end?: string | null;
  audit_export_enabled?: boolean;
  contract_signed_url?: string | null;
  status?: ContractStatus;
  notes?: string | null;
}

export interface SsoConfig {
  sso_enabled: boolean;
  sso_provider: SsoProvider | null;
  sso_metadata_url: string | null;
}

export interface SlaSnapshot {
  measured_on: string;
  uptime_pct: number;
  incidents_count: number;
  p95_latency_ms?: number;
  notes?: string;
}

export interface SlaResponse {
  contract_sla_pct: number;
  rolling_uptime_pct: number | null;
  breached: boolean;
  snapshots: SlaSnapshot[];
}

export interface AuditExport {
  id: string;
  org_id: string;
  range_start: string;
  range_end: string;
  status: AuditExportStatus;
  r2_key: string | null;
  expires_at: string | null;
  created_at: string;
}

// ─── Stripe App Marketplace status ─────────────────────────────────────────

export type InstallSource = 'marketplace' | 'direct' | 'referral';
export type InstallStatus = 'installed' | 'uninstalled' | 'paused';

export interface StripeAppInstall {
  id: string;
  org_id: string | null;
  stripe_account: string;
  install_source: InstallSource;
  status: InstallStatus;
  installed_at: string;
  uninstalled_at: string | null;
  last_event_at: string | null;
  metadata?: Record<string, unknown>;
}

export interface StripeAppSummary {
  total_installs: number;
  active_installs: number;
  uninstalled: number;
  paused: number;
  by_source: Record<InstallSource, number>;
  last_event_at: string | null;
}
