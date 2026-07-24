import { Container, getContainer } from '@cloudflare/containers';

// telemetry.projectsites.dev — internal OpenTelemetry ingestion point.
// Cloudflare Access policy gates unauthenticated requests at the edge.
// Workers + external services push OTLP here; this DO forwards to the OTel Collector
// which routes signals to Axiom.  Do NOT expose this route publicly without an Access policy.

interface Env {
  TELEMETRY_ROUTER: DurableObjectNamespace<TelemetryRouter>;
  AXIOM_API_TOKEN: string;
  AXIOM_DATASET: string;
}

export class TelemetryRouter extends Container<Env> {
  // OTLP HTTP receiver port — the DO forwards to port 4318 on the Collector container.
  override defaultPort = 4318;
  // Stay warm longer than 30m to absorb bursty telemetry without cold-start latency.
  override sleepAfter = '1h';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      AXIOM_API_TOKEN: env.AXIOM_API_TOKEN,
      AXIOM_DATASET: env.AXIOM_DATASET,
    };
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 4318,
      cancellationOptions: { portReadyTimeoutMS: 60_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.TELEMETRY_ROUTER, 'singleton').fetch(request);
  },
};
