import { Container, getContainer } from '@cloudflare/containers';

/**
 * grafana.projectsites.dev — Grafana observability dashboard on CF Containers.
 *
 * Previously proxied to a Fly.io app that was never created. Now runs directly
 * as a CF Container with SQLite for dashboards and preferences.
 */
interface Env {
  GRAFANA: DurableObjectNamespace<Grafana>;
}

export class Grafana extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      GF_SERVER_HTTP_PORT: '3000',
      GF_SERVER_DOMAIN: 'grafana.projectsites.dev',
      GF_SERVER_ROOT_URL: 'https://grafana.projectsites.dev',
      GF_SERVER_ENFORCE_DOMAIN: 'false',
      GF_AUTH_ANONYMOUS_ENABLED: 'false',
      GF_AUTH_DISABLE_LOGIN_FORM: 'false',
      GF_SECURITY_ADMIN_USER: 'admin',
      GF_SECURITY_ALLOW_EMBEDDING: 'true',
      GF_INSTALL_PLUGINS: 'grafana-clock-panel',
      GF_ANALYTICS_REPORTING_ENABLED: 'false',
      GF_ANALYTICS_CHECK_FOR_UPDATES: 'false',
      GF_LOG_MODE: 'console',
      GF_LOG_LEVEL: 'warn',
      GF_PATHS_DATA: '/var/lib/grafana',
      GF_PATHS_LOGS: '/var/log/grafana',
      GF_PATHS_PLUGINS: '/var/lib/grafana/plugins',
      GF_PATHS_PROVISIONING: '/etc/grafana/provisioning',
    };
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 3000,
      cancellationOptions: { portReadyTimeoutMS: 120_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.GRAFANA, 'singleton').fetch(request);
  },
};
