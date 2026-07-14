/**
 * Firecrawl-Compatible Bridge Worker
 *
 * Translates Firecrawl MCP API calls → Deepcrawl v0 Worker calls.
 * Deploy this alongside the v0 API Worker at api.deepcrawl.projectsites.dev
 * or on its own route (firecrawl-bridge.projectsites.dev).
 *
 * Point any Firecrawl MCP server at this worker via FIRE_CRAWL_API_URL.
 *
 * Firecrawl API → Deepcrawl API mapping:
 *   POST /v1/scrape          → POST /read
 *   POST /v1/map             → GET /links (discovery mode)
 *   POST /v1/crawl           → GET /links?depth=N (sync crawl wrapper)
 *   GET  /v1/crawl/{id}      → stub (deepcrawl has no async crawl)
 *   POST /v1/batch/scrape    → parallel /read calls
 *   GET  /v1/batch/scrape/{id} → stub
 *   POST /v1/search          → 501 Not Implemented
 */

interface Env {
  DEEPCRAWL_API_URL: string;
  DEEPCRAWL_API_KEY?: string;
}

function firecrawlScrapeResponse(deepcrawlResult: any, url: string): any {
  return {
    success: true,
    data: {
      markdown: deepcrawlResult?.markdown ?? deepcrawlResult?.content ?? '',
      html: deepcrawlResult?.html ?? deepcrawlResult?.cleanedHtml ?? '',
      metadata: {
        title: deepcrawlResult?.title ?? deepcrawlResult?.metadata?.title ?? '',
        description: deepcrawlResult?.description ?? deepcrawlResult?.metadata?.description ?? '',
        language: deepcrawlResult?.language ?? deepcrawlResult?.metadata?.language ?? 'en',
        sourceURL: url,
        statusCode: 200,
        ...(deepcrawlResult?.metadata ?? {}),
      },
      links: deepcrawlResult?.links ?? [],
      images: deepcrawlResult?.images ?? [],
    },
  };
}

function firecrawlMapResponse(deepcrawlResult: any): any {
  const links = Array.isArray(deepcrawlResult?.links)
    ? deepcrawlResult.links
    : Array.isArray(deepcrawlResult)
      ? deepcrawlResult
      : [];
  return {
    success: true,
    links: links.map((l: any) => (typeof l === 'string' ? l : l.url ?? l.href ?? '')),
  };
}

function firecrawlCrawlResponse(deepcrawlResult: any, url: string): any {
  const links = Array.isArray(deepcrawlResult?.links)
    ? deepcrawlResult.links
    : Array.isArray(deepcrawlResult)
      ? deepcrawlResult
      : [];
  const pages = links.map((l: any) => {
    const linkUrl = typeof l === 'string' ? l : l.url ?? l.href ?? '';
    return {
      url: linkUrl,
      markdown: l?.markdown ?? l?.content ?? `[Linked: ${linkUrl}]`,
      metadata: { title: l?.title ?? '', sourceURL: linkUrl },
    };
  });
  return {
    success: true,
    data: pages,
    total: pages.length,
    completed: pages.length,
    status: 'completed',
  };
}

