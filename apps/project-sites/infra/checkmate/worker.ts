import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  CHECKMATE: DurableObjectNamespace<CheckmateContainerDO>;
}

export class CheckmateContainerDO extends Container<Env> {
  defaultPort = 80;
  sleepAfter = '30m';

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: [80],
      cancellationOptions: { portReadyTimeoutMS: 120_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Proxy /api/* and /api-docs/* to Fly.io backend (Worker outbound fetch works)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/api-docs/')) {
      const backend = 'https://projectsites-checkmate.fly.dev';
      const target = backend + url.pathname + url.search;
      return fetch(target, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });
    }

    // Everything else → CF Container (nginx + React SPA)
    const container = getContainer(env.CHECKMATE, 'singleton');
    return container.fetch(request);
  },
};
