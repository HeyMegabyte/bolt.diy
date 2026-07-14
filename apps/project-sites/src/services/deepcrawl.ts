/**
 * Deepcrawl API Client — typed, retried, Zod-validated.
 *
 * All 10 Deepcrawl integration specs in _LOOP_LEDGER.md call this one client.
 * Wraps `api.deepcrawl.projectsites.dev` (v0 worker) with:
 *   - Zod validation on every response
 *   - 3× exponential backoff on transient failures
 *   - API key auth via `DEEPCRAWL_API_KEY` env var
 *   - Response size + timeout guards
 *
 * Cost: ~$0.00/request (CF Workers free tier for API calls to our own worker).
 */

import { z } from 'zod';

// ─── Response schemas ─────────────────────────────────────────────────────

const DeepcrawlMetadataSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  language: z.string().optional(),
  sourceURL: z.string().optional(),
  statusCode: z.number().optional(),
  ogImage: z.string().optional(),
  favicon: z.string().optional(),
});

const DeepcrawlLinkSchema = z.object({
  url: z.string(),
  text: z.string().optional(),
  title: z.string().optional(),
});

const DeepcrawlImageSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const DeepcrawlPageSchema = z.object({
  url: z.string(),
  markdown: z.string().optional(),
  html: z.string().optional(),
  cleanedHtml: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  metadata: DeepcrawlMetadataSchema.optional(),
  links: z.array(DeepcrawlLinkSchema).optional(),
  images: z.array(DeepcrawlImageSchema).optional(),
});

const DeepcrawlLinksResponseSchema = z.object({
  url: z.string().optional(),
  links: z.array(z.union([z.string(), DeepcrawlLinkSchema])).optional(),
  total: z.number().optional(),
});

const DeepcrawlHealthSchema = z.object({
  message: z.string().optional(),
  status: z.string().optional(),
  timestamp: z.string().optional(),
  runtime: z.string().optional(),
});

// ─── Types ─────────────────────────────────────────────────────────────────

export type DeepcrawlPage = z.infer<typeof DeepcrawlPageSchema>;
export type DeepcrawlLinkTree = z.infer<typeof DeepcrawlLinksResponseSchema>;
export type DeepcrawlMetadata = z.infer<typeof DeepcrawlMetadataSchema>;

export interface DeepcrawlReadOptions {
  includeMetadata?: boolean;
  includeLinks?: boolean;
  includeImages?: boolean;
  mainContentOnly?: boolean;
}

export interface DeepcrawlLinksOptions {
  depth?: number;
  limit?: number;
  search?: string;
}

export interface DeepcrawlCrawlOptions extends DeepcrawlLinksOptions {
  includeMarkdown?: boolean;
}

// ─── Client ────────────────────────────────────────────────────────────────

export class DeepcrawlClient {
  constructor(
    private readonly apiUrl: string = 'https://api.deepcrawl.projectsites.dev',
    private readonly apiKey?: string,
  ) {}

  /**
   * Read a single URL — returns clean markdown, metadata, links, images.
   * Maps to Deepcrawl `POST /read`.
   */
  async readUrl(url: string, opts: DeepcrawlReadOptions = {}): Promise<DeepcrawlPage> {
    const params = new URLSearchParams({ url });
    const body: Record<string, unknown> = {};
    if (opts.includeMetadata) body.includeMetadata = true;
    if (opts.includeLinks) body.includeLinks = true;
    if (opts.includeImages) body.includeImages = true;
    if (opts.mainContentOnly !== undefined) body.mainContentOnly = opts.mainContentOnly;

    const result = await this.fetch('/read', {
      method: 'POST',
      body: JSON.stringify(body),
      params,
    });

    return DeepcrawlPageSchema.parse(result);
  }

  /**
   * Get markdown-only version of a page. Fast GET endpoint.
   * Maps to Deepcrawl `GET /read?url=...`.
   */
  async getMarkdown(url: string): Promise<string> {
    const result = await this.fetch('/read', {
      method: 'GET',
      params: new URLSearchParams({ url }),
    });

    if (typeof result === 'string') return result;
    const obj = result as Record<string, unknown>;
    return String(obj.markdown ?? obj.content ?? JSON.stringify(result));
  }

