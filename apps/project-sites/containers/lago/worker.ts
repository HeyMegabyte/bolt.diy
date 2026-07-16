import { DurableObject } from "cloudflare:workers";

export class LagoContainer extends DurableObject {
  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
  }
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, "");
    const id = env.LAGO_CONTAINER.idFromName("lago-default");
    const stub = env.LAGO_CONTAINER.get(id);
    return stub.fetch(request);
  },
};
