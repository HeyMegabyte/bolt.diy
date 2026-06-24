/**
 * @module platform/sdk-codegen
 *
 * @description
 * Stainless SDK-generation port (convergence §47, Stainless). Stainless generates
 * typed client SDKs from an OpenAPI spec — the repo already serves one at
 * `GET /api/admin/docs/openapi.json` (OpenAPI 3.1, generated from a hand-curated
 * route table in `routes/docs.ts`). This is genuinely new (no homegrown
 * equivalent): we don't ship a client SDK today. The port submits the spec to
 * Stainless to (re)generate the SDK.
 *
 * Unlike a runtime provider this is a BUILD/CI concern, but it's modeled as a
 * port (interface + Fake + Noop + factory) for the same fail-soft, env-gated
 * shape as the other integrations. The real adapter + `getSdkCodegenProvider(env)`
 * live in `middleware/sdk-codegen.ts`.
 * Ships DARK: with no `STAINLESS_API_KEY` the factory returns
 * {@link NoopSdkCodegenProvider} → every call resolves `status: 'skipped'`.
 *
 * @see routes/docs.ts (the OpenAPI 3.1 spec this feeds)
 * @see middleware/sdk-codegen.ts (Stainless adapter + factory)
 * @see docs/adr/0047-stainless-sdk-codegen.md
 */
import { z } from 'zod';

/** Outcome of an SDK-generation submission. */
export type SdkGenerationStatus = 'skipped' | 'submitted' | 'error';

/** Result returned by {@link SdkCodegenProvider.generate}. */
export interface SdkGenerationResult {
  readonly status: SdkGenerationStatus;
  /** Stainless project slug the spec was published under, when submitted. */
  readonly project?: string;
  /** Human-readable detail (skip reason / error message / build id). */
  readonly message?: string;
}

/** Validated Stainless config (present only when an API key is set). */
export const SdkCodegenConfigSchema = z.object({
  apiKey: z.string().min(1),
  project: z.string().min(1).default('project-sites'),
  /** Stainless API base; overridable for self-host / testing. */
  baseUrl: z.string().url().default('https://api.stainless.com'),
});
export type SdkCodegenConfig = z.infer<typeof SdkCodegenConfigSchema>;

/**
 * Submits an OpenAPI spec to a codegen backend. MUST fail soft — never throw into
 * the caller; a generation failure returns `status: 'error'`.
 */
export interface SdkCodegenProvider {
  readonly name: string;
  /** @param spec - the OpenAPI 3.1 document (object or JSON string). */
  generate(spec: unknown): Promise<SdkGenerationResult>;
}

/** Dark default when Stainless is unconfigured — always `skipped`, no network. */
export class NoopSdkCodegenProvider implements SdkCodegenProvider {
  readonly name = 'noop-sdk-codegen';
  async generate(): Promise<SdkGenerationResult> {
    return { status: 'skipped', message: 'STAINLESS_API_KEY unset — SDK codegen disabled' };
  }
}

/**
 * In-memory provider for tests — records submitted specs in {@link FakeSdkCodegenProvider.submitted}.
 *
 * @example
 * const p = new FakeSdkCodegenProvider();
 * await p.generate({ openapi: '3.1.0' }); // { status: 'submitted', project: 'fake' }
 * p.submitted.length === 1
 */
export class FakeSdkCodegenProvider implements SdkCodegenProvider {
  readonly name = 'fake-sdk-codegen';
  readonly submitted: unknown[] = [];
  async generate(spec: unknown): Promise<SdkGenerationResult> {
    this.submitted.push(spec);
    return { status: 'submitted', project: 'fake', message: 'recorded' };
  }
}
