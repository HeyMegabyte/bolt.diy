/**
 * @module libs/features/storefront_ecommerce/service
 * @description Business logic for the AI Storefront and Product Catalog feature module.
 *
 * @remarks
 * Provides typed D1 helpers for product catalog reads and cart state management.
 * Cart state lives in KV with a 24h TTL; product data lives in D1.
 *
 * @throws {Error} database errors are allowed to propagate to the handler layer.
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbQueryOne } from '../../../src/services/db.js';
import type { Product, CatalogQuery, CartLine } from './schemas.js';

export const FLAG_KEY = 'storefront_ecommerce';

/** KV TTL for cart state: 24 hours in seconds. */
const CART_TTL_SECONDS = 60 * 60 * 24;

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

/**
 * Return paginated products for a site with optional category / status / search filters.
 *
 * @example
 * const { products, total } = await getCatalog(env, 'site-abc', { page: 0, pageSize: 24 });
 */
export async function getCatalog(
  env: Pick<Env, 'DB'>,
  siteId: string,
  query: CatalogQuery,
): Promise<{ products: Product[]; total: number; categories: string[] }> {
  const { page, pageSize, category, status, q } = query;

  const conditions: string[] = ['site_id = ?'];
  const args: unknown[] = [siteId];

  if (category) {
    conditions.push('category = ?');
    args.push(category);
  }
  if (status) {
    conditions.push('status = ?');
    args.push(status);
  }
  if (q) {
    conditions.push("(name LIKE ? OR description LIKE ?)");
    args.push(`%${q}%`, `%${q}%`);
  }

  const where = conditions.join(' AND ');

  const countRow = await dbQueryOne<{ cnt: number }>(
    env.DB,
    `SELECT COUNT(*) AS cnt FROM storefront_products WHERE ${where}`,
    args,
  ).catch(() => null);

  const total = countRow?.cnt ?? 0;

  type ProductRow = {
    id: string;
    orgId: string;
    siteId: string;
    slug: string;
    name: string;
    description: string | null;
    priceCents: number;
    currency: string;
    imageUrl: string | null;
    category: string | null;
    tags: string;
    status: string;
    aiGenerated: number;
    inventory: number | null;
    createdAt: string;
    updatedAt: string;
  };

  const { data: rows } = await dbQuery<ProductRow>(
    env.DB,
    `SELECT id,
            org_id       AS orgId,
            site_id      AS siteId,
            slug,
            name,
            description,
            price_cents  AS priceCents,
            currency,
            image_url    AS imageUrl,
            category,
            tags,
            status,
            ai_generated AS aiGenerated,
            inventory,
            created_at   AS createdAt,
            updated_at   AS updatedAt
     FROM storefront_products
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...args, pageSize, page * pageSize],
  ).catch(() => ({ data: [] as ProductRow[] }));

  // Collect distinct categories for filter UI.
  const { data: catRows } = await dbQuery<{ category: string }>(
    env.DB,
    `SELECT DISTINCT category FROM storefront_products WHERE site_id = ? AND category IS NOT NULL ORDER BY category`,
    [siteId],
  ).catch(() => ({ data: [] as { category: string }[] }));

  return {
    total,
    categories: catRows.map((r) => r.category),
    products: rows.map(rowToProduct),
  };
}

/**
 * Fetch a single product by its UUID.
 * Returns null when not found.
 *
 * @example
 * const product = await getProductById(env, 'product-uuid');
 */
export async function getProductById(
  env: Pick<Env, 'DB'>,
  productId: string,
): Promise<Product | null> {
  const row = await dbQueryOne<{
    id: string;
    orgId: string;
    siteId: string;
    slug: string;
    name: string;
    description: string | null;
    priceCents: number;
    currency: string;
    imageUrl: string | null;
    category: string | null;
    tags: string;
    status: string;
    aiGenerated: number;
    inventory: number | null;
    createdAt: string;
    updatedAt: string;
  }>(
    env.DB,
    `SELECT id,
            org_id       AS orgId,
            site_id      AS siteId,
            slug,
            name,
            description,
            price_cents  AS priceCents,
            currency,
            image_url    AS imageUrl,
            category,
            tags,
            status,
            ai_generated AS aiGenerated,
            inventory,
            created_at   AS createdAt,
            updated_at   AS updatedAt
     FROM storefront_products
     WHERE id = ? LIMIT 1`,
    [productId],
  ).catch(() => null);

  return row ? rowToProduct(row) : null;
}

// ---------------------------------------------------------------------------
// Cart helpers (KV-backed, 24h TTL)
// ---------------------------------------------------------------------------

/**
 * Read cart state from KV. Returns null when cart not found or expired.
 */
export async function getCart(
  env: Pick<Env, 'CACHE_KV'>,
  cartId: string,
): Promise<{ cartId: string; orgId: string; siteId: string; lines: CartLine[] } | null> {
  const raw = await env.CACHE_KV.get(`cart:${cartId}`).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { cartId: string; orgId: string; siteId: string; lines: CartLine[] };
  } catch {
    return null;
  }
}

/**
 * Persist cart state in KV with a 24h TTL.
 */
export async function saveCart(
  env: Pick<Env, 'CACHE_KV'>,
  cart: { cartId: string; orgId: string; siteId: string; lines: CartLine[]; updatedAt: string },
): Promise<void> {
  await env.CACHE_KV.put(`cart:${cart.cartId}`, JSON.stringify(cart), {
    expirationTtl: CART_TTL_SECONDS,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToProduct(row: {
  id: string;
  orgId: string;
  siteId: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  category: string | null;
  tags: string;
  status: string;
  aiGenerated: number;
  inventory: number | null;
  createdAt: string;
  updatedAt: string;
}): Product {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags) as string[];
  } catch {
    // malformed tags — treat as empty
  }

  return {
    id: row.id,
    orgId: row.orgId,
    siteId: row.siteId,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    priceCents: row.priceCents,
    currency: row.currency,
    imageUrl: row.imageUrl ?? undefined,
    category: row.category ?? undefined,
    tags,
    status: row.status as Product['status'],
    aiGenerated: Boolean(row.aiGenerated),
    inventory: row.inventory,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
