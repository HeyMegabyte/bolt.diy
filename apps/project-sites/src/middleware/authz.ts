/**
 * @module middleware/authz
 *
 * @description
 * `requireAuthz(relation, getObject)` — the reusable authorization enforcement
 * middleware (§61/§67). It resolves the caller (`c.get('userId')`, set by the
 * auth middleware), the target object from the request, and runs
 * `authz.check({ user, relation, object })`. Unauthenticated → 401; not permitted
 * → 403; both serialized through the shared taxonomy (§62). Object-level checks
 * on every tenant-owned-resource-by-id route are how BOLA is prevented (§61).
 *
 * `getAuthorizationProvider(env)` selects the provider: the real OpenFGA adapter
 * when configured (follow-on), else `DenyAllAuthorizationProvider` — fail-closed
 * (§58). NOT for the public static hot path (§29).
 *
 * @see docs/adr/0005-openfga-authorization-graph.md
 */

import type { MiddlewareHandler, Context } from 'hono';
import type { Env, Variables } from '../types/env.js';
import {
  DenyAllAuthorizationProvider,
  type AuthorizationProvider,
} from '../platform/authorization.js';
import { OpenFgaAuthorizationProvider } from '../services/openfga_provider.js';
import { ForbiddenError, UnauthorizedError, toErrorResponse } from '../platform/errors.js';

type Ctx = { Bindings: Env; Variables: Variables };

export interface AuthzDeps {
  readonly provider?: AuthorizationProvider;
}

/**
 * Resolve the authorization provider for this request. DenyAll until the real
 * OpenFGA adapter is wired (fail-closed). Injectable for tests.
 */
export function getAuthorizationProvider(env: Env, deps: AuthzDeps = {}): AuthorizationProvider {
  if (deps.provider) return deps.provider;
  if (env.OPENFGA_API_URL && env.OPENFGA_STORE_ID) {
    return new OpenFgaAuthorizationProvider({
      apiUrl: env.OPENFGA_API_URL,
      storeId: env.OPENFGA_STORE_ID,
      authToken: env.OPENFGA_AUTH_TOKEN,
      modelId: env.OPENFGA_MODEL_ID,
    });
  }
  return new DenyAllAuthorizationProvider();
}

/**
 * Guard a route: require `relation` on the object derived by `getObject`.
 *
 * @param relation - a permission (e.g. `can_publish`) or role.
 * @param getObject - derives the object id from the request (e.g. `c => \`site:${c.req.param('id')}\``).
 * @param getProvider - resolves the provider (defaults to env-bound).
 * @example app.post('/api/sites/:id/publish', requireAuthz('can_publish', c => `site:${c.req.param('id')}`), handler)
 */
export function requireAuthz(
  relation: string,
  getObject: (c: Context<Ctx>) => string,
  getProvider: (c: Context<Ctx>) => AuthorizationProvider = (c) => getAuthorizationProvider(c.env),
): MiddlewareHandler<Ctx> {
  return async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    const user = c.get('userId');
    if (!user) {
      const { body, status } = toErrorResponse(
        new UnauthorizedError('Authentication required'),
        requestId,
      );
      return c.json(body, status as 401);
    }
    const allowed = await getProvider(c).check({ user, relation, object: getObject(c) });
    if (!allowed) {
      const { body, status } = toErrorResponse(
        new ForbiddenError(`Not permitted: ${relation}`),
        requestId,
      );
      return c.json(body, status as 403);
    }
    await next();
  };
}
