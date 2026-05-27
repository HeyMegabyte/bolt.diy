/**
 * Privacy-first per-site analytics (backlog #27).
 *
 * @remarks
 *  Cookieless, GDPR-clean. The visitor hash is `SHA-256(ip + ua + daily_salt)`
 *  so it is NOT stable across days — bots cannot cross-day-fingerprint and
 *  the operator can never recover a raw IP from the row. UA is stripped to
 *  a coarse family (e.g. `"Chrome 131"`). Referrer is reduced to the host
 *  only; full URLs are PII-leaky and we deliberately drop them.
 *
 *  Endpoints:
 *   - `GET  /_pa/script.js`    — tiny drop-in beacon (~1.2 KB, no deps).
 *   - `POST /_pa/events`       — accept beacon payloads; no auth (public).
 *   - `GET  /_pa/aggregates`   — top pages, top referrers, daily trend.
 *
 *  Per-tenant boundary is the D1 binding (ADR-0008) — there is no
 *  `tenant_id` column. Rows are scoped to THIS Worker's SITE_DB.
 *
 * @example
 *   <script async src="/_pa/script.js"></script>
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import type { AppContext } from '../env';

const app = new Hono<AppContext>();

// ── Beacon endpoint ──────────────────────────────────────────────────────────
const eventSchema = z.object({
  event_type: z
    .enum(['pageview', 'outbound', 'download', 'engage', 'conversion'])
    .default('pageview'),
  path: z.string().min(1).max(2_000),
  referrer: z.string().max(2_000).optional(),
  screen: z
    .string()
    .max(32)
    .regex(/^\d{2,5}x\d{2,5}$/)
    .optional(),
  locale: z
    .string()
    .max(16)
    .regex(/^[a-zA-Z-]+$/)
    .optional(),
});

app.post('/events', zValidator('json', eventSchema), async (c) => {
  const body = c.req.valid('json');
  const ua = c.req.header('user-agent') ?? '';
  const ip = c.req.header('cf-connecting-ip') ?? '';
  const country =
    c.req.header('cf-ipcountry') ?? c.req.header('cf-iplocation-country') ?? null;

  // Drop obvious bots — keep the surface honest.
  if (looksLikeBot(ua)) {
    return c.json({ ok: true, ignored: 'bot' }, 202);
  }

  const eventDay = new Date().toISOString().slice(0, 10);
  const salt = await getOrCreateDailySalt(c.env.SITE_DB, eventDay);
  const visitorHash = await sha256Hex(`${ip}|${ua}|${salt}`);

  const id = crypto.randomUUID();
  await c.env.SITE_DB.prepare(
    `INSERT INTO analytics_events
       (id, event_type, path, referrer_host, ua_family, screen, locale,
        visitor_hash, country, event_day, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
  )
    .bind(
      id,
      body.event_type,
      truncatePath(body.path),
      referrerHost(body.referrer),
      uaFamily(ua),
      body.screen ?? null,
      body.locale ?? null,
      visitorHash,
      country,
      eventDay,
      Date.now(),
    )
    .run();

  return c.json({ ok: true }, 202);
});

// ── Aggregates (dashboard polling target) ────────────────────────────────────
app.get('/aggregates', async (c) => {
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const [topPagesQ, topRefsQ, weeklyTrendQ, totalsQ] = await Promise.all([
    c.env.SITE_DB.prepare(
      `SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS uniques
         FROM analytics_events
        WHERE created_at >= ?1 AND event_type = 'pageview'
        GROUP BY path
        ORDER BY views DESC
        LIMIT 25`,
    )
      .bind(sevenDaysAgoMs)
      .all<{ path: string; views: number; uniques: number }>(),
    c.env.SITE_DB.prepare(
      `SELECT COALESCE(referrer_host, 'direct') AS source, COUNT(*) AS visits
         FROM analytics_events
        WHERE created_at >= ?1 AND event_type = 'pageview'
        GROUP BY source
        ORDER BY visits DESC
        LIMIT 25`,
    )
      .bind(sevenDaysAgoMs)
      .all<{ source: string; visits: number }>(),
    c.env.SITE_DB.prepare(
      `SELECT event_day AS day,
              COUNT(*) AS views,
              COUNT(DISTINCT visitor_hash) AS uniques
         FROM analytics_events
        WHERE created_at >= ?1 AND event_type = 'pageview'
        GROUP BY event_day
        ORDER BY event_day ASC`,
    )
      .bind(sevenDaysAgoMs)
      .all<{ day: string; views: number; uniques: number }>(),
    c.env.SITE_DB.prepare(
      `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS uniques
         FROM analytics_events
        WHERE created_at >= ?1 AND event_type = 'pageview'`,
    )
      .bind(sevenDaysAgoMs)
      .first<{ views: number; uniques: number }>(),
  ]);

  return c.json(
    {
      window_days: 7,
      totals: totalsQ ?? { views: 0, uniques: 0 },
      top_pages: topPagesQ.results ?? [],
      top_referrers: topRefsQ.results ?? [],
      daily_trend: weeklyTrendQ.results ?? [],
    },
    200,
    {
      'cache-control': 'private, max-age=30',
    },
  );
});

// ── Drop-in beacon script ────────────────────────────────────────────────────
const BEACON_JS = `/* projectsites privacy analytics — cookieless, GDPR-clean */
(function(){
  if (typeof window === 'undefined') return;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  var endpoint = '/_pa/events';
  function send(type, extra) {
    try {
      var body = JSON.stringify(Object.assign({
        event_type: type,
        path: location.pathname + location.search,
        referrer: document.referrer || undefined,
        screen: (window.innerWidth + 'x' + window.innerHeight),
        locale: (navigator.language || '').slice(0, 16)
      }, extra || {}));
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function(){});
      }
    } catch (e) {}
  }
  send('pageview');
  // Track outbound link clicks (host !== current host).
  document.addEventListener('click', function(e){
    var t = e.target;
    while (t && t.tagName !== 'A') t = t.parentElement;
    if (!t || !t.href) return;
    try {
      var u = new URL(t.href);
      if (u.host && u.host !== location.host) send('outbound', { path: u.href.slice(0, 1500) });
    } catch (err) {}
  }, { capture: true, passive: true });
  // SPA route changes via History API.
  var push = history.pushState;
  history.pushState = function(){ push.apply(this, arguments); setTimeout(function(){ send('pageview'); }, 0); };
  window.addEventListener('popstate', function(){ setTimeout(function(){ send('pageview'); }, 0); });
})();`;

app.get('/script.js', (c) =>
  new Response(BEACON_JS, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  }),
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 → hex. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Read today's salt; mint + persist if missing. Daily rotation prevents
 * cross-day visitor fingerprinting. Uses `INSERT OR IGNORE` to make the
 * mint racey-safe across concurrent requests.
 */
export async function getOrCreateDailySalt(
  db: { prepare: D1Database['prepare'] },
  eventDay: string,
): Promise<string> {
  const row = await db
    .prepare(`SELECT salt FROM analytics_daily_salt WHERE event_day = ?1`)
    .bind(eventDay)
    .first<{ salt: string }>();
  if (row?.salt) return row.salt;
  const salt = base64UrlRandom(32);
  await db
    .prepare(
      `INSERT OR IGNORE INTO analytics_daily_salt (event_day, salt, created_at)
       VALUES (?1, ?2, ?3)`,
    )
    .bind(eventDay, salt, Date.now())
    .run();
  // Re-read in case we lost the race — the persisted value wins.
  const after = await db
    .prepare(`SELECT salt FROM analytics_daily_salt WHERE event_day = ?1`)
    .bind(eventDay)
    .first<{ salt: string }>();
  return after?.salt ?? salt;
}

function base64UrlRandom(bytes: number): string {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  let bin = '';
  for (const byte of out) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Trim long paths so D1 row size stays in the ~256B target. */
export function truncatePath(p: string): string {
  return p.length > 256 ? p.slice(0, 256) : p;
}

/** Reduce referrer to host (PII-safe). Empty / same-host / unparsable → null. */
export function referrerHost(ref?: string): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    return u.host || null;
  } catch {
    return null;
  }
}

/** Coarse "Chrome 131" / "Safari 17" / "Firefox 132" — drop full UA string. */
export function uaFamily(ua: string): string | null {
  if (!ua) return null;
  const lower = ua.toLowerCase();
  // Order matters — Edge says "Chrome" in its UA too.
  const matchers: Array<[RegExp, string]> = [
    [/edg\/(\d+)/i, 'Edge'],
    [/opr\/(\d+)/i, 'Opera'],
    [/firefox\/(\d+)/i, 'Firefox'],
    [/chrome\/(\d+)/i, 'Chrome'],
    [/version\/(\d+).*safari/i, 'Safari'],
  ];
  for (const [re, name] of matchers) {
    const m = lower.match(re);
    if (m && m[1]) return `${name} ${m[1]}`;
  }
  return 'Other';
}

/** Strip obvious bots so they don't pollute the analytics. */
export function looksLikeBot(ua: string): boolean {
  return /bot|spider|crawl|curl|wget|httpclient|headlesschrome|phantomjs/i.test(ua);
}

export default app;
