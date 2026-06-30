/**
 * Lago billing — thin Worker shim that starts the Lago container.
 * The container runs lago-api (Rails :3000) with lago-front baked into public/.
 *
 * All HTTP traffic is forwarded to the container. The Worker exists only to
 * satisfy wrangler.toml's `main` requirement and route requests to the DO.
 */
import { LagoContainerDO } from 'cloudflare:containers';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = env.LAGO.get(env.LAGO.idFromName('lago'));
    return container.fetch(request);
  },
};

interface Env {
  LAGO: DurableObjectNamespace<LagoContainerDO>;
}
