/**
 * @package @projectsites/sdk
 * @description TypeScript SDK for the Project Sites Public API v1.
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
 * console.log(data.map(s => s.slug));
 * ```
 */

export { ProjectSitesClient, type ClientConfig } from './client.js';
export type {
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
} from './types.js';
export { ProjectSitesApiError } from './types.js';
