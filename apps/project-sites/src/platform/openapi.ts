/**
 * @module platform/openapi
 * @description Canonical machine-readable OpenAPI 3.1 document, DERIVED from Zod
 * schemas via `@asteasolutions/zod-to-openapi` — never hand-maintained.
 *
 * Zod is the single source of truth at every runtime boundary (per the
 * `zod-everywhere` doctrine); this module re-uses those schemas to emit the
 * OpenAPI document an SDK generator (Stainless) or external client consumes.
 * Served publicly at `GET /api/openapi.json` (see `routes/openapi.ts`).
 *
 * This is the SSOT-derived spec. The authenticated in-product explorer at
 * `GET /api/admin/docs/openapi.json` (routes/docs.ts) remains the richer,
 * hand-curated walkthrough of the full API surface.
 *
 * @see {@link ../routes/openapi.ts} — the route that serves this document
 * @see {@link ./errors.ts} — the runtime error envelope this mirrors
 */
import { z } from 'zod';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';

// Augment Zod with the `.openapi()` metadata helper (idempotent).
extendZodWithOpenApi(z);

/** Standard error envelope (mirrors `platform/errors.ts` / middleware/error_handler). */
export const ErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string().openapi({ example: 'NOT_FOUND' }),
        message: z.string().openapi({ example: 'Site not found' }),
        request_id: z.string().uuid().openapi({ example: '5bdac826-e156-4148-bfe1-08d491d4776d' }),
      })
      .openapi('ApiError'),
  })
  .openapi('ErrorEnvelope');

/** A single scored RAG search hit (mirrors `services/rag.ts` `RagSearchResult`). */
export const SearchResultSchema = z
  .object({
    id: z.string().optional().openapi({ example: 'e2e-site-1::index.html' }),
    score: z.number().openapi({ example: 0.7643 }),
    kind: z.string().openapi({ example: 'site_page' }),
    sourceId: z.string().openapi({ example: 'e2e-site-1' }),
    text: z.string().openapi({ example: 'Acme Bakery — fresh artisan sourdough…' }),
    metadata: z
      .record(z.unknown())
      .openapi({ example: { orgId: 'e2e-test-org', path: 'index.html' } }),
  })
  .openapi('SearchResult');

/** Response body of `GET /api/sites/:id/search`. */
export const SearchResponseSchema = z
  .object({ results: z.array(SearchResultSchema) })
  .openapi('SearchResponse');

/**
 * Build the canonical OpenAPI 3.1 document from the registered Zod schemas +
 * paths. Pure — same output every call; safe to serve per-request on Workers.
 *
 * @returns An OpenAPI 3.1 document object (`openapi: '3.1.0'`).
 *
 * @example
 * const doc = buildOpenApiDocument();
 * doc.openapi; // '3.1.0'
 * doc.paths['/api/sites/{id}/search']; // present
 */
export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const registry = new OpenAPIRegistry();

  // Components (referenced by $ref from the paths below).
  registry.register('ErrorEnvelope', ErrorEnvelopeSchema);
  registry.register('SearchResult', SearchResultSchema);
  registry.register('SearchResponse', SearchResponseSchema);

  const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
  });

  registry.registerPath({
    method: 'get',
    path: '/health',
    summary: 'Health check (KV + R2 probe)',
    responses: {
      200: { description: 'Service healthy' },
      503: { description: 'A dependency is degraded' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/sites/{id}/search',
    summary: 'Semantic search over a site’s published content (flag: vectorize_search)',
    security: [{ [bearer.name]: [] }],
    request: {
      params: z.object({ id: z.string().openapi({ example: 'e2e-site-1' }) }),
      query: z.object({ q: z.string().min(1).max(500).openapi({ example: 'sourdough bread' }) }),
    },
    responses: {
      200: {
        description: 'Ranked semantic results (empty array when the index has no match)',
        content: { 'application/json': { schema: SearchResponseSchema } },
      },
      401: {
        description: 'Unauthenticated',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
      404: { description: 'Site not owned by the caller’s org, or the flag is off' },
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'ProjectSites API',
      version: '1.0.0',
      description:
        'Public, Zod-derived OpenAPI 3.1 document for projectsites.dev. Generated from the SSOT Zod schemas via @asteasolutions/zod-to-openapi — never hand-maintained.',
    },
    servers: [{ url: 'https://projectsites.dev' }],
  });
}
