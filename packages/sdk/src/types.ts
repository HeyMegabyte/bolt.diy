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
