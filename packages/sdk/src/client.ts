/**
 * @module client
 * @description `ProjectSitesClient` — typed HTTP client for the Public API v1.
 *
 * All methods return typed responses. Network errors and API errors
 * surface as `ProjectSitesApiError` with `statusCode` + `code`.
 *
 * ## Retry policy
 * Transient errors (5xx, network) are retried up to `maxRetries` times
 * with exponential backoff (250ms × 2^attempt, capped at 30s).
 *
 * @example
 * ```ts
 * import { ProjectSitesClient } from '@projectsites/sdk';
 *
 * const client = new ProjectSitesClient({ apiToken: 'psk_...' });
 * const { data: sites } = await client.sites.list();
 * ```
 */

import type {
  Site,
  Snapshot,
  MediaAsset,
  FormSubmission,
  AnalyticsResponse,
  AnalyticsRange,
  MeResponse,
  DeployResponse,
  ListResponse,
  ApiError,
} from './types.js';
import { ProjectSitesApiError } from './types.js';

export interface ClientConfig {
  /** Bearer token (psk_...) */
  apiToken: string;
  /** API base URL. Defaults to https://projectsites.dev */
  baseUrl?: string;
  /** Maximum retry attempts on transient errors. Defaults to 3. */
  maxRetries?: number;
}

const DEFAULT_BASE_URL = 'https://projectsites.dev';

class BaseResource {
  constructor(protected readonly http: HttpClient) {}
}

class SitesResource extends BaseResource {
  list(opts: { limit?: number; offset?: number } = {}): Promise<ListResponse<Site>> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    return this.http.get<ListResponse<Site>>(`/v1/sites${params.size ? `?${params}` : ''}`);
  }

  get(id: string): Promise<Site> {
    return this.http.get<Site>(`/v1/sites/${id}`);
  }

  create(data: { slug: string; business_name: string }): Promise<Site> {
    return this.http.post<Site>('/v1/sites', data);
  }

  update(id: string, data: Partial<Pick<Site, 'slug' | 'business_name'>>): Promise<Site> {
    return this.http.patch<Site>(`/v1/sites/${id}`, data);
  }

  delete(id: string): Promise<void> {
    return this.http.delete<void>(`/v1/sites/${id}`);
  }

  deploy(id: string): Promise<DeployResponse> {
    return this.http.post<DeployResponse>(`/v1/sites/${id}/deploy`, {});
  }

  snapshots(id: string): Promise<{ data: Snapshot[] }> {
    return this.http.get<{ data: Snapshot[] }>(`/v1/sites/${id}/snapshots`);
  }

  media(id: string, opts: { limit?: number; offset?: number } = {}): Promise<ListResponse<MediaAsset>> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    return this.http.get<ListResponse<MediaAsset>>(`/v1/sites/${id}/media${params.size ? `?${params}` : ''}`);
  }

  formSubmissions(id: string, opts: { limit?: number; offset?: number } = {}): Promise<ListResponse<FormSubmission>> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    return this.http.get<ListResponse<FormSubmission>>(`/v1/sites/${id}/forms/submissions${params.size ? `?${params}` : ''}`);
  }

  analytics(id: string, range: AnalyticsRange = '7d'): Promise<AnalyticsResponse> {
    return this.http.get<AnalyticsResponse>(`/v1/sites/${id}/analytics?range=${range}`);
  }
}

class AuthResource extends BaseResource {
  me(): Promise<MeResponse> {
    return this.http.get<MeResponse>('/v1/me');
  }
}

/** Low-level HTTP client with retry-with-backoff. */
class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiToken: string,
    private readonly maxRetries: number,
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async withRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ProjectSitesApiError && err.statusCode < 500) throw err;
      if (attempt >= this.maxRetries) throw err;
      const delay = Math.min(250 * Math.pow(2, attempt), 30_000);
      await new Promise((r) => setTimeout(r, delay));
      return this.withRetry(fn, attempt + 1);
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.withRetry(async () => {
      const url = `${this.baseUrl}${path}`;
      const init: RequestInit = { method, headers: this.headers() };
      if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
        (init as { body: string }).body = JSON.stringify(body);
      }

      const res = await fetch(url, init);
      if (res.status === 204) return undefined as T;

      const text = await res.text();
      let json: unknown;
      try { json = JSON.parse(text); } catch { json = { error: 'parse_error', message: text }; }

      if (!res.ok) {
        const err = json as ApiError;
        throw new ProjectSitesApiError(
          res.status,
          err.error ?? 'api_error',
          err.message ?? `HTTP ${res.status}`,
          err.request_id,
        );
      }

      return json as T;
    });
  }

  get<T>(path: string): Promise<T> { return this.request<T>('GET', path); }
  post<T>(path: string, body: unknown): Promise<T> { return this.request<T>('POST', path, body); }
  patch<T>(path: string, body: unknown): Promise<T> { return this.request<T>('PATCH', path, body); }
  delete<T>(path: string): Promise<T> { return this.request<T>('DELETE', path); }
}

/**
 * Top-level client for the Project Sites Public API v1.
 *
 * @example
 * ```ts
 * const ps = new ProjectSitesClient({ apiToken: 'psk_...' });
 * const me = await ps.auth.me();
 * const { data: sites } = await ps.sites.list({ limit: 10 });
 * ```
 */
export class ProjectSitesClient {
  readonly sites: SitesResource;
  readonly auth: AuthResource;
  private readonly http: HttpClient;

  constructor(config: ClientConfig) {
    this.http = new HttpClient(
      config.baseUrl ?? DEFAULT_BASE_URL,
      config.apiToken,
      config.maxRetries ?? 3,
    );
    this.sites = new SitesResource(this.http);
    this.auth = new AuthResource(this.http);
  }
}
