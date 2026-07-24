import { Container, getContainer } from '@cloudflare/containers';

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
    const dbJson = JSON.stringify({ client: 'pg', connection: { host: env.NC_DB_HOST, port: parseInt(env.NC_DB_PORT || '5432', 10), user: env.NC_DB_USER, password: env.NC_DB_PASSWORD, database: env.NC_DB_NAME, ssl: true } });
    this.envVars = {
      NODE_ENV: 'production',
      NC_DB_JSON: dbJson,
      NC_AUTH_JWT_SECRET: env.NC_AUTH_JWT_SECRET,
      NC_SITE_URL: 'https://db.projectsites.dev',
      NC_CACHE_REDIS_URL: env.NC_CACHE_REDIS_URL,
      NC_JOBS_REDIS_URL: env.NC_CACHE_REDIS_URL,
      NC_S3_BUCKET_NAME: env.NC_S3_BUCKET_NAME,
      NC_S3_REGION: env.NC_S3_REGION || 'auto',
      NC_S3_ENDPOINT: env.NC_S3_ENDPOINT,
      NC_S3_ACCESS_KEY: env.NC_S3_ACCESS_KEY,
      NC_S3_ACCESS_SECRET: env.NC_S3_ACCESS_SECRET,
      NC_S3_FORCE_PATH_STYLE: 'true',
      NC_DISABLE_TELE: 'true',
      NC_DISABLE_ERR_REPORTS: 'true',
      NC_INVITE_ONLY_SIGNUP: 'true',
      NC_DASHBOARD_URL: '/dashboard',
      NC_ATTACHMENT_FIELD_SIZE: '52428800',
      NC_MAX_ATTACHMENTS_ALLOWED: '25',
    };
  }

  async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 8080,
      cancellationOptions: { portReadyTimeoutMS: 240_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.NOCODB) {
      return new Response(
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DB · ProjectSites</title><style>body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}div{text-align:center}h1{font-size:2rem;margin-bottom:.5rem}p{color:#94a3b8}a{color:#00e5ff}</style></head><body><div><h1>DB</h1><p>NocoDB is provisioning.</p></div></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
      );
    }
    const container = getContainer(env.NOCODB, 'singleton');
    return container.fetch(request);
  },
};
