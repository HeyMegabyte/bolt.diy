import {
  twentyFindCompany,
  twentyCreateContact,
  twentyUpsertLead,
  type TwentyConfig,
} from '../twenty_client';

const CFG: TwentyConfig = {
  baseUrl: 'https://crm.projectsites.dev',
  apiKey: 'test-jwt-token',
};
const UNCONFIGURED: TwentyConfig = { baseUrl: '', apiKey: '' };

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function mockFetchThrow(msg: string): typeof fetch {
  return (async () => {
    throw new Error(msg);
  }) as unknown as typeof fetch;
}

const COMPANY_RAW = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Acme Roofing',
  domain: 'acmeroofing.com',
  createdAt: '2026-06-01T12:00:00Z',
};

describe('twentyFindCompany', () => {
  it('returns company when found by domain', async () => {
    const r = await twentyFindCompany(
      CFG,
      'acmeroofing.com',
      mockFetch(200, { data: { companies: [COMPANY_RAW] } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.company?.name).toBe('Acme Roofing');
  });

  it('returns null company when not found', async () => {
    const r = await twentyFindCompany(CFG, 'nope.com', mockFetch(200, { data: { companies: [] } }));
    expect(r).toEqual({ ok: true, company: null });
  });

  it('handles missing data.companies gracefully', async () => {
    const r = await twentyFindCompany(CFG, 'x.com', mockFetch(200, {}));
    expect(r).toEqual({ ok: true, company: null });
  });

  it('returns not_configured when credentials missing', async () => {
    const r = await twentyFindCompany(UNCONFIGURED, 'x.com');
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns schema_mismatch on invalid response shape', async () => {
    const r = await twentyFindCompany(
      CFG,
      'bad.com',
      mockFetch(200, { data: { companies: [{ id: 'not-a-uuid', name: '', createdAt: 'bad' }] } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('schema_mismatch');
  });

  it('returns error on HTTP failure', async () => {
    const r = await twentyFindCompany(CFG, 'x.com', mockFetch(503, {}));
    expect(r).toEqual({ ok: false, reason: 'http_503' });
  });

  it('returns network error on fetch failure', async () => {
    const r = await twentyFindCompany(CFG, 'x.com', mockFetchThrow('ECONNREFUSED'));
    expect(r).toEqual({ ok: false, reason: 'ECONNREFUSED' });
  });
});

describe('twentyCreateContact', () => {
  it('creates contact and returns id', async () => {
    const r = await twentyCreateContact(
      CFG,
      'jane@acme.com',
      'Jane Doe',
      '123e4567-e89b-12d3-a456-426614174000',
      undefined,
      mockFetch(200, { data: { id: 'person-uuid-001' } }),
    );
    expect(r).toEqual({ ok: true, id: 'person-uuid-001' });
  });

  it('includes phone when provided', async () => {
    let capturedBody = '';
    const spy = (async (_url: string, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? '';
      return { ok: true, status: 200, json: async () => ({ data: { id: 'x' } }) };
    }) as unknown as typeof fetch;
    await twentyCreateContact(
      CFG,
      'j@x.com',
      'J',
      '123e4567-e89b-12d3-a456-426614174000',
      '+15551234567',
      spy,
    );
    const parsed = JSON.parse(capturedBody);
    expect(parsed.phone).toBe('+15551234567');
  });

  it('returns validation error for invalid email', async () => {
    const r = await twentyCreateContact(
      CFG,
      'not-email',
      'Name',
      '123e4567-e89b-12d3-a456-426614174000',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('validation');
  });

  it('returns validation error for invalid companyId', async () => {
    const r = await twentyCreateContact(CFG, 'j@x.com', 'Name', 'bad-id');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('validation');
  });

  it('returns not_configured when credentials missing', async () => {
    const r = await twentyCreateContact(
      UNCONFIGURED,
      'j@x.com',
      'J',
      '123e4567-e89b-12d3-a456-426614174000',
    );
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns error on HTTP failure', async () => {
    const r = await twentyCreateContact(
      CFG,
      'j@x.com',
      'J',
      '123e4567-e89b-12d3-a456-426614174000',
      undefined,
      mockFetch(409, {}),
    );
    expect(r).toEqual({ ok: false, reason: 'http_409' });
  });

  it('returns network error on fetch failure', async () => {
    const r = await twentyCreateContact(
      CFG,
      'j@x.com',
      'J',
      '123e4567-e89b-12d3-a456-426614174000',
      undefined,
      mockFetchThrow('ENOTFOUND'),
    );
    expect(r).toEqual({ ok: false, reason: 'ENOTFOUND' });
  });
});

describe('twentyUpsertLead', () => {
  const COMPANY_ID = '123e4567-e89b-12d3-a456-426614174000';
  const input = { name: 'Q3 Roofing Contract', amount: 5000000, stage: 'QUALIFIED' as const };

  it('creates opportunity and returns id', async () => {
    const r = await twentyUpsertLead(
      CFG,
      COMPANY_ID,
      input,
      mockFetch(200, { data: { id: 'opp-uuid-001' } }),
    );
    expect(r).toEqual({ ok: true, id: 'opp-uuid-001' });
  });

  it('defaults stage to NEW when omitted', async () => {
    let capturedBody = '';
    const spy = (async (_url: string, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? '';
      return { ok: true, status: 200, json: async () => ({ data: { id: 'x' } }) };
    }) as unknown as typeof fetch;
    await twentyUpsertLead(CFG, COMPANY_ID, { name: 'Minimal' }, spy);
    const parsed = JSON.parse(capturedBody);
    expect(parsed.stage).toBe('NEW');
  });

  it('returns validation error for invalid stage', async () => {
    const r = await twentyUpsertLead(CFG, COMPANY_ID, { name: 'X', stage: 'INVALID' as any });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('validation');
  });

  it('returns validation error for negative amount', async () => {
    const r = await twentyUpsertLead(CFG, COMPANY_ID, { name: 'X', amount: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('validation');
  });

  it('returns not_configured when credentials missing', async () => {
    const r = await twentyUpsertLead(UNCONFIGURED, COMPANY_ID, input);
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns error on HTTP failure', async () => {
    const r = await twentyUpsertLead(CFG, COMPANY_ID, input, mockFetch(422, {}));
    expect(r).toEqual({ ok: false, reason: 'http_422' });
  });

  it('returns network error on fetch failure', async () => {
    const r = await twentyUpsertLead(CFG, COMPANY_ID, input, mockFetchThrow('timeout'));
    expect(r).toEqual({ ok: false, reason: 'timeout' });
  });
});
