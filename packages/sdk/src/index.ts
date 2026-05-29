/**
 * @package @projectsites/sdk
 * @description TypeScript SDK for the Project Sites API.
 *
 * ESM-only. `fetch` is assumed available (Node 18+, Bun, browsers).
 *
 * @example
 * ```ts
 * import { ProjectSitesClient } from '@projectsites/sdk';
 *
 * const ps = new ProjectSitesClient({ apiToken: process.env.PS_API_TOKEN! });
 * const me = await ps.auth.me();
 * const { data } = await ps.sites.list({ limit: 5 });
 *
 * // Trust Center
 * const { data: trust } = await ps.trust.getProfile();
 *
 * // Enterprise
 * const { data: sla } = await ps.enterprise.getSla();
 *
 * // Stripe App Marketplace
 * const { data: summary } = await ps.stripeApp.getSummary();
 * ```
 */

export { ProjectSitesClient, type ClientConfig } from './client.js';
export type {
  // ── Sites + analytics + media ─────────────────────────────────────
  Site,
  SiteStatus,
  Snapshot,
  MediaAsset,
  FormSubmission,
  AnalyticsDailyRow,
  AnalyticsResponse,
  AnalyticsRange,
  MeResponse,
  DeployResponse,
  ListResponse,
  ApiError,
  ApiScope,
  // ── Trust Center ──────────────────────────────────────────────────
  TrustProfile,
  TrustProfileUpdate,
  PublicTrustProfile,
  AiModelEntry,
  ContentProvenanceEntry,
  DataResidency,
  AuditLogPolicy,
  AiOutageBehavior,
  // ── Enterprise ────────────────────────────────────────────────────
  EnterpriseContract,
  EnterpriseContractUpdate,
  EnterprisePlanTier,
  SsoProvider,
  SsoConfig,
  SlaSnapshot,
  SlaResponse,
  ContractStatus,
  AuditExport,
  AuditExportStatus,
  // ── Stripe App ────────────────────────────────────────────────────
  StripeAppInstall,
  StripeAppSummary,
  InstallSource,
  InstallStatus,
} from './types.js';
export { ProjectSitesApiError } from './types.js';
