import { Container, getContainer } from '@cloudflare/containers';

/**
 * langflow.projectsites.dev — Langflow visual AI workflow builder on CF Workers Containers.
 *
 * @remarks
 * Langflow runs as a single CF Container (port 7860): Python FastAPI server that serves
 * both the backend API and the React frontend. The data plane is external: Neon Postgres
 * for app state (users, flows, projects). Redis (Upstash) is optional — only needed when
 * LANGFLOW_WORKERS > 1 for cross-worker build queue consistency. R2-backed S3 storage is
 * attempted via `LANGFLOW_STORAGE_TYPE=s3` + custom endpoint env vars.
 */
interface Env {
  LANGFLOW: DurableObjectNamespace<LangflowContainerDO>;
  // ── Secrets forwarded into the container ──
  LANGFLOW_SECRET_KEY: string;
  LANGFLOW_SUPERUSER: string;
  LANGFLOW_SUPERUSER_PASSWORD: string;
  LANGFLOW_DATABASE_URL: string;
  // ── Optional Redis (only if multi-worker) ──
  LANGFLOW_REDIS_QUEUE_URL?: string;
  // ── API key for programmatic access ──
  LANGFLOW_API_KEY?: string;
  // ── Optional R2/S3 storage ──
  LANGFLOW_STORAGE_ACCESS_KEY_ID?: string;
  LANGFLOW_STORAGE_SECRET_ACCESS_KEY?: string;
  LANGFLOW_STORAGE_BUCKET_NAME?: string;
  LANGFLOW_STORAGE_ENDPOINT_URL?: string;
}

export class LangflowContainerDO extends Container<Env> {
  override defaultPort = 7860;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const pairs: Record<string, string | undefined> = {
      LANGFLOW_HOST: '0.0.0.0',
      LANGFLOW_PORT: '7860',
      LANGFLOW_AUTO_LOGIN: 'false',
      LANGFLOW_OPEN_BROWSER: 'false',
      LANGFLOW_LOG_LEVEL: 'info',
      LANGFLOW_SECRET_KEY: env.LANGFLOW_SECRET_KEY,
      LANGFLOW_SUPERUSER: env.LANGFLOW_SUPERUSER,
      LANGFLOW_SUPERUSER_PASSWORD: env.LANGFLOW_SUPERUSER_PASSWORD,
      LANGFLOW_DATABASE_URL: env.LANGFLOW_DATABASE_URL,
      LANGFLOW_API_KEY: env.LANGFLOW_API_KEY,
      // Single worker by default; set LANGFLOW_WORKERS > 1 + Redis to scale.
      LANGFLOW_WORKERS: '1',
      // Auto-activate new users — no superuser approval required.
      // Langflow has NO built-in SMTP or OAuth/SSO (username+password only).
      LANGFLOW_NEW_USER_IS_ACTIVE: 'true',
    };

    // Optional Redis for multi-worker mode
    if (env.LANGFLOW_REDIS_QUEUE_URL) {
      pairs.LANGFLOW_REDIS_QUEUE_URL = env.LANGFLOW_REDIS_QUEUE_URL;
      pairs.LANGFLOW_JOB_QUEUE_TYPE = 'redis';
    }

    // Optional R2/S3 storage
    if (
      env.LANGFLOW_STORAGE_ACCESS_KEY_ID &&
      env.LANGFLOW_STORAGE_SECRET_ACCESS_KEY &&
      env.LANGFLOW_STORAGE_BUCKET_NAME
    ) {
      pairs.LANGFLOW_STORAGE_TYPE = 's3';
      pairs.LANGFLOW_OBJECT_STORAGE_BUCKET_NAME = env.LANGFLOW_STORAGE_BUCKET_NAME;
      pairs.LANGFLOW_OBJECT_STORAGE_PREFIX = 'langflow/';
      pairs.AWS_ACCESS_KEY_ID = env.LANGFLOW_STORAGE_ACCESS_KEY_ID;
      pairs.AWS_SECRET_ACCESS_KEY = env.LANGFLOW_STORAGE_SECRET_ACCESS_KEY;
      pairs.AWS_DEFAULT_REGION = 'auto';
      if (env.LANGFLOW_STORAGE_ENDPOINT_URL) {
        pairs.AWS_ENDPOINT_URL_S3 = env.LANGFLOW_STORAGE_ENDPOINT_URL;
      }
    }

    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(pairs)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    this.envVars = out;
  }

  override async onError(error: unknown): Promise<Response> {
    console.error('[langflow onError]', error instanceof Error ? error.message : String(error));
    throw error;
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 7860,
      // Langflow boots Python + FastAPI + runs DB migrations — generous window.
      cancellationOptions: { portReadyTimeoutMS: 180_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.LANGFLOW, 'singleton');
    return container.fetch(request);
  },
};
