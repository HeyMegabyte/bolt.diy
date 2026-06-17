/**
 * @module libs/features/storefront_ecommerce/handlers
 * @description Hono routes for the AI Storefront and Product Catalog feature module.
 *
 * | Method | Path                          | Purpose                                 |
 * | ------ | ----------------------------- | --------------------------------------- |
 * | GET    | /api/storefront/catalog       | Paginated product catalog for a site    |
 * | GET    | /api/storefront/products/:id  | Single product detail                   |
 * | POST   | /api/storefront/cart          | Upsert cart (create or update lines)    |
 *
 * All routes 404 when the `storefront_ecommerce` flag is off (never 403 — do not
 * leak feature existence) per [[feature-flags]]. Missing auth gets 401.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import {
  FLAG_KEY,
  getCatalog,
  getProductById,
  getCart,
  saveCart,
} from './service.js';
import {
  CatalogQuerySchema,
  CatalogResponseSchema,
  ProductDetailResponseSchema,
  UpsertCartBodySchema,
  CartResponseSchema,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const storefrontEcommerce = new Hono<AppContext>();

const unauthorized = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

const notFound = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

const badRequest = (c: import('hono').Context<AppContext>, message: string) =>
  c.json({ error: { code: 'BAD_REQUEST', message } }, 400);

/** Auth + flag gate. Returns a Response to short-circuit, or null to proceed. */
async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

/** Paginated product catalog for the site associated with the caller org. */
storefrontEcommerce.get('/api/storefront/catalog', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return badRequest(c, 'No org context');

  const siteId = new URL(c.req.url).searchParams.get('siteId');
  if (!siteId) return badRequest(c, 'siteId query param is required');

  const queryParsed = CatalogQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!queryParsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', issues: queryParsed.error.issues } }, 422);
  }

  const { products, total, categories } = await getCatalog(c.env, siteId, queryParsed.data);

  return c.json(
    CatalogResponseSchema.parse({
      products,
      count: total,
      page: queryParsed.data.page,
      pageSize: queryParsed.data.pageSize,
      categories,
    }),
  );
});

/** Single product detail by UUID. */
storefrontEcommerce.get('/api/storefront/products/:id', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const productId = c.req.param('id');
  if (!productId) return badRequest(c, 'Product id required');

  const product = await getProductById(c.env, productId);
  if (!product) return notFound(c);

  return c.json(
    ProductDetailResponseSchema.parse({
      ...product,
      relatedProductIds: [],
    }),
  );
});

/** Upsert a cart — creates a new cart or replaces lines on an existing one. */
storefrontEcommerce.post('/api/storefront/cart', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return badRequest(c, 'No org context');

  const rawBody = await c.req.json().catch(() => null);
  const parsed = UpsertCartBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', issues: parsed.error.issues } }, 422);
  }

  const { cartId: incomingCartId, lines } = parsed.data;

  // Derive siteId from the first product if siteId not on the cart already.
  const cartId = incomingCartId ?? randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Resolve all products so we can compute line totals.
  const products = await Promise.all(
    lines.map((line) => getProductById(c.env, line.productId)),
  );

  // 404 if any product is missing.
  const missingIdx = products.findIndex((p) => p === null);
  if (missingIdx !== -1) {
    return c.json({
      error: {
        code: 'NOT_FOUND',
        message: `Product not found: ${lines[missingIdx]!.productId}`,
      },
    }, 404);
  }

  const siteId = products[0]!.siteId;

  // Persist to KV.
  await saveCart(c.env, { cartId, orgId, siteId, lines, updatedAt: now });

  const lineDetails = lines.map((line, i) => ({
    productId: line.productId,
    quantity: line.quantity,
    product: products[i]!,
    lineTotalCents: products[i]!.priceCents * line.quantity,
  }));

  const subtotalCents = lineDetails.reduce((acc, l) => acc + l.lineTotalCents, 0);

  return c.json(
    CartResponseSchema.parse({
      cartId,
      orgId,
      siteId,
      lines: lineDetails,
      subtotalCents,
      currency: products[0]!.currency,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    }),
    201,
  );
});
