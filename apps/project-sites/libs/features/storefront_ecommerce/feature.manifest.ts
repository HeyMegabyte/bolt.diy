import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'storefront_ecommerce',
  name: 'AI Storefront and Product Catalog',
  description:
    'AI-generated product catalog and storefront served per tenant. Stores products in D1 ' +
    'and exposes catalog browsing, product detail, and cart management endpoints.',
  lifecycle: 'alpha',
  flagKey: 'storefront_ecommerce',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: [
    'GET /api/storefront/catalog',
    'GET /api/storefront/products/:id',
    'POST /api/storefront/cart',
  ],
  permissions: ['site:read', 'billing:read'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/storefront_ecommerce/__tests__/storefront_ecommerce.test.ts'],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: { axiom: true, logs: true, analytics: true },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Alpha behind flag. Enable per-org after AI catalog generation workflow is wired to site-generation.',
  },
  risks: [
    'AI-generated product descriptions may require human review before public display.',
    'Cart state is ephemeral (KV TTL 24h); no order persistence in this version.',
    'Disabling mid-session drops active cart state for anonymous visitors.',
  ],
  removalNotes:
    'Drop storefront_products D1 table, purge R2 product-image keys under sites/{slug}/products/, ' +
    'remove KV cart keys prefixed cart:.',
});
