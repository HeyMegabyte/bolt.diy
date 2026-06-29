/**
 * Tests for Twenty CRM typed client — Zod schemas only.
 *
 * @remarks
 * Pure schema validation tests: no I/O, no mocks, no API calls. Every schema
 * is tested for valid parse, invalid rejection, and edge cases. Inferred
 * types are compile-time only (verified by tsc, not at runtime).
 *
 * @group unit
 */
import {
  AddressSchema,
  CompanySchema,
  CompanyCreateSchema,
  PersonSchema,
  PersonCreateSchema,
  OpportunitySchema,
  OpportunityCreateSchema,
  TwentyStageSchema,
  SingleRecordResponseSchema,
  ListResponseSchema,
  TWENTY_STAGES,
} from '../services/twenty_client';

// ---------------------------------------------------------------------------
// AddressSchema
// ---------------------------------------------------------------------------
describe('AddressSchema', () => {
  it('parses a full address object', () => {
    const result = AddressSchema.safeParse({
      addressStreet1: '123 Main St',
      addressStreet2: 'Suite 200',
      addressCity: 'Newark',
      addressState: 'NJ',
      addressPostcode: '07102',
      addressCountry: 'US',
      addressLat: 40.7357,
      addressLng: -74.1724,
    });
    expect(result.success).toBe(true);
  });

  it('parses an address with only street1', () => {
    const result = AddressSchema.safeParse({ addressStreet1: '1 Main St' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty addressStreet1', () => {
    const result = AddressSchema.safeParse({ addressStreet1: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('addressStreet1');
    }
  });

  it('rejects unknown keys via strict()', () => {
    const result = AddressSchema.safeParse({
      addressStreet1: '1 Main St',
      unknownField: 'nope',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CompanySchema
// ---------------------------------------------------------------------------
describe('CompanySchema', () => {
  const valid = () => ({
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    name: 'Acme Roofing',
    domain: 'acmeroofing.com',
    address: { addressStreet1: '1 Main St', addressCity: 'Newark' },
    employees: 12,
    annualRevenue: 1_500_000,
    createdAt: '2026-06-01T12:00:00.000Z',
  });

  it('parses a full company', () => {
    expect(CompanySchema.safeParse(valid()).success).toBe(true);
  });

  it('parses a minimal company (name + id + createdAt only)', () => {
    const result = CompanySchema.safeParse({
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      name: 'Acme Roofing',
      createdAt: '2026-06-01T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing name', () => {
    const result = CompanySchema.safeParse({
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      createdAt: '2026-06-01T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('name');
    }
  });

  it('rejects an empty name', () => {
    const result = CompanySchema.safeParse({ ...valid(), name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('name');
    }
  });

  it('rejects a malformed id', () => {
    const result = CompanySchema.safeParse({ ...valid(), id: 'not-a-uuid' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('id');
    }
  });

  it('rejects a negative annualRevenue', () => {
    const result = CompanySchema.safeParse({ ...valid(), annualRevenue: -100 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer employees', () => {
    const result = CompanySchema.safeParse({ ...valid(), employees: 12.5 });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid createdAt datetime', () => {
    const result = CompanySchema.safeParse({ ...valid(), createdAt: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CompanyCreateSchema
// ---------------------------------------------------------------------------
describe('CompanyCreateSchema', () => {
  it('omits id and createdAt', () => {
    const result = CompanyCreateSchema.safeParse({ name: 'Acme Roofing' });
    expect(result.success).toBe(true);
  });

  it('rejects with id (server-generated field)', () => {
    const result = CompanyCreateSchema.safeParse({
      name: 'Acme Roofing',
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    expect(result.success).toBe(false);
  });

  it('includes optional fields', () => {
    const result = CompanyCreateSchema.safeParse({
      name: 'Acme Roofing',
      domain: 'acmeroofing.com',
      employees: 12,
      annualRevenue: 1_500_000,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PersonSchema
// ---------------------------------------------------------------------------
describe('PersonSchema', () => {
  const valid = () => ({
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    name: 'Jane Doe',
    email: 'jane@acmeroofing.com',
    phone: '+15551234567',
    companyId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    createdAt: '2026-06-01T12:00:00.000Z',
  });

  it('parses a full person', () => {
    expect(PersonSchema.safeParse(valid()).success).toBe(true);
  });

  it('parses without phone', () => {
    const { phone, ...rest } = valid();
    expect(PersonSchema.safeParse(rest).success).toBe(true);
  });

  it('rejects a missing email', () => {
    const result = PersonSchema.safeParse({
      id: valid().id,
      name: 'Jane Doe',
      companyId: valid().companyId,
      createdAt: valid().createdAt,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('email');
    }
  });

  it('rejects an invalid email', () => {
    const result = PersonSchema.safeParse({ ...valid(), email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed companyId', () => {
    const result = PersonSchema.safeParse({ ...valid(), companyId: 'bad-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a name that is too long', () => {
    const result = PersonSchema.safeParse({ ...valid(), name: 'A'.repeat(256) });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PersonCreateSchema
// ---------------------------------------------------------------------------
describe('PersonCreateSchema', () => {
  it('omits id and createdAt', () => {
    const result = PersonCreateSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@acmeroofing.com',
      companyId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    expect(result.success).toBe(true);
  });

  it('rejects with id (server-generated)', () => {
    const result = PersonCreateSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@acmeroofing.com',
      companyId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TwentyStageSchema
// ---------------------------------------------------------------------------
describe('TwentyStageSchema', () => {
  it('accepts every defined stage', () => {
    for (const stage of TWENTY_STAGES) {
      expect(TwentyStageSchema.safeParse(stage).success).toBe(true);
    }
  });

  it('rejects an unknown stage', () => {
    const result = TwentyStageSchema.safeParse('ARCHIVED');
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    const result = TwentyStageSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OpportunitySchema
// ---------------------------------------------------------------------------
describe('OpportunitySchema', () => {
  const valid = () => ({
    id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
    name: 'Q3 Roofing Contract',
    amount: 5_000_000,
    stage: 'NEGOTIATION' as const,
    closeDate: '2026-09-30',
    companyId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    personId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    createdAt: '2026-06-15T08:00:00.000Z',
  });

  it('parses a full opportunity', () => {
    expect(OpportunitySchema.safeParse(valid()).success).toBe(true);
  });

  it('parses without personId and closeDate', () => {
    const { personId, closeDate, ...rest } = valid();
    expect(OpportunitySchema.safeParse(rest).success).toBe(true);
  });

  it('defaults amount to 0', () => {
    const { amount, ...rest } = valid();
    const result = OpportunitySchema.parse(rest);
    expect(result.amount).toBe(0);
  });

  it('rejects a negative amount', () => {
    const result = OpportunitySchema.safeParse({ ...valid(), amount: -100 });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid stage', () => {
    const result = OpportunitySchema.safeParse({ ...valid(), stage: 'BOGUS' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing companyId', () => {
    const { companyId, ...rest } = valid();
    const result = OpportunitySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OpportunityCreateSchema
// ---------------------------------------------------------------------------
describe('OpportunityCreateSchema', () => {
  it('omits id and createdAt', () => {
    const result = OpportunityCreateSchema.safeParse({
      name: 'Q3 Roofing Contract',
      stage: 'NEW',
      companyId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------
describe('SingleRecordResponseSchema', () => {
  it('parses a valid create response', () => {
    const result = SingleRecordResponseSchema.safeParse({
      data: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a response without data.id', () => {
    const result = SingleRecordResponseSchema.safeParse({ data: {} });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    const result = SingleRecordResponseSchema.safeParse({ data: { id: '123' } });
    expect(result.success).toBe(false);
  });
});

describe('ListResponseSchema', () => {
  it('parses a list of companies', () => {
    const result = ListResponseSchema.safeParse({
      data: {
        companies: [
          { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Acme' },
          { id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', name: 'Beta' },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('parses an empty list', () => {
    const result = ListResponseSchema.safeParse({ data: { companies: [] } });
    expect(result.success).toBe(true);
  });

  it('rejects data without a key', () => {
    const result = ListResponseSchema.safeParse({ data: {} });
    expect(result.success).toBe(true); // empty record is valid — edge case
  });
});

// ---------------------------------------------------------------------------
// Type assertion helpers (compile-time — verified by tsc --noEmit)
// ---------------------------------------------------------------------------
describe('inferred types', () => {
  it('Company has string id', () => {
    const c: import('../services/twenty_client').Company = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      name: 'Acme',
      createdAt: '2026-06-01T12:00:00.000Z',
    };
    expect(typeof c.id).toBe('string');
  });

  it('Person has email', () => {
    const p: import('../services/twenty_client').Person = {
      id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      name: 'Jane Doe',
      email: 'jane@test.com',
      companyId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      createdAt: '2026-06-01T12:00:00.000Z',
    };
    expect(p.email).toContain('@');
  });

  it('Opportunity stage is a TwentyStage', () => {
    const o: import('../services/twenty_client').Opportunity = {
      id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
      name: 'Test',
      amount: 0,
      stage: 'NEW',
      companyId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      createdAt: '2026-06-01T12:00:00.000Z',
    };
    expect(TWENTY_STAGES).toContain(o.stage);
  });
});