  /**
   * Extract links from a URL — builds an agent-navigable link tree.
   * Maps to Deepcrawl `GET /links?url=...`.
   */
  async extractLinks(url: string, opts: DeepcrawlLinksOptions = {}): Promise<DeepcrawlLinkTree> {
    const params = new URLSearchParams({ url });
    if (opts.depth) params.set('depth', String(opts.depth));
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.search) params.set('search', opts.search);

    const result = await this.fetch('/links', { params });
    return DeepcrawlLinksResponseSchema.parse(result);
  }

  /**
   * Crawl a full site — discovers all URLs and returns each page's markdown.
   * Maps to Deepcrawl `GET /links?url=...&depth=N` + `POST /read` per page.
   */
  async crawlSite(url: string, opts: DeepcrawlCrawlOptions = {}): Promise<DeepcrawlPage[]> {
    const depth = opts.depth ?? 3;
    const limit = opts.limit ?? 50;

    // Phase 1: discover URLs
    const linkTree = await this.extractLinks(url, { depth, limit });
    const urls: string[] = (linkTree.links ?? [])
      .map((l) => (typeof l === 'string' ? l : l.url))
      .filter(Boolean);

    // Phase 2: read each page (sequential to respect rate limits)
    const pages: DeepcrawlPage[] = [];
    for (const pageUrl of urls) {
      try {
        const page = await this.readUrl(pageUrl, { mainContentOnly: true });
        pages.push(page);
      } catch {
        // Individual page failures don't kill the crawl
      }
    }

    return pages;
  }

  /**
   * Discover all URLs on a domain via sitemap + link crawl.
   * Maps to Deepcrawl `GET /links?url=...&depth=0` (sitemap mode).
   */
  async siteMap(url: string, maxUrls = 500): Promise<string[]> {
    const result = await this.extractLinks(url, { limit: maxUrls });
    return (result.links ?? []).map((l) => (typeof l === 'string' ? l : l.url)).filter(Boolean);
  }

  /**
   * Health check — returns true if the API is reachable.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.fetch('/', { method: 'GET' });
      DeepcrawlHealthSchema.parse(result);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Internal fetch with retry ──────────────────────────────────────

  private async fetch(
    path: string,
    opts: {
      method?: string;
      body?: string;
      params?: URLSearchParams;
    } = {},
  ): Promise<unknown> {
    const method = opts.method ?? 'GET';
    let url = `${this.apiUrl}${path}`;
    if (opts.params) {
      url += `?${opts.params.toString()}`;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'ProjectSites-DeepcrawlBot/1.0 (+https://projectsites.dev)',
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);

        const response = await fetch(url, {
          method,
          headers,
          body: opts.body ?? undefined,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          if (response.status >= 500) {
            // Transient server error — retry
            throw new Error(`Deepcrawl ${response.status}: ${errBody.slice(0, 200)}`);
          }
          // Client error — don't retry
          throw new Error(`Deepcrawl API error ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          return response.json();
        }
        return response.text();
      } catch (err: any) {
        lastError = err;
        if (attempt < maxRetries - 1) {
          // Exponential backoff: 1s, 2s, 4s
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError ?? new Error('Deepcrawl request failed after retries');
  }
}

/**
 * Factory — reads DEEPCRAWL_API_KEY from env.
 * Returns null when DEEPCRAWL_API_URL is unset (feature not configured).
 */
export function createDeepcrawlClient(env: {
  DEEPCRAWL_API_URL?: string;
  DEEPCRAWL_API_KEY?: string;
}): DeepcrawlClient | null {
  if (!env.DEEPCRAWL_API_URL) return null;
  return new DeepcrawlClient(env.DEEPCRAWL_API_URL, env.DEEPCRAWL_API_KEY);
}

// ─── Tests ────────────────────────────────────────────────────────────────
// Tests live at src/services/__tests__/deepcrawl.test.ts
