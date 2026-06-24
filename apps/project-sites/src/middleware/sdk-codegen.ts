/**
 * @module middleware/sdk-codegen
 *
 * @description
 * Stainless adapter + factory for the §47 SDK-codegen port. Submits the OpenAPI
 * spec to the Stainless API (fetch-based, no SDK) to (re)generate typed client
 * SDKs. With no `STAINLESS_API_KEY` the factory returns {@link NoopSdkCodegenProvider}
 * (ships dark; codegen never runs). Fail-soft: any error → `status: 'error'`.
 *
 * NOTE: the exact Stainless REST contract is finalized when the key is provisioned;
 * `baseUrl` + endpoint path are configurable so the wiring is a config change, not
 * a code change. The tested value here is the gating + request shaping + fail-soft.
 *
 * @see platform/sdk-codegen.ts (the port + Noop + Fake)
 */
import type { Env } from '../types/env.js';
import {
  NoopSdkCodegenProvider,
  SdkCodegenConfigSchema,
  type SdkCodegenConfig,
  type SdkCodegenProvider,
  type SdkGenerationResult,
} from '../platform/sdk-codegen.js';

/** Stainless adapter — POSTs the spec to `{baseUrl}/api/spec` under the project. */
export class StainlessSdkCodegenProvider implements SdkCodegenProvider {
  readonly name = 'stainless-sdk-codegen';
  constructor(
    private readonly config: SdkCodegenConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generate(spec: unknown): Promise<SdkGenerationResult> {
    const body = typeof spec === 'string' ? spec : JSON.stringify(spec);
    try {
      const res = await this.fetchImpl(`${this.config.baseUrl}/api/spec`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
          'x-stainless-project': this.config.project,
        },
        body,
      });
      if (!res.ok) {
        return { status: 'error', project: this.config.project, message: `stainless HTTP ${res.status}` };
      }
      return { status: 'submitted', project: this.config.project, message: 'spec submitted' };
    } catch (e) {
      return {
        status: 'error',
        project: this.config.project,
        message: e instanceof Error ? e.message : 'fetch failed',
      };
    }
  }
}

/**
 * Resolve the active SDK-codegen provider. Returns the Stainless adapter when
 * `STAINLESS_API_KEY` is set (+ valid config), else {@link NoopSdkCodegenProvider}
 * (ships dark — `generate()` resolves `skipped`).
 *
 * @example
 * const gen = getSdkCodegenProvider(env);
 * const r = await gen.generate(openapiSpec); // {status:'skipped'} until STAINLESS_API_KEY set
 */
export function getSdkCodegenProvider(env: Env, fetchImpl: typeof fetch = fetch): SdkCodegenProvider {
  const parsed = SdkCodegenConfigSchema.safeParse({
    apiKey: env.STAINLESS_API_KEY,
    project: env.STAINLESS_PROJECT ?? undefined,
    baseUrl: undefined,
  });
  if (!parsed.success) return new NoopSdkCodegenProvider();
  return new StainlessSdkCodegenProvider(parsed.data, fetchImpl);
}
