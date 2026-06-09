/**
 * storefront_ecommerce — per-site product catalog CRUD (flag: storefront_ecommerce).
 *
 *   GET    /api/sites/:id/products            → list the site's active catalog
 *   POST   /api/sites/:id/products            → create a product
 *   DELETE /api/sites/:id/products/:productId → soft-delete a product
 *
 * Tenant-scoped (org + site), Zod-validated, flag-gated (404 when off). D1-backed
 * via the storefront_products table (migration 0539).
 */

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { dbQuery, dbInsert, dbUpdate } from '../services/db.js';

/** Owner-supplied product fields. Exported for unit tests. */
export const ProductInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().default(''),
  price_cents: z.number().int().min(0).max(100_000_000),
  currency: z.string().trim().length(3).toUpperCase().optional().default('USD'),
  image_url: z.string().url().startsWith('https://').max(2048).optional(),
  sku: z.string().trim().max(64).optional(),
  stock: z.number().int().min(0).max(1_000_000).nullable().optional(),
  status: z.enum(['active', 'hidden', 'archived']).optional().default('active'),
});
export type ProductInput = z.infer<typeof ProductInput>;

interface ProductRow {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  sku: string | null;
  stock: number | null;
  status: string;
  created_at: string;
}

export const storefront = new Hono<{ Bindings: Env; Variables: Variables }>();

async function gate(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<boolean> {
  return isFlagOn(c.env, 'storefront_ecommerce', { siteId: c.req.param('id'), orgId: c.get('orgId'), userId: c.get('userId') });
}

storefront.get('/api/sites/:id/products', async (c) => {
  if (!(await gate(c))) return c.notFound();
  const orgId = c.get('orgId');
  const siteId = c.req.param('id');
  if (!orgId) return c.json({ products: [] });
  const { data } = await dbQuery<ProductRow>(
    c.env.DB,
    'SELECT id, name, description, price_cents, currency, image_url, sku, stock, status, created_at FROM storefront_products WHERE org_id = ? AND site_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500',
    [orgId, siteId],
  );
  return c.json({ products: data });
});

storefront.post('/api/sites/:id/products', async (c) => {
  if (!(await gate(c))) return c.notFound();
  const orgId = c.get('orgId');
  const siteId = c.req.param('id');
  if (!orgId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to manage products.' } }, 401);

  const parsed = ProductInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Check the product fields (name + a price in cents are required; image must be https).' } }, 400);
  }
  const id = crypto.randomUUID();
  const { error } = await dbInsert(c.env.DB, 'storefront_products', {
    id,
    org_id: orgId,
    site_id: siteId,
    name: parsed.data.name,
    description: parsed.data.description,
    price_cents: parsed.data.price_cents,
    currency: parsed.data.currency,
    image_url: parsed.data.image_url ?? null,
    sku: parsed.data.sku ?? null,
    stock: parsed.data.stock ?? null,
    status: parsed.data.status,
  });
  if (error) return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Could not save the product.' } }, 500);
  return c.json({ id }, 201);
});

storefront.delete('/api/sites/:id/products/:productId', async (c) => {
  if (!(await gate(c))) return c.notFound();
  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to manage products.' } }, 401);
  const { changes } = await dbUpdate(
    c.env.DB,
    'storefront_products',
    { deleted_at: new Date().toISOString() },
    'id = ? AND org_id = ? AND site_id = ? AND deleted_at IS NULL',
    [c.req.param('productId'), orgId, c.req.param('id')],
  );
  if (!changes) return c.json({ error: { code: 'NOT_FOUND', message: 'Product not found.' } }, 404);
  return c.json({ ok: true });
});
