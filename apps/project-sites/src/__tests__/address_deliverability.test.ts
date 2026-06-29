import {
  assessAddressDeliverability,
  DELIVERABILITY_THRESHOLD,
} from '../services/address_deliverability.js';

describe('assessAddressDeliverability (Lead Scanner #91 — Lob-spend gate)', () => {
  it('scores a complete US address 100 + deliverable', () => {
    const r = assessAddressDeliverability('74 N Beverwyck Rd, Lake Hiawatha, NJ 07034');
    expect(r.confidence).toBe(100);
    expect(r.deliverable).toBe(true);
    expect(r.parts).toEqual({ streetNumber: true, street: true, city: true, state: true, zip: true });
    expect(r.reasons).toEqual([]);
  });

  it('accepts ZIP+4 and a digits+letter street number', () => {
    const r = assessAddressDeliverability('74B Main Street, Newark, NJ 07102-1234');
    expect(r.parts.zip).toBe(true);
    expect(r.parts.streetNumber).toBe(true);
    expect(r.deliverable).toBe(true);
  });

  it('blocks an address with no street number or ZIP (would waste Lob spend)', () => {
    const r = assessAddressDeliverability('Main Street, Newark, NJ');
    expect(r.parts.streetNumber).toBe(false);
    expect(r.parts.zip).toBe(false);
    expect(r.deliverable).toBe(false); // 25(street)+15(city)+20(state) = 60 < 70
    expect(r.reasons).toContain('missing street number');
    expect(r.reasons).toContain('missing ZIP');
  });

  it('scores a blank/garbage address 0 + not deliverable', () => {
    for (const a of ['', '   ', 'n/a', null, undefined]) {
      const r = assessAddressDeliverability(a);
      expect(r.confidence).toBe(0);
      expect(r.deliverable).toBe(false);
    }
  });

  it('rejects an invalid state token', () => {
    const r = assessAddressDeliverability('74 Main Rd, Townsville, ZZ 07034');
    expect(r.parts.state).toBe(false);
    expect(r.reasons).toContain('missing/invalid state');
  });

  it('honors a custom threshold', () => {
    const r = assessAddressDeliverability('Main Street, Newark, NJ', 50); // confidence 60
    expect(r.confidence).toBe(60);
    expect(r.deliverable).toBe(true); // 60 >= 50
  });

  it('exposes the default threshold constant', () => {
    expect(DELIVERABILITY_THRESHOLD).toBe(70);
  });
});
