/**
 * Provider-neutral browser-automation gateway.
 *
 * @remarks
 * **Cloudflare Browser Rendering is PRIMARY. Browserbase is a PREMIUM FALLBACK,
 * never the default** (the "Browserbase backup-only LAW"). The gateway routes a
 * browser request to:
 *   1. **CF** (`env.BROWSER` via `@cloudflare/playwright`) — the default for all
 *      normal automation + Stagehand NL flows.
 *   2. **Browserbase** — ONLY when CF is unavailable, OR a {@link BrowserSpecialty}
 *      case genuinely requires it (captcha solving, residential proxy, session
 *      replay, live view, long-lived sessions).
 *
 * Stagehand (AI act/extract/observe) layers ON TOP of {@link connectBrowser} —
 * it wraps whichever Playwright `Browser` the gateway returns, so the same NL
 * automation runs on CF by default and Browserbase on escalation without the
 * caller knowing which provider served it.
 *
 * @see https://developers.cloudflare.com/browser-rendering/
 * @see https://docs.browserbase.com/
 */
import { z } from 'zod';
import type { Env } from '../types/env.js';

/** Specialty cases CF Browser Rendering can't serve — these force Browserbase. */
export type BrowserSpecialty =
  | 'captcha'
  | 'residential_proxy'
  | 'session_replay'
  | 'live_view'
  | 'long_session'
  | 'stealth';

export interface BrowserRequestOptions {
  /** A specialty that mandates Browserbase. Omit for normal automation (→ CF). */
  readonly specialty?: BrowserSpecialty;
  /**
   * Explicit per-job backend (the doctrine's `backendPreference`). `skyvern_internal`
   * is internal-only — only an explicitly-routed internal/admin job ever reaches it,
   * never a product/default path. Honoured over the default LAW when set.
   */
  readonly backendPreference?: BrowserProvider;
  /** @deprecated alias for {@link backendPreference}; kept for back-compat. */
  readonly forceProvider?: BrowserProvider;
}

/** `cf` = CF Browser Run (Playwright/Stagehand). `skyvern_internal` = internal-only. */
export type BrowserProvider = 'cf' | 'browserbase' | 'skyvern_internal';

export interface ProviderDecision {
  readonly provider: BrowserProvider;
  /** Why this provider was chosen — for traces + the cost-anomaly watchdog. */
  readonly reason: 'specialty' | 'cf-default' | 'cf-unavailable-fallback' | 'backend-preference';
}

/** True when Browserbase creds are present (it can serve as a fallback). */
function browserbaseConfigured(env: Pick<Env, 'BROWSERBASE_API_KEY' | 'BROWSERBASE_PROJECT_ID'>): boolean {
  return Boolean(env.BROWSERBASE_API_KEY && env.BROWSERBASE_PROJECT_ID);
}

/**
 * Decide which provider serves a browser request — the routing LAW.
 *
 * @returns The provider + the reason (CF is the default; Browserbase only on a
 *   specialty or when CF is unavailable).
 * @throws {BrowserGatewayError} When neither provider is available.
 * @example
 * chooseBrowserProvider({}, env)                       // → { provider:'cf', reason:'cf-default' }
 * chooseBrowserProvider({ specialty:'captcha' }, env)  // → { provider:'browserbase', reason:'specialty' }
 */
export function chooseBrowserProvider(
  opts: BrowserRequestOptions,
  env: Pick<Env, 'BROWSER' | 'BROWSERBASE_API_KEY' | 'BROWSERBASE_PROJECT_ID'>,
): ProviderDecision {
  const hasCf = Boolean(env.BROWSER);
  const hasBb = browserbaseConfigured(env);

  const pref = opts.backendPreference ?? opts.forceProvider;
  if (pref) {
    if (pref === 'browserbase' && !hasBb) {
      throw new BrowserGatewayError('Browserbase requested but BROWSERBASE_* creds are not configured.');
    }
    if (pref === 'cf' && !hasCf) {
      throw new BrowserGatewayError('CF requested but the BROWSER binding is not available.');
    }
    // skyvern_internal is internal-only — the decision returns it, but connectBrowser
    // refuses to execute it (product code never runs Skyvern; the internal layer does).
    return { provider: pref, reason: 'backend-preference' };
  }

  // Specialty cases mandate Browserbase — but only if it's actually configured.
  if (opts.specialty) {
    if (!hasBb) {
      throw new BrowserGatewayError(
        `Specialty "${opts.specialty}" requires Browserbase, but BROWSERBASE_* creds are not configured.`,
      );
    }
    return { provider: 'browserbase', reason: 'specialty' };
  }

  // Default path: CF is primary.
  if (hasCf) return { provider: 'cf', reason: 'cf-default' };

  // CF unavailable → Browserbase is the legitimate fallback.
  if (hasBb) return { provider: 'browserbase', reason: 'cf-unavailable-fallback' };

  throw new BrowserGatewayError('No browser provider available: neither BROWSER binding nor Browserbase creds.');
}

