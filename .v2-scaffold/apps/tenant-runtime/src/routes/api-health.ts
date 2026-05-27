/**
 * Health endpoint — `GET /api/health`.
 *
 * @remarks
 *  Returns 200 + tenant identity + binding probe results. Used by uptime
 *  monitors and by the control-plane's tenant-health roll-up.
 */
import { Hono } from 'hono';
import type { AppContext } from '../env';

const app = new Hono<AppContext>();

app.get('/', async (c) => {
  const probes: Record<string, 'ok' | 'fail'> = {
    site_db: 'fail',
    bucket: 'fail',
    kv: 'fail',
  };

  try {
    await c.env.SITE_DB.prepare('SELECT 1 as ok').first();
    probes['site_db'] = 'ok';
  } catch {
    /* noop */
  }
  try {
    await c.env.KV.get('health-probe');
    probes['kv'] = 'ok';
  } catch {
    /* noop */
  }
  try {
    await c.env.BUCKET.head(`sites/${c.env.TENANT_SLUG}/${c.env.SITE_VERSION}/index.html`);
    probes['bucket'] = 'ok';
  } catch {
    /* noop */
  }

  const healthy = Object.values(probes).every((v) => v === 'ok');
  return c.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      tenant: { slug: c.env.TENANT_SLUG, id: c.env.TENANT_ID, name: c.env.TENANT_NAME },
      version: c.env.SITE_VERSION,
      environment: c.env.ENVIRONMENT,
      probes,
      timestamp: Date.now(),
    },
    healthy ? 200 : 503,
  );
});

export default app;
