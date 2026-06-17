/**
 * Unit tests for libs/features/storefront_ecommerce/service.ts
 *
 * D1 is mocked via the prepare().bind().first()/all() chain pattern.
 * KV is mocked via a simple { get, put } object.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// D1 mock factory
// ---------------------------------------------------------------------------

type MockD1Row = Record<string, unknown>;

function makeBoundStmt(rows: MockD1Row[], single: MockD1Row | null) {
  return {
    first: jest.fn<() => Promise<MockD1Row | null>>().mockResolvedValue(single),
    all: jest.fn<() => Promise<{ results: MockD1Row[] }>>().mockResolvedValue({ results: rows }),
    run: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function makeDb(
  queryMap: Record<string, { rows?: MockD1Row[]; single?: MockD1Row | null }>,
) {
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => {
        const key = Object.keys(queryMap).find((k) => sql.includes(k));
        const spec = key ? queryMap[key]! : { rows: [], single: null };
        return makeBoundStmt(spec.rows ?? [], spec.single ?? null);
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// KV mock factory
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
// Module-level mock wiring
// ---------------------------------------------------------------------------

let mockDb: ReturnType<typeof makeDb>;
let mockKv: ReturnType<typeof makeKv>;

jest.mock('../../../../src/services/db.js', () => ({
  dbQuery: jest.fn(async (db: ReturnType<typeof makeDb>, sql: string, args: unknown[]) => {
    const stmt = db.prepare(sql).bind(...args);
    const res = await stmt.all();
    return res.results;
  }),
  dbQueryOne: jest.fn(async (db: ReturnType<typeof makeDb>, sql: string, args: unknown[]) => {
    const stmt = db.prepare(sql).bind(...args);
    return stmt.first();
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { dbQuery, dbQueryOne } = await import('../../../../src/services/db.js') as any;

import {
  FLAG_KEY,
  getCatalog,
  getProductById,
  getCart,
  saveCart,
} from '../service.js';

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

// ---------------------------------------------------------------------------
// Tests — FLAG_KEY
// ---------------------------------------------------------------------------

describe('storefront_ecommerce/service — FLAG_KEY', () => {
  test('equals the module slug exactly', () => {
    expect(FLAG_KEY).toBe('storefront_ecommerce');
  });
});

// ---------------------------------------------------------------------------
// Tests — getCatalog
// ---------------------------------------------------------------------------

describe('storefront_ecommerce/service — getCatalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = makeDb({ storefront_products: { rows: [PRODUCT_ROW], single: null } });
  });

  test('returns products, total count, and categories', async () => {
    dbQueryOne.mockImplementationOnce(async () => ({ cnt: 1 }));
    dbQuery.mockImplementationOnce(async () => [PRODUCT_ROW]);
    dbQuery.mockImplementationOnce(async () => [{ category: 'widgets' }]);

    const env = { DB: mockDb } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24 });

    expect(result.total).toBe(1);
    expect(result.products).toHaveLength(1);
    expect(result.categories).toEqual(['widgets']);
  });

  test('maps product row correctly (tags parsed from JSON)', async () => {
    dbQueryOne.mockImplementationOnce(async () => ({ cnt: 1 }));
    dbQuery.mockImplementationOnce(async () => [PRODUCT_ROW]);
    dbQuery.mockImplementationOnce(async () => []);

    const env = { DB: mockDb } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24 });

    const p = result.products[0]!;
    expect(p.id).toBe('prod-001');
    expect(p.tags).toEqual(['sale', 'featured']);
    expect(p.aiGenerated).toBe(false);
    expect(p.priceCents).toBe(1999);
  });

  test('handles malformed tags JSON gracefully (returns empty array)', async () => {
    const badRow = { ...PRODUCT_ROW, tags: 'not-json' };
    dbQueryOne.mockImplementationOnce(async () => ({ cnt: 1 }));
    dbQuery.mockImplementationOnce(async () => [badRow]);
    dbQuery.mockImplementationOnce(async () => []);

    const env = { DB: mockDb } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24 });

    expect(result.products[0]!.tags).toEqual([]);
  });

  test('applies category filter', async () => {
    dbQueryOne.mockImplementationOnce(async () => ({ cnt: 0 }));
    dbQuery.mockImplementationOnce(async () => []);
    dbQuery.mockImplementationOnce(async () => []);

    const env = { DB: mockDb } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24, category: 'gadgets' });

    expect(result.products).toHaveLength(0);
  });

  test('applies search query filter', async () => {
    dbQueryOne.mockImplementationOnce(async () => ({ cnt: 1 }));
    dbQuery.mockImplementationOnce(async () => [PRODUCT_ROW]);
    dbQuery.mockImplementationOnce(async () => [{ category: 'widgets' }]);

    const env = { DB: mockDb } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24, q: 'widget' });

    expect(result.total).toBe(1);
  });

  test('returns empty result on DB error (graceful)', async () => {
    dbQueryOne.mockImplementationOnce(async () => { throw new Error('D1 error'); });
    dbQuery.mockImplementationOnce(async () => { throw new Error('D1 error'); });
    dbQuery.mockImplementationOnce(async () => { throw new Error('D1 error'); });

    const env = { DB: mockDb } as never;
    const result = await getCatalog(env, SITE_ID, { page: 0, pageSize: 24 });

    expect(result.total).toBe(0);
    expect(result.products).toHaveLength(0);
    expect(result.categories).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — getProductById
// ---------------------------------------------------------------------------

describe('storefront_ecommerce/service — getProductById', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = makeDb({ storefront_products: { rows: [], single: PRODUCT_ROW } });
  });

  test('returns null when product not found', async () => {
    dbQueryOne.mockImplementationOnce(async () => null);

    const env = { DB: mockDb } as never;
    const product = await getProductById(env, 'non-existent');

    expect(product).toBeNull();
  });

  test('returns mapped Product when found', async () => {
    dbQueryOne.mockImplementationOnce(async () => PRODUCT_ROW);

    const env = { DB: mockDb } as never;
    const product = await getProductById(env, 'prod-001');

    expect(product).not.toBeNull();
    expect(product!.id).toBe('prod-001');
    expect(product!.slug).toBe('blue-widget');
    expect(product!.priceCents).toBe(1999);
    expect(product!.tags).toEqual(['sale', 'featured']);
  });

  test('returns null on D1 error (graceful)', async () => {
    dbQueryOne.mockImplementationOnce(async () => { throw new Error('connection lost'); });

    const env = { DB: mockDb } as never;
    const product = await getProductById(env, 'prod-001');

    expect(product).toBeNull();
  });

  test('maps optional fields correctly when null in DB', async () => {
    const rowNoOptionals = {
      ...PRODUCT_ROW,
      description: null,
      imageUrl: null,
      category: null,
      inventory: null,
    };
    dbQueryOne.mockImplementationOnce(async () => rowNoOptionals);

    const env = { DB: mockDb } as never;
    const product = await getProductById(env, 'prod-001');

    expect(product!.description).toBeUndefined();
    expect(product!.imageUrl).toBeUndefined();
    expect(product!.category).toBeUndefined();
    expect(product!.inventory).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — getCart / saveCart (KV-backed)
// ---------------------------------------------------------------------------

describe('storefront_ecommerce/service — getCart', () => {
  const CART_ID = 'cart-uuid-001';
  const CART_DATA = {
    cartId: CART_ID,
    orgId: ORG_ID,
    siteId: SITE_ID,
    lines: [{ productId: 'prod-001', quantity: 2 }],
  };

  beforeEach(() => {
    mockKv = makeKv({ [`cart:${CART_ID}`]: JSON.stringify(CART_DATA) });
  });

  test('returns null when cart key does not exist', async () => {
    mockKv = makeKv({});
    const env = { CACHE: mockKv } as never;
    const cart = await getCart(env, 'missing-cart');

    expect(cart).toBeNull();
  });

  test('returns parsed cart when key exists', async () => {
    const env = { CACHE: mockKv } as never;
    const cart = await getCart(env, CART_ID);

    expect(cart).not.toBeNull();
    expect(cart!.cartId).toBe(CART_ID);
    expect(cart!.lines).toHaveLength(1);
  });

  test('returns null when stored value is malformed JSON', async () => {
    mockKv = makeKv({ 'cart:bad': 'not-json{' });
    const env = { CACHE: mockKv } as never;
    const cart = await getCart(env, 'bad');

    expect(cart).toBeNull();
  });

  test('returns null on KV error (graceful)', async () => {
    mockKv.get.mockImplementationOnce(async () => { throw new Error('KV down'); });
    const env = { CACHE: mockKv } as never;
    const cart = await getCart(env, CART_ID);

    expect(cart).toBeNull();
  });
});

describe('storefront_ecommerce/service — saveCart', () => {
  const CART_ID = 'cart-uuid-new';
  const now = new Date().toISOString();

  beforeEach(() => {
    mockKv = makeKv();
  });

  test('calls KV.put with correct key and JSON value', async () => {
    const env = { CACHE: mockKv } as never;

    await saveCart(env, {
      cartId: CART_ID,
      orgId: ORG_ID,
      siteId: SITE_ID,
      lines: [{ productId: 'prod-001', quantity: 1 }],
      updatedAt: now,
    });

    expect(mockKv.put).toHaveBeenCalledTimes(1);
    const [key, value, opts] = mockKv.put.mock.calls[0]! as [string, string, { expirationTtl: number }];
    expect(key).toBe(`cart:${CART_ID}`);
    const parsed = JSON.parse(value);
    expect(parsed.cartId).toBe(CART_ID);
    expect(parsed.lines).toHaveLength(1);
    expect(opts.expirationTtl).toBe(86400); // 24h
  });

  test('round-trips cart through save and read', async () => {
    const kv = makeKv();
    const env = { CACHE: kv } as never;

    const originalCart = {
      cartId: 'cart-rt-001',
      orgId: ORG_ID,
      siteId: SITE_ID,
      lines: [{ productId: 'prod-001', quantity: 3 }],
      updatedAt: now,
    };

    await saveCart(env, originalCart);

    // Simulate KV returning the stored value.
    const stored = (kv.put.mock.calls[0]![1] as string);
    kv.get.mockImplementationOnce(async () => stored);

    const retrieved = await getCart(env, 'cart-rt-001');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.lines[0]!.quantity).toBe(3);
  });
});