/** Typed error for every gateway failure. */
export class BrowserGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserGatewayError';
  }
}

/** Browserbase session create response (the fields we use). */
const BrowserbaseSessionSchema = z.object({
  id: z.string(),
  /** CDP WebSocket URL Playwright/Stagehand connects to. */
  connectUrl: z.string().url(),
});
export type BrowserbaseSession = z.infer<typeof BrowserbaseSessionSchema>;

/**
 * Create a Browserbase session and return its CDP connect URL.
 *
 * @remarks Impure — calls the Browserbase REST API. `fetchImpl` is injectable
 *   for tests. Never logs the API key.
 * @throws {BrowserGatewayError} On missing creds, a non-2xx response, or a
 *   response that doesn't match the expected shape.
 * @example
 * const { connectUrl } = await createBrowserbaseSession(env);
 */
export async function createBrowserbaseSession(
  env: Pick<Env, 'BROWSERBASE_API_KEY' | 'BROWSERBASE_PROJECT_ID'>,
  fetchImpl: typeof fetch = fetch,
): Promise<BrowserbaseSession> {
  if (!browserbaseConfigured(env)) {
    throw new BrowserGatewayError('BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID are required.');
  }
  let res: Response;
  try {
    res = await fetchImpl('https://api.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'X-BB-API-Key': env.BROWSERBASE_API_KEY as string,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId: env.BROWSERBASE_PROJECT_ID }),
    });
  } catch (err) {
    throw new BrowserGatewayError(`Browserbase session request failed: ${String(err)}`);
  }
  if (!res.ok) {
    throw new BrowserGatewayError(`Browserbase session create returned ${res.status}.`);
  }
  const parsed = BrowserbaseSessionSchema.safeParse(await res.json().catch(() => ({})));
  if (!parsed.success) {
    throw new BrowserGatewayError('Browserbase session response did not match the expected shape.');
  }
  return parsed.data;
}

/** A connected browser + which provider served it + how to release it. */
export interface GatewayBrowser {
  readonly provider: BrowserProvider;
  readonly reason: ProviderDecision['reason'];
  // The concrete browser type comes from `@cloudflare/playwright` (dynamically
  // imported below); kept `unknown` here so this module doesn't pull the heavy
  // browser bundle into callers that only need the routing LAW.
  readonly browser: unknown;
  readonly sessionId?: string;
  release(): Promise<void>;
}

/**
 * Connect a browser per the routing LAW — CF primary, Browserbase fallback.
 *
 * @remarks The returned `browser` is a `@cloudflare/playwright` Browser, ready
 *   to drive directly or to hand to Stagehand. Always `await release()` when done.
 * @throws {BrowserGatewayError} When no provider can serve the request.
 */
export async function connectBrowser(env: Env, opts: BrowserRequestOptions = {}): Promise<GatewayBrowser> {
  const decision = chooseBrowserProvider(opts, env);

  // Skyvern is internal-only — the product browser gateway never executes it.
  // Internal/admin callers route Skyvern jobs through the Megabyte internal layer.
  if (decision.provider === 'skyvern_internal') {
    throw new BrowserGatewayError(
      'skyvern_internal is internal-only and is not executed by the product browser gateway. Route it through the internal Megabyte tooling layer (skyvern.megabyte.space, behind CF Access).',
    );
  }

  const { launch, connect } = await import('@cloudflare/playwright');

  if (decision.provider === 'cf') {
    const browser = await launch(env.BROWSER as Parameters<typeof launch>[0]);
    return {
      provider: 'cf',
      reason: decision.reason,
      browser,
      release: async () => {
        await browser.close();
      },
    };
  }

  // Browserbase: create a session, connect to its CDP endpoint.
  const session = await createBrowserbaseSession(env);
  const browser = await connect(session.connectUrl);
  return {
    provider: 'browserbase',
    reason: decision.reason,
    browser,
    sessionId: session.id,
    release: async () => {
      await browser.close();
    },
  };
}
