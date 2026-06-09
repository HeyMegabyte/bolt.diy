/**
 * agentic_commerce — agent-readable product feed (discovery half).
 *
 * `GET /api/sites/:id/commerce/feed` exposes the site's active storefront catalog
 * in a normalized, AI-agent-consumable shape (the feed that the Agentic Commerce
 * Protocol / Universal Commerce Protocol / Google Merchant ingest). Public read
 * (agents fetch it), flag-gated by `agentic_commerce` (404 when off). Reuses the
 * storefront_products table (migration 0539).
 *
 * The agent checkout half (ACP Shared Payment Token + Stripe) is a separate,
 * heavier wave; this ships the discoverability that makes a site buyable-by-agent.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { dbQuery } from '../services/db.js';

export interface AgentProduct {
  id: string;
  title: string;
  description: string;
  /** Price in minor units (cents) + ISO-4217 currency, per ACP/UCP money shape. */
  price: { amount: number; currency: string };
  availability: 'in_stock' | 'out_of_stock';
  image?: string;
  sku?: string;
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string | null;
  image_url: string | null;
  sku: string | null;
  stock: number | null;
}

/** Map a storefront row to the agent feed shape. Pure (exported for tests). */
export function toAgentProduct(row: ProductRow): AgentProduct {
  const out: AgentProduct = {
    id: row.id,
    title: row.name,
    description: row.description ?? '',
    price: { amount: row.price_cents, currency: row.currency ?? 'USD' },
    availability: row.stock === null || row.stock === undefined || row.stock > 0 ? 'in_stock' : 'out_of_stock',
  };
  if (row.image_url) out.image = row.image_url;
  if (row.sku) out.sku = row.sku;
  return out;
}

export const agenticCommerce = new Hono<{ Bindings: Env; Variables: Variables }>();

agenticCommerce.get('/api/sites/:id/commerce/feed', async (c) => {
  const siteId = c.req.param('id');
  if (!(await isFlagOn(c.env, 'agentic_commerce', { siteId }))) return c.notFound();
  const { data } = await dbQuery<ProductRow>(
    c.env.DB,
    "SELECT id, name, description, price_cents, currency, image_url, sku, stock FROM storefront_products WHERE site_id = ? AND status = 'active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1000",
    [siteId],
  );
  return c.json(
    { protocol: 'acp-feed/1', merchant: { site_id: siteId }, products: data.map(toAgentProduct) },
    200,
    { 'cache-control': 'public, max-age=120' },
  );
});
