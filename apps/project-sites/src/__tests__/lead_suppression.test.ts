import { filterContactable, dedupeKey } from '../services/lead_suppression.js';
import type { DiscoveredBusiness } from '../services/crm_leads.js';

const biz = (o: Partial<DiscoveredBusiness>): DiscoveredBusiness => ({
  businessName: o.businessName ?? 'Acme',
  externalId: o.externalId ?? null,
  email: o.email ?? null,
  address: o.address ?? null,
});

describe('dedupeKey', () => {
  it('prefers externalId, falls back to name|address, empty when nothing identifying', () => {
    expect(dedupeKey(biz({ externalId: 'Place_1' }))).toBe('place_1');
    expect(dedupeKey(biz({ businessName: 'Joe’s', address: '5 Main St' }))).toBe('joe’s|5 main st');
    expect(dedupeKey(biz({ businessName: '' }))).toBe('');
  });
});

describe('filterContactable (Lead Scanner #98 — suppression + dedupe)', () => {
  it('dedupes on externalId (first wins) and counts the drops', () => {
    const r = filterContactable([
      biz({ businessName: 'A', externalId: 'p1' }),
      biz({ businessName: 'A dup', externalId: 'p1' }),
      biz({ businessName: 'B', externalId: 'p2' }),
    ]);
    expect(r.contactable.map((b) => b.businessName)).toEqual(['A', 'B']);
    expect(r.dropped.duplicate).toBe(1);
  });

  it('never re-contacts claimed externalIds', () => {
    const r = filterContactable([biz({ externalId: 'p1' }), biz({ externalId: 'p2' })], {
      claimedExternalIds: ['P1'], // case-insensitive
    });
    expect(r.contactable.map((b) => b.externalId)).toEqual(['p2']);
    expect(r.dropped.claimed).toBe(1);
  });

  it('drops opted-out + bounced emails (case-insensitive) but keeps others', () => {
    const r = filterContactable(
      [
        biz({ externalId: 'p1', email: 'OptOut@x.com' }),
        biz({ externalId: 'p2', email: 'bounce@x.com' }),
        biz({ externalId: 'p3', email: 'ok@x.com' }),
      ],
      { optedOutEmails: ['optout@x.com'], bouncedEmails: ['bounce@x.com'] },
    );
    expect(r.contactable.map((b) => b.externalId)).toEqual(['p3']);
    expect(r.dropped.opted_out).toBe(1);
    expect(r.dropped.bounced).toBe(1);
  });

  it('keeps a candidate with no identity (cannot prove a duplicate)', () => {
    const r = filterContactable([biz({ businessName: '' }), biz({ businessName: '' })]);
    expect(r.contactable.length).toBe(2);
    expect(r.dropped.duplicate).toBe(0);
  });

  it('returns everything contactable + zero drops on empty suppression sets', () => {
    const r = filterContactable([biz({ externalId: 'p1' }), biz({ externalId: 'p2' })]);
    expect(r.contactable.length).toBe(2);
    expect(r.dropped).toEqual({ duplicate: 0, claimed: 0, opted_out: 0, bounced: 0 });
  });
});
