/**
 * @module services/cli_sandbox_config
 * @description Pure config resolver for the CLI tab (Sandbox SDK) embedded
 * Claude Code session.
 *
 * Decides the per-site sandbox id + which LLM provider the embedded agent
 * authenticates against, mirroring the container build path
 * ([[model-routing]] § provider cost tiers): DeepSeek-primary via the
 * Anthropic-compatible endpoint, Anthropic fallback, and
 * `BUILD_LLM_PROVIDER=anthropic` forces Claude even when a DeepSeek key is
 * present. Pure + deterministic — no I/O, same inputs → same output.
 *
 * @packageDocumentation
 */

/** DeepSeek's Anthropic-compatible base URL (Claude Code talks to it unchanged). */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/anthropic';
/** Default DeepSeek model for the embedded build agent. */
const DEEPSEEK_MODEL = 'deepseek-chat';
/** Default Anthropic model when Claude is the resolved provider. */
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

/** The env fields this resolver reads (a subset of the worker Env). */
export interface CliSandboxEnv {
  DEEPSEEK_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  /** Force a provider regardless of key availability; only `'anthropic'` is honored. */
  BUILD_LLM_PROVIDER?: string;
}

/** Resolved sandbox + provider config the CLI tab hands to the embedded agent. */
export interface CliSandboxConfig {
  /** Deterministic per-site sandbox id (`site-${siteId}`). */
  sandboxId: string;
  /** The resolved LLM provider. */
  provider: 'deepseek' | 'anthropic';
  /** Anthropic-compatible base URL (DeepSeek only); `undefined` for native Anthropic. */
  baseUrl?: string;
  /** The bearer token for the resolved provider; `''` when none is configured. */
  authToken: string;
  /** The model id for the resolved provider. */
  model: string;
  /** False when no provider key is available — the caller surfaces a clear error. */
  configured: boolean;
}

/**
 * Resolve the CLI-sandbox provider config for a site.
 *
 * @param siteId - The site the sandbox belongs to (required, non-blank).
 * @param env - The relevant worker env keys ({@link CliSandboxEnv}).
 * @returns A {@link CliSandboxConfig}. `configured:false` (with `authToken:''`)
 *   when neither provider key is set — the caller should surface a clear error
 *   rather than start an unauthenticated sandbox.
 * @throws {Error} When `siteId` is empty or whitespace (a required routing param).
 * @example
 * resolveCliSandboxConfig('site-abc', { DEEPSEEK_API_KEY: 'sk-ds' })
 * // → { sandboxId: 'site-site-abc', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/anthropic', … }
 */
export function resolveCliSandboxConfig(siteId: string, env: CliSandboxEnv): CliSandboxConfig {
  if (!siteId || !siteId.trim()) {
    throw new Error('resolveCliSandboxConfig: siteId is required');
  }

  const sandboxId = `site-${siteId}`;
  const forceAnthropic = env.BUILD_LLM_PROVIDER === 'anthropic';

  if (!forceAnthropic && env.DEEPSEEK_API_KEY) {
    return {
      sandboxId,
      provider: 'deepseek',
      baseUrl: DEEPSEEK_BASE_URL,
      authToken: env.DEEPSEEK_API_KEY,
      model: DEEPSEEK_MODEL,
      configured: true,
    };
  }

  const authToken = env.ANTHROPIC_API_KEY ?? '';
  return {
    sandboxId,
    provider: 'anthropic',
    baseUrl: undefined,
    authToken,
    model: ANTHROPIC_MODEL,
    configured: authToken.length > 0,
  };
}
