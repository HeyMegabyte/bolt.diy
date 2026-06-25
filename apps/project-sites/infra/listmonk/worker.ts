import { Container, getContainer } from '@cloudflare/containers';

/**
 * mail.projectsites.dev — Listmonk newsletter/list manager on CF Workers Containers.
 *
 * Adapted from njsk.org/infra/listmonk. Listmonk runs as a CF Container (port 9000);
 * its schema + data live in Neon Postgres (CF Containers have no persistent volume),
 * so the container is stateless + hibernates after idle. Mail delivery relays through
 * Amazon SES (ADR-0019) — configured via the LISTMONK_smtp__* env once SES SMTP creds
 * are set as secrets.
 *
 * Deploy: `wrangler deploy` (builds the Dockerfile container image — needs Docker or CI).
 * Reachable at https://mail.projectsites.dev (custom_domain route in wrangler.toml).
 */
interface Env {
  LISTMONK: DurableObjectNamespace<Listmonk>;
  PG_HOST: string;
  PG_PORT: string;
  PG_USER: string;
  PG_PASSWORD: string;
  PG_DATABASE: string;
  /** Amazon SES SMTP relay (ADR-0019) — optional until set. */
  SES_SMTP_HOST?: string;
  SES_SMTP_USER?: string;
  SES_SMTP_PASSWORD?: string;
}

export class Listmonk extends Container<Env> {
  defaultPort = 9000;
  sleepAfter = '15m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      LISTMONK_app__address: '0.0.0.0:9000',
      // NOTE: app.admin_username/admin_password are DEPRECATED in Listmonk v4 — the
      // env-based bootstrap super-admin is gone. Users are now DB-backed and managed
      // in Admin → Settings → Users. The bootstrap already seeded the DB Super Admin
      // ("professormanhattan", id=1); programmatic access uses the "projectsites_api"
      // API user (token in the main worker's LISTMONK_API_TOKEN secret). Do NOT
      // re-add LISTMONK_app__admin_* here — it re-triggers the deprecation notice.
      LISTMONK_app__root_url: 'https://mail.projectsites.dev',
      LISTMONK_app__from_email: 'ProjectSites <newsletter@projectsites.dev>',
      LISTMONK_app__site_name: 'ProjectSites',
      LISTMONK_db__host: env.PG_HOST,
      LISTMONK_db__port: env.PG_PORT || '5432',
      LISTMONK_db__user: env.PG_USER,
      LISTMONK_db__password: env.PG_PASSWORD,
      LISTMONK_db__database: env.PG_DATABASE,
      LISTMONK_db__ssl_mode: 'require',
      // SES SMTP relay — Listmonk reads LISTMONK_smtp__* on first boot; harmless when unset.
      ...(env.SES_SMTP_HOST
        ? {
            LISTMONK_smtp__0__enabled: 'true',
            LISTMONK_smtp__0__host: env.SES_SMTP_HOST,
            LISTMONK_smtp__0__port: '587',
            LISTMONK_smtp__0__auth_protocol: 'login',
            LISTMONK_smtp__0__username: env.SES_SMTP_USER ?? '',
            LISTMONK_smtp__0__password: env.SES_SMTP_PASSWORD ?? '',
            LISTMONK_smtp__0__tls_type: 'STARTTLS',
          }
        : {}),
      TZ: 'America/New_York',
    };
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 9000,
      cancellationOptions: { portReadyTimeoutMS: 60_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.LISTMONK, 'singleton');
    return container.fetch(request);
  },
};
