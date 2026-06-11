import { toAgentProduct } from '../routes/agentic_commerce';

const base = {
  id: 'p1',
  name: 'Mug',
  description: 'A mug',
  price_cents: 1500,
  currency: 'USD',
  image_url: null,
  sku: null,
  stock: null,
};

describe('toAgentProduct', () => {
  it('maps to the ACP/UCP money + availability shape', () => {
    expect(toAgentProduct(base)).toEqual({
      id: 'p1',
      title: 'Mug',
      description: 'A mug',
      price: { amount: 1500, currency: 'USD' },
      availability: 'in_stock',
    });
  });

  it('untracked stock (null) is in_stock; positive stock is in_stock; 0 is out_of_stock', () => {
    expect(toAgentProduct({ ...base, stock: null }).availability).toBe('in_stock');
    expect(toAgentProduct({ ...base, stock: 3 }).availability).toBe('in_stock');
    expect(toAgentProduct({ ...base, stock: 0 }).availability).toBe('out_of_stock');
  });

  it('includes image + sku only when present', () => {
    const r = toAgentProduct({ ...base, image_url: 'https://cdn/x.png', sku: 'SKU-1' });
    expect(r.image).toBe('https://cdn/x.png');
    expect(r.sku).toBe('SKU-1');
    expect(toAgentProduct(base)).not.toHaveProperty('image');
    expect(toAgentProduct(base)).not.toHaveProperty('sku');
  });

  it('defaults a missing description / currency', () => {
    const r = toAgentProduct({ ...base, description: null, currency: null });
    expect(r.description).toBe('');
    expect(r.price.currency).toBe('USD');
  });
});
