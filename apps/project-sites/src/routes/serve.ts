/**
 * Site serving handler
 * Serves static sites from R2 with top bar injection
 */
import type { Handler } from 'hono';
import type { AppEnv } from '../types.js';
import {
  NotFoundError,
  shouldHideTopBar,
  DOMAINS,
  type EntitlementContext,
} from '@project-sites/shared';

export const siteServeHandler: Handler<AppEnv> = async (c) => {
  const host = c.req.header('host') || '';
  const path = c.req.path;

  // Skip API and webhook routes
  if (path.startsWith('/api/') || path.startsWith('/webhooks/') || path.startsWith('/health')) {
    return c.notFound();
  }

  // Extract slug from subdomain
  let slug: string | null = null;
  let isCustomDomain = false;

  if (host.endsWith(`.${DOMAINS.SITES_BASE}`)) {
    // Subdomain: slug.sites.megabyte.space
    slug = host.replace(`.${DOMAINS.SITES_BASE}`, '');
  } else if (host === DOMAINS.SITES_BASE) {
    // Main sites domain - show marketing page
    return serveMarketingPage(c);
  } else {
    // Custom domain - look up in hostnames table
    isCustomDomain = true;

    // Check KV cache first
    const cachedSiteId = await c.env.CACHE_KV.get(`host:${host}`);
    if (cachedSiteId) {
      const db = c.get('db');
      const { data: site } = await db
        .from('sites')
        .select('slug')
        .eq('id', cachedSiteId)
        .single();
      if (site) {
        slug = site.slug;
      }
    } else {
      // Look up in database
      const db = c.get('db');
      const { data: hostname } = await db
        .from('hostnames')
        .select('site_id, sites(slug)')
        .eq('hostname', host)
        .eq('state', 'active')
        .single();

      if (hostname?.sites) {
        slug = (hostname.sites as any).slug;
        // Cache for 5 minutes
        await c.env.CACHE_KV.put(`host:${host}`, hostname.site_id, { expirationTtl: 300 });
      }
    }
  }

  if (!slug) {
    throw new NotFoundError('Site');
  }

  // Get site from database
  const db = c.get('db');
  const { data: site, error } = await db
    .from('sites')
    .select('id, org_id, slug, r2_path, business_name')
    .eq('slug', slug)
    .is('deleted_at', null)
    .single();

  if (error || !site) {
    throw new NotFoundError('Site');
  }

  // Get subscription to determine entitlements
  const { data: subscription } = await db
    .from('subscriptions')
    .select('state')
    .eq('org_id', site.org_id)
    .is('ended_at', null)
    .single();

  const entitlementCtx: EntitlementContext = {
    org_id: site.org_id,
    subscription: subscription ? { state: subscription.state } : undefined,
  };

  const hideTopBar = shouldHideTopBar(entitlementCtx);

  // Determine file path
  let filePath = path === '/' ? '/index.html' : path;
  if (!filePath.includes('.')) {
    filePath = `${filePath}/index.html`;
  }

  const r2Key = `${site.r2_path}${filePath}`;

  // Get file from R2
  const object = await c.env.SITES_BUCKET.get(r2Key);

  if (!object) {
    // Try fallback to index.html for SPA routing
    const fallbackObject = await c.env.SITES_BUCKET.get(`${site.r2_path}/index.html`);
    if (!fallbackObject) {
      throw new NotFoundError('Page');
    }

    return serveHtml(c, fallbackObject, site, hideTopBar);
  }

  // Determine content type
  const contentType = getContentType(filePath);

  // For HTML files, potentially inject top bar
  if (contentType === 'text/html') {
    return serveHtml(c, object, site, hideTopBar);
  }

  // For other files, serve directly with caching
  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Request-ID': c.get('request_id'),
    },
  });
};

async function serveHtml(
  c: any,
  object: R2ObjectBody,
  site: { id: string; slug: string; business_name: string },
  hideTopBar: boolean
): Promise<Response> {
  let html = await object.text();

  // Inject top bar if not hidden
  if (!hideTopBar) {
    const topBar = generateTopBar(site);
    html = html.replace('<body>', `<body>${topBar}`);
  }

  // Inject chat overlay script
  const chatScript = `
    <script>
      (function() {
        if (window.location.search.includes('chat')) {
          // Load chat overlay
          const script = document.createElement('script');
          script.src = 'https://${DOMAINS.SITES_BASE}/chat-overlay.js';
          script.dataset.siteId = '${site.id}';
          document.body.appendChild(script);
        }
      })();
    </script>
  `;
  html = html.replace('</body>', `${chatScript}</body>`);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
      'X-Request-ID': c.get('request_id'),
    },
  });
}

function generateTopBar(site: { slug: string; business_name: string }): string {
  const claimUrl = `https://${DOMAINS.CLAIM_DOMAIN}/${site.slug}`;

  return `
    <div id="project-sites-top-bar" style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 40px;
      background: linear-gradient(90deg, #1a1a2e 0%, #16213e 100%);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      z-index: 999999;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    ">
      <span style="margin-right: 12px;">This site was generated by Project Sites</span>
      <a href="${claimUrl}" style="
        background: #e94560;
        color: white;
        padding: 6px 16px;
        border-radius: 4px;
        text-decoration: none;
        font-weight: 500;
      ">Claim this site</a>
      <button onclick="document.getElementById('project-sites-stats-modal').style.display='block'" style="
        margin-left: 12px;
        background: transparent;
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      ">Stats</button>
    </div>
    <div style="height: 40px;"></div>
    <div id="project-sites-stats-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9999999;">
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 24px; border-radius: 8px; max-width: 500px; width: 90%;">
        <h2 style="margin: 0 0 16px; color: #1a1a2e;">Site Statistics</h2>
        <p style="color: #666;">Loading stats...</p>
        <button onclick="document.getElementById('project-sites-stats-modal').style.display='none'" style="margin-top: 16px; padding: 8px 16px; cursor: pointer;">Close</button>
      </div>
    </div>
  `;
}

async function serveMarketingPage(c: any): Promise<Response> {
  // Serve marketing page from R2 or inline
  const object = await c.env.SITES_BUCKET.get('_marketing/index.html');

  if (object) {
    return new Response(object.body, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  // Fallback inline marketing page
  return new Response(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Project Sites - Beautiful Websites for Small Businesses</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 0; padding: 0; }
        .hero { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; text-align: center; padding: 20px; }
        h1 { font-size: 3rem; margin-bottom: 1rem; }
        p { font-size: 1.25rem; opacity: 0.9; max-width: 600px; margin: 0 auto 2rem; }
        .cta { background: #e94560; color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-size: 1.125rem; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="hero">
        <div>
          <h1>We don't sell websites. We deliver them.</h1>
          <p>Get a beautiful, fast website for your business. Free preview, $50/month to remove branding and add custom domains.</p>
          <a href="https://${DOMAINS.BOLT_DOMAIN}" class="cta">Get Started</a>
        </div>
      </div>
    </body>
    </html>
  `, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    xml: 'application/xml',
    txt: 'text/plain; charset=utf-8',
    webmanifest: 'application/manifest+json',
  };
  return contentTypes[ext || ''] || 'application/octet-stream';
}
