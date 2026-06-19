import { dbQueryOne, dbInsert, dbQuery } from '../services/db.js';
import { createLead, getLead, listLeads } from '../services/lead_store';

/**
 * #9/#1 shared dependency — the leads store. The scanner (#9) persists a
 * researched ClaimLeadProfile + scoring meta; the claim flow (#1) reads it back
 * to prefill /create. D1 mocked (established pattern). Reuses ClaimLeadProfileSchema.
 */
jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbQuery: jest.fn(),
}));

const mockQueryOne = dbQueryOne as jest.Mock;
const mockInsert = dbInsert as jest.Mock;
const mockQuery = dbQuery as jest.Mock;
const db = {} as never;

beforeEach(() => {
  mockQueryOne.mockReset();
  mockInsert.mockReset().mockResolvedValue({ error: null });
  mockQuery.mockReset().mockResolvedValue({ data: [] });
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
    expect(table).toBe('scanned_leads');
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

describe('listLeads', () => {
  const row = {
    id: 'lead_1',
    business_name: 'Acme Roofing',
    has_website: 0,
    lead_score: 88,
    priority: 1,
    email: 'owner@acme.test',
    email_status: 'enriched',
    source: 'google_places',
    created_at: '2026-06-19T00:00:00Z',
  };

  it('maps rows to typed summaries (0/1 → boolean) ordered by score', async () => {
    mockQuery.mockResolvedValue({ data: [row] });
    const out = await listLeads(db);
    expect(out).toEqual([
      {
        leadId: 'lead_1',
        businessName: 'Acme Roofing',
        hasWebsite: false,
        leadScore: 88,
        priority: true,
        email: 'owner@acme.test',
        emailStatus: 'enriched',
        source: 'google_places',
        createdAt: '2026-06-19T00:00:00Z',
      },
    ]);
    const [, sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ORDER BY lead_score DESC/i);
    expect(sql).not.toMatch(/deleted_at/i); // table has no soft-delete column
  });

  it('clamps limit to 1..200 and floors offset at 0', async () => {
    await listLeads(db, { limit: 9999, offset: -5 });
    const [, , params] = mockQuery.mock.calls[0];
    expect(params).toEqual([200, 0]);
    mockQuery.mockClear();
    await listLeads(db, { limit: 0 });
    expect(mockQuery.mock.calls[0][2]).toEqual([1, 0]);
  });

  it('filters to no-website leads when onlyNoWebsite is set', async () => {
    await listLeads(db, { onlyNoWebsite: true });
    const [, sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/has_website\s*=\s*0/i);
  });

  it('does NOT filter by website by default', async () => {
    await listLeads(db);
    const [, sql] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/has_website\s*=\s*0/i);
  });

  it('returns an empty array when there are no leads', async () => {
    mockQuery.mockResolvedValue({ data: [] });
    expect(await listLeads(db)).toEqual([]);
  });
});
