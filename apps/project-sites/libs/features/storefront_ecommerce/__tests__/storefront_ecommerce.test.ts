/**
 * Unit tests for libs/features/storefront_ecommerce/service.ts
 *
 * D1 uses the D1-stub pattern (NO jest.mock of db.js — @swc/jest's jest.mock
 * hoist is unreliable here; see _LOOP_LEDGER fire-v2.40/41). A fake D1Database
 * returns a queued `{ results }` per `.all()` call (in service query order) and
 * the REAL dbQuery/dbQueryOne run against it. dbQuery catches internally, so a
 * queued Error simulates a D1 outage. KV uses a simple { get, put } stub.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

import { FLAG_KEY, getCatalog, getProductById, getCart, saveCart } from '../service.js';

// ---------------------------------------------------------------------------
// D1 stub — queue one `{ results }` (or an Error) per `.all()` call.
// ---------------------------------------------------------------------------

function makeDb(queue: Array<{ results: unknown[] } | Error> = []) {
  let i = 0;
  const stmt = {
    bind: () => stmt,
    all: async () => {
      const entry = queue[i++];
      if (entry instanceof Error) throw entry;
      return entry ?? { results: [] };
    },
    run: async () => ({ meta: { changes: 1 } }),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// KV stub
// ---------------------------------------------------------------------------

function makeKv(initialStore: Record<string, string> = {}) {
  const store = { ...initialStore };
  return {
    get: jest.fn(async (key: string) => store[key] ?? null),
    put: jest.fn(async (key: string, value: string, _opts?: unknown) => {
      store[key] = value;
    }),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SITE_ID = 'site-abc-001';
const ORG_ID = 'org-test-001';

const PRODUCT_ROW = {
  id: 'prod-001',
  orgId: ORG_ID,
  siteId: SITE_ID,
  slug: 'blue-widget',
  name: 'Blue Widget',
  description: 'A quality widget',
  priceCents: 1999,
  currency: 'usd',
  imageUrl: null,
  category: 'widgets',
  tags: '["sale","featured"]',
  status: 'active',
  aiGenerated: 0,
  inventory: 50,
  createdAt: '2026-06-17T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
};

// getCatalog issues: dbQueryOne (count) → dbQuery (products) → dbQuery (categories).
function catalogQueue(
  cnt: number,
  products: unknown[],
  categories: unknown[],
): Array<{ results: unknown[] }> {
  return [{ results: [{ cnt }] }, { results: products }, { results: categories }];
}

// ---------------------------------------------------------------------------
// FLAG_KEY
// ---------------------------------------------------------------------------

describe('storefront_ecommerce/service — FLAG_KEY', () => {
  test('equals the module slug exactly', () => {
    expect(FLAG_KEY).toBe('storefront_ecommerce');
  });
});

// ---------------------------------------------------------------------------
// getCatalog
// ---------------------------------------------------------------------------

describe('storefront_ecommerce/service — getCatalog', () => {
  test('returns products, total count, and categories', async () => {
    const env = { DB: makeDb(catalogQueue(1, [PRODUCT_ROW], [{ category: 'widgets' }])) } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24 });

    expect(result.total).toBe(1);
    expect(result.products).toHaveLength(1);
    expect(result.categories).toEqual(['widgets']);
  });

  test('maps product row correctly (tags parsed from JSON)', async () => {
    const env = { DB: makeDb(catalogQueue(1, [PRODUCT_ROW], [])) } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24 });

    const p = result.products[0]!;
    expect(p.id).toBe('prod-001');
    expect(p.tags).toEqual(['sale', 'featured']);
    expect(p.aiGenerated).toBe(false);
    expect(p.priceCents).toBe(1999);
  });

  test('handles malformed tags JSON gracefully (returns empty array)', async () => {
    const badRow = { ...PRODUCT_ROW, tags: 'not-json' };
    const env = { DB: makeDb(catalogQueue(1, [badRow], [])) } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24 });

    expect(result.products[0]!.tags).toEqual([]);
  });

  test('applies category filter', async () => {
    const env = { DB: makeDb(catalogQueue(0, [], [])) } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24, category: 'gadgets' });

    expect(result.products).toHaveLength(0);
  });

  test('applies search query filter', async () => {
    const env = { DB: makeDb(catalogQueue(1, [PRODUCT_ROW], [{ category: 'widgets' }])) } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24, q: 'widget' });

    expect(result.total).toBe(1);
  });

  test('returns empty result on DB error (graceful)', async () => {
    const env = {
      DB: makeDb([new Error('D1 error'), new Error('D1 error'), new Error('D1 error')]),
    } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24 });

    expect(result.total).toBe(0);
    expect(result.products).toHaveLength(0);
    expect(result.categories).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getProductById — single dbQueryOne
// ---------------------------------------------------------------------------

describe('storefront_ecommerce/service — getProductById', () => {
  test('returns null when product not found', async () => {
    const env = { DB: makeDb([{ results: [] }]) } as never;
    expect(await getProductById(env, 'non-existent')).toBeNull();
  });

  test('returns mapped Product when found', async () => {
    const env = { DB: makeDb([{ results: [PRODUCT_ROW] }]) } as never;
    const product = await getProductById(env, 'prod-001');

    expect(product).not.toBeNull();
    expect(product!.id).toBe('prod-001');
    expect(product!.slug).toBe('blue-widget');
    expect(product!.priceCents).toBe(1999);
    expect(product!.tags).toEqual(['sale', 'featured']);
  });

  test('returns null on D1 error (graceful)', async () => {
    const env = { DB: makeDb([new Error('connection lost')]) } as never;
    expect(await getProductById(env, 'prod-001')).toBeNull();
  });

  test('maps optional fields correctly when null in DB', async () => {
    const rowNoOptionals = {
      ...PRODUCT_ROW,
      description: null,
      imageUrl: null,
      category: null,
      inventory: null,
    };
    const env = { DB: makeDb([{ results: [rowNoOptionals] }]) } as never;
    const product = await getProductById(env, 'prod-001');

    expect(product!.description).toBeUndefined();
    expect(product!.imageUrl).toBeUndefined();
    expect(product!.category).toBeUndefined();
    expect(product!.inventory).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCart / saveCart (KV-backed)
// ---------------------------------------------------------------------------

describe('storefront_ecommerce/service — getCart', () => {
  const CART_ID = 'cart-uuid-001';
  const CART_DATA = {
    cartId: CART_ID,
    orgId: ORG_ID,
    siteId: SITE_ID,
    lines: [{ productId: 'prod-001', quantity: 2 }],
  };
  let mockKv: ReturnType<typeof makeKv>;

  beforeEach(() => {
    mockKv = makeKv({ [`cart:${CART_ID}`]: JSON.stringify(CART_DATA) });
  });

  test('returns null when cart key does not exist', async () => {
    const env = { CACHE_KV: makeKv({}) } as never;
    expect(await getCart(env, 'missing-cart')).toBeNull();
  });

  test('returns parsed cart when key exists', async () => {
    const env = { CACHE_KV: mockKv } as never;
    const cart = await getCart(env, CART_ID);

    expect(cart).not.toBeNull();
    expect(cart!.cartId).toBe(CART_ID);
    expect(cart!.lines).toHaveLength(1);
  });

  test('returns null when stored value is malformed JSON', async () => {
    const env = { CACHE_KV: makeKv({ 'cart:bad': 'not-json{' }) } as never;
    expect(await getCart(env, 'bad')).toBeNull();
  });

  test('returns null on KV error (graceful)', async () => {
    mockKv.get.mockImplementationOnce(async () => {
      throw new Error('KV down');
    });
    const env = { CACHE_KV: mockKv } as never;
    expect(await getCart(env, CART_ID)).toBeNull();
  });
});

describe('storefront_ecommerce/service — saveCart', () => {
  const CART_ID = 'cart-uuid-new';
  const now = new Date().toISOString();

  test('calls KV.put with correct key and JSON value', async () => {
    const mockKv = makeKv();
    const env = { CACHE_KV: mockKv } as never;

    await saveCart(env, {
      cartId: CART_ID,
      orgId: ORG_ID,
      siteId: SITE_ID,
      lines: [{ productId: 'prod-001', quantity: 1 }],
      updatedAt: now,
    });

    expect(mockKv.put).toHaveBeenCalledTimes(1);
    const [key, value, opts] = mockKv.put.mock.calls[0]! as [
      string,
      string,
      { expirationTtl: number },
    ];
    expect(key).toBe(`cart:${CART_ID}`);
    const parsed = JSON.parse(value);
    expect(parsed.cartId).toBe(CART_ID);
    expect(parsed.lines).toHaveLength(1);
    expect(opts.expirationTtl).toBe(86400); // 24h
  });

  test('round-trips cart through save and read', async () => {
    const kv = makeKv();
    const env = { CACHE_KV: kv } as never;

    await saveCart(env, {
      cartId: 'cart-rt-001',
      orgId: ORG_ID,
      siteId: SITE_ID,
      lines: [{ productId: 'prod-001', quantity: 3 }],
      updatedAt: now,
    });

    // Simulate KV returning the stored value.
    const stored = kv.put.mock.calls[0]![1] as string;
    kv.get.mockImplementationOnce(async () => stored);

    const retrieved = await getCart(env, 'cart-rt-001');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.lines[0]!.quantity).toBe(3);
  });
});
