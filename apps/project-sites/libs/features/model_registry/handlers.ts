/**
 * @module libs/features/model_registry/handlers
 * @description Hono route handlers for the model-registry feature.
 * Exposes an OpenAI-compatible GET /v1/models endpoint listing all known
 * model aliases with provider availability baked in.
 *
 * | Method | Path       | Auth                              |
 * | ------ | ---------- | --------------------------------- |
 * | GET    | /v1/models | Public — no bearer required.      |
 *
 * Flag-gated: returns 404 (never 403) when the `model_registry` flag is off.
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, MODEL_ALIASES, PROVIDERS, aliasAvailable } from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const modelRegistry = new Hono<AppContext>();

/**
 * GET /v1/models
 *
 * Returns an OpenAI-compatible list of all registered model aliases.
 * All 13 aliases are always included; `_available` reflects whether at
 * least one of the alias's providers has its env keys configured.
 *
 * @returns OpenAI list response `{ object: 'list', data: [...] }`.
 * @throws 404 when the `model_registry` flag is off.
 *
 * @example
 * // curl https://projectsites.dev/v1/models
 * // { "object": "list", "data": [{ "id": "edge-fast", ... }] }
 */
modelRegistry.get('/v1/models', async (c) => {
  // Feature flag gate — 404 (never 403) when disabled.
  if (!(await isFlagOn(c.env, FLAG_KEY, {}))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } }, 404);
  }

  const data = MODEL_ALIASES.map((alias) => {
    // Resolve the _tier from the alias's first provider.
    const firstProvider = PROVIDERS.find((p) => p.id === alias.providers[0]);
    const tier = firstProvider?.tier ?? 'unknown';

    return {
      id: alias.id,
      object: 'model' as const,
      created: 0 as const,
      owned_by: 'projectsites' as const,
      _tier: tier,
      _providers: alias.providers,
      _capabilities: alias.capabilities,
      _available: aliasAvailable(c.env, alias),
    };
  });

  return c.json({ object: 'list' as const, data }, 200);
});
