import { Container, getContainer } from '@cloudflare/containers';

/**
 * monitor.projectsites.dev — Checkmate frontend on CF Workers Container.
 * nginx serves React SPA + proxies /api/* to Fly.io backend.
 * Backend (Node.js + MongoDB) runs on Fly.io at projectsites-checkmate.fly.dev.
 */
interface Env {
  CHECKMATE: DurableObjectNamespace<CheckmateContainerDO>;
}

export class CheckmateContainerDO extends Container<Env> {
  defaultPort = 80;
  sleepAfter = '30m';

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: [80],
      cancellationOptions: { portReadyTimeoutMS: 60_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.CHECKMATE, 'singleton');
    return container.fetch(request);
  },
};
