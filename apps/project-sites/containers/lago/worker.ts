import { Container } from "@cloudflare/containers";

export class LagoContainerDO extends Container {
  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
  }
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const id = env.LAGO_CONTAINER.idFromName("lago-default");
    const stub = env.LAGO_CONTAINER.get(id);
    return stub.fetch(request);
  },
};
