/**
 * @module routes/openapi
 * @description Serves the public, Zod-derived OpenAPI 3.1 document.
 *
 * | Path                  | Purpose                                            |
 * | --------------------- | -------------------------------------------------- |
 * | `GET /api/openapi.json` | Canonical machine-readable spec (zod-to-openapi)  |
 *
 * The document is built by `platform/openapi.ts` from the SSOT Zod schemas via
 * `@asteasolutions/zod-to-openapi`. The route itself is annotated with
 * `hono-openapi`'s `describeRoute` — the go-forward, validation-library-agnostic
 * annotation layer (`describeRoute` + `openAPIRouteHandler`) that supersedes
 * `@hono/zod-openapi` for new OpenAPI work.
 *
 * @see {@link ../platform/openapi.ts} — `buildOpenApiDocument()`
 */
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import type { Env, Variables } from '../types/env.js';
import { buildOpenApiDocument } from '../platform/openapi.js';

export const openapiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Return the canonical OpenAPI 3.1 document for the public API surface.
 *
 * @route GET /api/openapi.json
 * @returns `200` — an OpenAPI 3.1 document (`application/json`).
 */
openapiRoutes.get(
  '/api/openapi.json',
  describeRoute({
    description: 'Canonical OpenAPI 3.1 document, derived from the SSOT Zod schemas.',
    responses: {
      200: { description: 'OpenAPI 3.1 document' },
    },
  }),
  (c) => {
    // Cacheable: the document is static for a given deploy.
    c.header('cache-control', 'public, max-age=300');
    return c.json(buildOpenApiDocument());
  },
);
