import { Container, getContainer } from '@cloudflare/containers';

/**
 * db.projectsites.dev — NocoDB on CF Workers Containers.
 *
 * NocoDB Airtable-alternative backed by:
 *   - Neon Postgres (project royal-shape-97525164, db neondb)
 *   - Upstash Redis (cache + job queue)
 *   - Cloudflare R2 (S3-compatible attachment storage)
 *
 * AGPL — HTTP boundary isolation per agpl-isolation-via-http-boundary.
 * Deploy 2026-06-29 — v1, matching Dittofeed pattern.
 */
interface Env {
  NOCODB: DurableObjectNamespace<Nocodb>;
  NC_DB_HOST: string;
  NC_DB_PORT: string;
  NC_DB_USER: string;
  NC_DB_PASSWORD: string;
  NC_DB_NAME: string;
  NC_AUTH_JWT_SECRET: string;
  NC_CACHE_REDIS_URL: string;
  NC_S3_BUCKET_NAME: string;
  NC_S3_REGION: string;
  NC_S3_ENDPOINT: string;
  NC_S3_ACCESS_KEY: string;
  NC_S3_ACCESS_SECRET: string;
}

export class Nocodb extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // NocoDB uses pg:// format: pg://host:port?u=user&p=password&d=database
    const ncDb = `pg://${env.NC_DB_HOST}:${env.NC_DB_PORT || '5432'}?u=${env.NC_DB_USER}&p=${encodeURIComponent(env.NC_DB_PASSWORD)}&d=${env.NC_DB_NAME}`;

    this.envVars = {
      NODE_ENV: 'production',
      NC_DB: ncDb,
      NC_AUTH_JWT_SECRET: env.NC_AUTH_JWT_SECRET,
      NC_SITE_URL: 'https://db.projectsites.dev',
      // Redis for caching and job queue
      NC_CACHE_REDIS_URL: env.NC_CACHE_REDIS_URL,
      NC_JOBS_REDIS_URL: env.NC_CACHE_REDIS_URL,
      // R2 as S3-compatible attachment storage
      NC_S3_BUCKET_NAME: env.NC_S3_BUCKET_NAME,
      NC_S3_REGION: env.NC_S3_REGION || 'auto',
      NC_S3_ENDPOINT: env.NC_S3_ENDPOINT,
      NC_S3_ACCESS_KEY: env.NC_S3_ACCESS_KEY,
      NC_S3_ACCESS_SECRET: env.NC_S3_ACCESS_SECRET,
      NC_S3_FORCE_PATH_STYLE: 'true',
      // Product config
      NC_DISABLE_TELE: 'true',
      NC_DISABLE_ERR_REPORTS: 'true',
      NC_INVITE_ONLY_SIGNUP: 'true',
      NC_DASHBOARD_URL: '/dashboard',
      // Attachment limits (generous for video/audio in cells)
      NC_ATTACHMENT_FIELD_SIZE: '52428800', // 50 MiB
      NC_MAX_ATTACHMENTS_ALLOWED: '25',
    };
  }

  async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 8080,
      cancellationOptions: {
        portReadyTimeoutMS: 240_000,
        instanceGetTimeoutMS: 30_000,
      },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.NOCODB) {
      return new Response(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><title>DB · ProjectSites</title><style>body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}div{text-align:center}h1{font-size:2rem;margin-bottom:.5rem}p{color:#94a3b8}a{color:#00e5ff}</style></head><body><div><h1>DB</h1><p>NocoDB is provisioning.</p></div></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
      );
    }
    const container = getContainer(env.NOCODB, 'singleton');
    return container.fetch(request);
  },
};
