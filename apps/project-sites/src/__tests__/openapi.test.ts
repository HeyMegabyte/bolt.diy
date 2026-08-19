/**
 * @module __tests__/openapi
 * @description Verifies the Zod-derived OpenAPI 3.1 document
 * (`@asteasolutions/zod-to-openapi`) and the route that serves it
 * (`GET /api/openapi.json`, annotated with `hono-openapi` describeRoute).
 */
import { buildOpenApiDocument } from '../platform/openapi.js';
import { openapiRoutes } from '../routes/openapi.js';

describe('buildOpenApiDocument (zod-to-openapi)', () => {
  const doc = buildOpenApiDocument();

  it('emits an OpenAPI 3.1 document with title + servers', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('ProjectSites API');
    expect(doc.servers?.[0]?.url).toBe('https://projectsites.dev');
  });

  it('registers the health path (the search path was removed with vectorize_search, batch 9)', () => {
    expect(doc.paths?.['/health']).toBeDefined();
    expect(doc.paths?.['/api/sites/{id}/search']).toBeUndefined();
  });

  it('derives reusable component schemas from the Zod schemas', () => {
    const schemas = doc.components?.schemas ?? {};
    expect(schemas.ErrorEnvelope).toBeDefined();
    expect(schemas.SearchResponse).toBeUndefined();
    expect(schemas.SearchResult).toBeUndefined();
  });

  it('declares bearerAuth as a security scheme', () => {
    expect(doc.components?.securitySchemes?.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });
});

describe('GET /api/openapi.json route (hono-openapi describeRoute)', () => {
  it('serves the document with 200 + a cache-control header', async () => {
    const res = await openapiRoutes.request('http://local/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age');
    const body = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(body.openapi).toBe('3.1.0');
    expect(body.paths['/health']).toBeDefined();
  });
});
