/**
 * Tenant runtime Worker entry — one deploy per generated tenant site.
 *
 * @remarks
 *  Routes:
 *   - `GET /sitemap.xml` + `GET /robots.txt` — generated from tenant D1
 *   - `GET /i18n/:locale.json` — ngx-translate locale payload from R2+KV
 *   - `GET /api/health` — health probe (D1+KV+R2)
 *   - `POST /api/contact` — Turnstile + Resend
 *   - `POST /api/newsletter` — Turnstile + Resend audiences
 *   - `POST /api/pay` — Stripe Link PaymentIntent (1.5% application fee)
 *   - `POST /api/stripe/webhook` — verified, deduped, fanned-out
 *   - `GET *` — static asset serving from R2 `sites/{slug}/{version}/`
 *
 *  All middleware applied globally except payload-limit (POST only) + turnstile
 *  (per-route).
 *
 * @see ARCHITECTURE.md § "Per-tenant runtime"
 */
import { Hono } from 'hono';
import type { AppContext, Env } from './env';
import { securityHeaders } from './middleware/security-headers';
import { requestId } from './middleware/request-id';
import { payloadLimit } from './middleware/payload-limit';
import { onError, notFound } from './middleware/error-handler';
import staticRoutes from './routes/static';
import contactRoutes from './routes/contact';
import payRoutes from './routes/pay';
import stripeWebhookRoutes from './routes/stripe-webhook';
import newsletterRoutes from './routes/newsletter';
import healthRoutes from './routes/api-health';
import { generateRobots, generateSitemap } from './services/sitemap-gen';
import { loadLocaleJson } from './services/i18n-loader';

const app = new Hono<AppContext>();

app.use('*', requestId());
app.use('*', securityHeaders());
app.use('/api/*', payloadLimit());

app.onError(onError);
app.notFound(notFound);

app.get('/sitemap.xml', async (c) => {
  const xml = await generateSitemap(c.env);
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  });
});

app.get('/robots.txt', async (c) => {
  const txt = await generateRobots(c.env);
  return new Response(txt, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  });
});

app.get('/i18n/:locale{[a-z-]+}.json', async (c) => {
  const locale = c.req.param('locale');
  const data = await loadLocaleJson(c.env, locale);
  return c.json(data, 200, {
    'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
  });
});

app.route('/api/health', healthRoutes);
app.route('/api/contact', contactRoutes);
app.route('/api/newsletter', newsletterRoutes);
app.route('/api/pay', payRoutes);
app.route('/api/stripe/webhook', stripeWebhookRoutes);

// Catch-all static serving — must be LAST.
app.route('/', staticRoutes);

export default app;

export type AppType = typeof app;
export type { Env };
