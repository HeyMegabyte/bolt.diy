/**
 * @module libs/features/storefront_ecommerce/schemas
 * @description Zod schemas for the AI Storefront and Product Catalog feature module.
 * All runtime boundaries — API request bodies, responses — are validated here.
 *
 * @remarks
 * Schemas are the single source of truth; types are inferred via z.infer.
 * Consumers import from this file; never duplicate shapes in service or handler files.
 *
 * @see {@link ./service.ts} business logic
 * @see {@link ./handlers.ts} Hono route handlers
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Product (catalog entity)
// ---------------------------------------------------------------------------

export const ProductStatusSchema = z.enum(['active', 'draft', 'archived']).describe('Product visibility state');
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const ProductSchema = z
  .object({
    id: z.string().uuid(),
    orgId: z.string().min(1),
    siteId: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9-]{1,128}$/).describe('URL-safe product slug'),
    name: z.string().min(1).max(255),
    description: z.string().max(5000).optional(),
    priceCents: z.number().int().nonnegative().describe('Price in cents (USD)'),
    currency: z.string().length(3).default('usd'),
    imageUrl: z.string().url().optional(),
    category: z.string().max(128).optional(),
    tags: z.array(z.string().max(64)).default([]),
    status: ProductStatusSchema.default('draft'),
    aiGenerated: z.boolean().default(false),
    inventory: z.number().int().nonnegative().nullable().default(null).describe('null = unlimited'),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type Product = z.infer<typeof ProductSchema>;

// ---------------------------------------------------------------------------
// Catalog response (GET /api/storefront/catalog)
// ---------------------------------------------------------------------------

export const CatalogQuerySchema = z
  .object({
    page: z.coerce.number().int().nonnegative().default(0),
    pageSize: z.coerce.number().int().min(1).max(100).default(24),
    category: z.string().max(128).optional(),
    status: ProductStatusSchema.optional(),
    q: z.string().max(256).optional().describe('Search query'),
  })
  .strict();

export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

export const CatalogResponseSchema = z
  .object({
    products: z.array(ProductSchema),
    count: z.number().int().nonnegative(),
    page: z.number().int().nonnegative(),
    pageSize: z.number().int().positive(),
    categories: z.array(z.string()).describe('Distinct category values for filter pills'),
  })
  .strict();

export type CatalogResponse = z.infer<typeof CatalogResponseSchema>;

// ---------------------------------------------------------------------------
// Single product response (GET /api/storefront/products/:id)
// ---------------------------------------------------------------------------

export const ProductDetailResponseSchema = ProductSchema.extend({
  relatedProductIds: z.array(z.string().uuid()).default([]),
}).strict();

export type ProductDetailResponse = z.infer<typeof ProductDetailResponseSchema>;

// ---------------------------------------------------------------------------
// Cart (POST /api/storefront/cart)
// ---------------------------------------------------------------------------

export const CartLineSchema = z
  .object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive().max(999),
  })
  .strict();

export type CartLine = z.infer<typeof CartLineSchema>;

export const UpsertCartBodySchema = z
  .object({
    cartId: z.string().uuid().optional().describe('Omit to create a new cart'),
    lines: z.array(CartLineSchema).min(1).max(50),
  })
  .strict();

export type UpsertCartBody = z.infer<typeof UpsertCartBodySchema>;

export const CartLineDetailSchema = CartLineSchema.extend({
  product: ProductSchema,
  lineTotalCents: z.number().int().nonnegative(),
}).strict();

export type CartLineDetail = z.infer<typeof CartLineDetailSchema>;

export const CartResponseSchema = z
  .object({
    cartId: z.string().uuid(),
    orgId: z.string().min(1),
    siteId: z.string().min(1),
    lines: z.array(CartLineDetailSchema),
    subtotalCents: z.number().int().nonnegative(),
    currency: z.string().length(3),
    expiresAt: z.string().datetime().describe('Cart TTL — 24h from last update'),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type CartResponse = z.infer<typeof CartResponseSchema>;
