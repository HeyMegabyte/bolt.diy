import { dbQueryOne, dbInsert } from '../services/db.js';
import { createLead, getLead } from '../services/lead_store';

/**
 * #9/#1 shared dependency — the leads store. The scanner (#9) persists a
 * researched ClaimLeadProfile + scoring meta; the claim flow (#1) reads it back
 * to prefill /create. D1 mocked (established pattern). Reuses ClaimLeadProfileSchema.
 */
jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
}));

const mockQueryOne = dbQueryOne as jest.Mock;
const mockInsert = dbInsert as jest.Mock;
const db = {} as never;

beforeEach(() => {
  mockQueryOne.mockReset();
  mockInsert.mockReset().mockResolvedValue({ error: null });
});

describe('createLead', () => {
  it('inserts the profile (as JSON) + scoring meta, returns a generated leadId', async () => {
    const r = await createLead(
      db,
      { businessName: 'Acme Roofing', phone: '555' },
      { hasWebsite: false, leadScore: 88, priority: true, source: 'google_places' },
    );
    expect(r.leadId).toMatch(/[0-9a-f-]{8,}/i);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockInsert.mock.calls[0];
    expect(table).toBe('leads');
    expect(record).toEqual(
      expect.objectContaining({
        id: r.leadId,
        business_name: 'Acme Roofing',
        has_website: 0,
        lead_score: 88,
        priority: 1,
        source: 'google_places',
      }),
    );
    expect(JSON.parse(record.profile_json)).toEqual(
      expect.objectContaining({ businessName: 'Acme Roofing', phone: '555' }),
    );
  });

  it('rejects a profile missing the required businessName (ZodError)', async () => {
    await expect(createLead(db, { phone: '555' } as never)).rejects.toBeDefined();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('getLead', () => {
  it('parses + validates the stored profile_json back into a ClaimLeadProfile', async () => {
    mockQueryOne.mockResolvedValue({
      id: 'lead_1',
      business_name: 'Acme',
      profile_json: JSON.stringify({ businessName: 'Acme', city: 'Newark', services: ['roofing'] }),
    });
    const r = await getLead(db, 'lead_1');
    expect(r?.leadId).toBe('lead_1');
    expect(r?.profile.businessName).toBe('Acme');
    expect(r?.profile.services).toEqual(['roofing']);
  });

  it('returns null when there is no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await getLead(db, 'nope')).toBeNull();
  });

  it('returns null on a corrupt profile_json (defensive, never throws)', async () => {
    mockQueryOne.mockResolvedValue({
      id: 'lead_1',
      business_name: 'Acme',
      profile_json: '{not json',
    });
    expect(await getLead(db, 'lead_1')).toBeNull();
  });
});