async function callDeepcrawl(env: Env, path: string, options: RequestInit = {}): Promise<any> {
  const baseUrl = env.DEEPCRAWL_API_URL || 'https://api.deepcrawl.projectsites.dev';
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (env.DEEPCRAWL_API_KEY) {
    headers['x-api-key'] = env.DEEPCRAWL_API_KEY;
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Deepcrawl API error ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const json = (r: any, status = 200) =>
      new Response(JSON.stringify(r), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    const errorResponse = (message: string, status = 400) =>
      json({ success: false, error: message }, status);

    try {
      // ── POST /v1/scrape ──────────────────────────────────────────────
      if (method === 'POST' && url.pathname === '/v1/scrape') {
        const body = await request.json().catch(() => ({}));
        const targetUrl = body.url;
        if (!targetUrl) return errorResponse('url is required');

        const params = new URLSearchParams({ url: targetUrl });
        const result = await callDeepcrawl(env, `/read?${params}`, { method: 'POST' });
        return json(firecrawlScrapeResponse(result, targetUrl));
      }

      // ── POST /v1/map ─────────────────────────────────────────────────
      if (method === 'POST' && url.pathname === '/v1/map') {
        const body = await request.json().catch(() => ({}));
        const targetUrl = body.url;
        if (!targetUrl) return errorResponse('url is required');

        const searchParams = body.search ? `&search=${encodeURIComponent(body.search)}` : '';
        const limit = body.limit ? `&limit=${body.limit}` : '';
        const result = await callDeepcrawl(env, `/links?url=${encodeURIComponent(targetUrl)}${searchParams}${limit}`);
        return json(firecrawlMapResponse(result));
      }

      // ── POST /v1/crawl ───────────────────────────────────────────────
      if (method === 'POST' && url.pathname === '/v1/crawl') {
        const body = await request.json().catch(() => ({}));
        const targetUrl = body.url;
        if (!targetUrl) return errorResponse('url is required');

        const depth = body.maxDiscoveryDepth ?? body.maxDepth ?? 2;
        const limit = body.limit ?? 50;
        const result = await callDeepcrawl(
          env,
          `/links?url=${encodeURIComponent(targetUrl)}&depth=${depth}&limit=${limit}`,
        );
        return json(firecrawlCrawlResponse(result, targetUrl));
      }

      // ── GET /v1/crawl/{id} ──────────────────────────────────────────
      const crawlStatusMatch = url.pathname.match(/^\/v1\/crawl\/(.+)$/);
      if (method === 'GET' && crawlStatusMatch) {
        return json({
          success: true,
          status: 'completed',
          total: 0,
          completed: 0,
          data: [],
          message: 'Deepcrawl processes crawls synchronously — crawl/{id} is a stub',
        });
      }

      // ── POST /v1/batch/scrape ────────────────────────────────────────
      if (method === 'POST' && url.pathname === '/v1/batch/scrape') {
        const body = await request.json().catch(() => ({}));
        const urls: string[] = body.urls ?? [];
        if (!urls.length) return errorResponse('urls array is required');

        const results = await Promise.allSettled(
          urls.map(async (targetUrl) => {
            const params = new URLSearchParams({ url: targetUrl });
            const result = await callDeepcrawl(env, `/read?${params}`, { method: 'POST' });
            return firecrawlScrapeResponse(result, targetUrl).data;
          }),
        );

        const data = results.map((r, i) =>
          r.status === 'fulfilled'
            ? r.value
            : { url: urls[i], error: (r as PromiseRejectedResult).reason?.message ?? 'failed' },
        );

        return json({ success: true, data, status: 'completed', total: urls.length, completed: urls.length });
      }

      // ── GET /v1/batch/scrape/{id} ────────────────────────────────────
      const batchStatusMatch = url.pathname.match(/^\/v1\/batch\/scrape\/(.+)$/);
      if (method === 'GET' && batchStatusMatch) {
        return json({
          success: true,
          status: 'completed',
          total: 0,
          completed: 0,
          data: [],
          message: 'Deepcrawl processes batches synchronously — batch/scrape/{id} is a stub',
        });
      }

      // ── POST /v1/search ──────────────────────────────────────────────
      if (method === 'POST' && url.pathname === '/v1/search') {
        return json(
          { success: false, error: 'Web search is not supported by Deepcrawl' },
          501,
        );
      }

      // ── POST /v1/extract ─────────────────────────────────────────────
      if (method === 'POST' && url.pathname === '/v1/extract') {
        return json(
          { success: false, error: 'LLM extraction is not supported by Deepcrawl' },
          501,
        );
      }

      // ── Health ───────────────────────────────────────────────────────
      if (url.pathname === '/health' || url.pathname === '/') {
        return json({
          status: 'ok',
          service: 'firecrawl-bridge',
          upstream: env.DEEPCRAWL_API_URL || 'https://api.deepcrawl.projectsites.dev',
        });
      }

      // ── 404 ──────────────────────────────────────────────────────────
      return json({ success: false, error: `Unknown endpoint: ${method} ${url.pathname}` }, 404);
    } catch (err: any) {
      return json(
        { success: false, error: err?.message ?? 'Internal bridge error' },
        500,
      );
    }
  },
};
