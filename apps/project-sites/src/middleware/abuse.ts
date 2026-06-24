/**
 * @module middleware/abuse
 *
 * @description
 * `getAbuseProvider(env)` factory + `requireNotAbusive(kind)` Hono middleware
 * for the §48 app-aware abuse layer. Gate a sensitive route:
 * `app.post('/api/claim/...', requireNotAbusive('claim'), handler)`.
 *
 * Fail-OPEN by design: with no `ARCJET_KEY` the factory returns
 * {@link AllowAllAbuseProvider}, so the middleware is a no-op until Arcjet is
 * configured AND the real adapter ships — enabling it never blocks legitimate
 * traffic, and the CF-native `rate_limit.ts` remains the floor.
 *
 * @see platform/abuse.ts (the port + Fake/AllowAll providers)
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { AllowAllAbuseProvider, type AbuseKind, type AbuseProvider } from '../platform/abuse.js';

type Ctx = { Bindings: Env; Variables: Variables };

/** Injectable provider for tests. */
export interface AbuseDeps {
  readonly provider?: AbuseProvider;
}

/**
 * Resolve the abuse provider from env. Returns the real Arcjet adapter once
 * `ARCJET_KEY` is set AND the Workers adapter lands; until then fail-open
 * (AllowAll) so enabling the key is a safe no-op.
 *
 * @example const allowed = (await getAbuseProvider(c.env).decide(ctx)).allow;
 */
export function getAbuseProvider(env: Env, deps: AbuseDeps = {}): AbuseProvider {
  if (deps.provider) return deps.provider;
  // TODO(arcjet §48): return new ArcjetAbuseProvider({ key: env.ARCJET_KEY }) when
  // the Workers-compatible adapter lands. Fail-open until then.
  void env.ARCJET_KEY;
  return new AllowAllAbuseProvider();
}

/**
 * Guard a route: deny (429) when the abuse provider flags the request.
 *
 * @param kind - the surface being protected (selects Arcjet rules).
 * @param getProvider - resolves the provider (defaults to env-bound).
 */
export function requireNotAbusive(
  kind: AbuseKind,
  getProvider: (c: Context<Ctx>) => AbuseProvider = (c) => getAbuseProvider(c.env),
): MiddlewareHandler<Ctx> {
  return async (c, next) => {
    const decision = await getProvider(c).decide({
      ip: c.req.header('cf-connecting-ip') ?? null,
      path: c.req.path,
      kind,
      userId: c.get('userId') ?? null,
      tenantId: c.get('orgId') ?? null,
    });
    if (!decision.allow) {
      if (decision.retryAfterSec) c.header('Retry-After', String(decision.retryAfterSec));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `Request blocked: ${decision.reason ?? 'abuse'}`,
            request_id: c.get('requestId') ?? null,
          },
        },
        429,
      );
    }
    await next();
  };
}
