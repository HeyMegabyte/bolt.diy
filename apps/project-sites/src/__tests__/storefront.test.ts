import { ProductInput, ProductPatch } from '../routes/storefront';

describe('storefront ProductInput schema', () => {
  it('accepts a minimal valid product and applies defaults', () => {
    const r = ProductInput.parse({ name: 'Mug', price_cents: 1500 });
    expect(r).toMatchObject({
      name: 'Mug',
      price_cents: 1500,
      currency: 'USD',
      status: 'active',
      description: '',
    });
  });

  it('uppercases currency', () => {
    expect(ProductInput.parse({ name: 'x', price_cents: 1, currency: 'eur' }).currency).toBe('EUR');
  });

  it('rejects negative / non-integer prices', () => {
    expect(ProductInput.safeParse({ name: 'x', price_cents: -1 }).success).toBe(false);
    expect(ProductInput.safeParse({ name: 'x', price_cents: 9.99 }).success).toBe(false);
  });

  it('rejects a missing name and a too-long currency', () => {
    expect(ProductInput.safeParse({ price_cents: 100 }).success).toBe(false);
    expect(
      ProductInput.safeParse({ name: 'x', price_cents: 100, currency: 'DOLLARS' }).success,
    ).toBe(false);
  });

  it('requires https image urls (SSRF-safe)', () => {
    expect(
      ProductInput.safeParse({ name: 'x', price_cents: 1, image_url: 'http://insecure/x.png' })
        .success,
    ).toBe(false);
    expect(
      ProductInput.safeParse({ name: 'x', price_cents: 1, image_url: 'https://cdn/x.png' }).success,
    ).toBe(true);
  });

  it('only allows known statuses', () => {
    expect(ProductInput.safeParse({ name: 'x', price_cents: 1, status: 'on-sale' }).success).toBe(
      false,
    );
    expect(ProductInput.safeParse({ name: 'x', price_cents: 1, status: 'hidden' }).success).toBe(
      true,
    );
  });
});

describe('storefront ProductPatch schema', () => {
  it('accepts a single-field partial update (no defaults injected)', () => {
    const r = ProductPatch.parse({ price_cents: 2000 });
    expect(r).toEqual({ price_cents: 2000 }); // only the provided key
  });

  it('accepts an empty object (handler rejects empty; schema does not)', () => {
    expect(ProductPatch.safeParse({}).success).toBe(true);
  });

  it('allows nulling optional fields', () => {
    expect(ProductPatch.parse({ image_url: null, sku: null, stock: null })).toEqual({
      image_url: null,
      sku: null,
      stock: null,
    });
  });

  it('rejects unknown keys (strict)', () => {
    expect(ProductPatch.safeParse({ color: 'red' }).success).toBe(false);
  });

  it('still validates provided fields (price int, https image)', () => {
    expect(ProductPatch.safeParse({ price_cents: -5 }).success).toBe(false);
    expect(ProductPatch.safeParse({ image_url: 'http://x/y.png' }).success).toBe(false);
  });
});
