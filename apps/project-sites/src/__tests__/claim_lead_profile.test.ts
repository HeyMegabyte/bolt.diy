/**
 * Tests for the claim_lead_profile module.
 *
 * TDD — written BEFORE implementation. All tests should fail on first run,
 * then pass once the module is implemented.
 */

import {
  ClaimLeadProfileSchema,
  toCreateFormPrefill,
  mergeRebuildContext,
} from '../services/claim_lead_profile';
import type { ClaimLeadProfile } from '../services/claim_lead_profile';

// ---------------------------------------------------------------------------
// ClaimLeadProfileSchema — validation tests
// ---------------------------------------------------------------------------

describe('ClaimLeadProfileSchema', () => {
  it('validates a minimal profile with only businessName', () => {
    const result = ClaimLeadProfileSchema.safeParse({ businessName: 'Acme Corp' });
    expect(result.success).toBe(true);
  });

  it('rejects a profile missing the required businessName', () => {
    const result = ClaimLeadProfileSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a profile with an empty businessName string', () => {
    const result = ClaimLeadProfileSchema.safeParse({ businessName: '' });
    expect(result.success).toBe(false);
  });

  it('validates a fully populated profile', () => {
    const full: ClaimLeadProfile = {
      businessName: "Vito's Mens Salon",
      phone: '+19737355555',
      email: 'vito@example.com',
      address: '74 N Beverwyck Rd',
      city: 'Lake Hiawatha',
      state: 'NJ',
      postal: '07034',
      country: 'US',
      category: 'salon',
      description: 'A classic barbershop in New Jersey.',
      services: ['haircut', 'shave', 'beard trim'],
      hours: 'Mon-Sat 9am-6pm',
      mapsUrl: 'https://maps.google.com/?q=vitos',
      existingWebsite: 'https://vitosmens.com',
      logoUrl: 'https://vitosmens.com/logo.png',
      cta: 'Book a haircut today',
      targetCustomer: 'Men 25-55 in Morris County NJ',
      tone: 'friendly and professional',
      notes: 'Family-owned since 1987',
      sourceConfidence: 0.9,
      leadSource: 'google-places',
    };
    const result = ClaimLeadProfileSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range sourceConfidence value', () => {
    const result = ClaimLeadProfileSchema.safeParse({
      businessName: 'Acme',
      sourceConfidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra keys (strict mode)', () => {
    const result = ClaimLeadProfileSchema.safeParse({ businessName: 'Acme', unknownField: 'x' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toCreateFormPrefill — field mapping tests
// ---------------------------------------------------------------------------

describe('toCreateFormPrefill', () => {
  it('copies present fields into a flat object', () => {
    const profile: ClaimLeadProfile = {
      businessName: 'Acme Corp',
      city: 'Newark',
      category: 'retail',
    };
    const prefill = toCreateFormPrefill(profile);
    expect(prefill['businessName']).toBe('Acme Corp');
    expect(prefill['city']).toBe('Newark');
    expect(prefill['category']).toBe('retail');
  });

  it('omits fields that are undefined', () => {
    const profile: ClaimLeadProfile = { businessName: 'Acme Corp' };
    const prefill = toCreateFormPrefill(profile);
    // Only businessName should appear; no keys with undefined values
    const keys = Object.keys(prefill);
    expect(keys).toEqual(['businessName']);
  });

  it('returns a plain object (Record<string, unknown>)', () => {
    const profile: ClaimLeadProfile = { businessName: 'Test Biz', services: ['a', 'b'] };
    const prefill = toCreateFormPrefill(profile);
    expect(Array.isArray(prefill['services'])).toBe(true);
    expect((prefill['services'] as string[]).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// mergeRebuildContext — merge + re-validate tests
// ---------------------------------------------------------------------------

describe('mergeRebuildContext', () => {
  const base: ClaimLeadProfile = {
    businessName: 'Acme Corp',
    city: 'Newark',
    state: 'NJ',
    sourceConfidence: 0.7,
  };

  it('applies edits over the base profile', () => {
    const merged = mergeRebuildContext(base, { city: 'Trenton', phone: '+16095550100' });
    expect(merged.city).toBe('Trenton');
    expect(merged.phone).toBe('+16095550100');
  });

  it('keeps unedited fields intact', () => {
    const merged = mergeRebuildContext(base, { city: 'Trenton' });
    expect(merged.businessName).toBe('Acme Corp');
    expect(merged.state).toBe('NJ');
    expect(merged.sourceConfidence).toBe(0.7);
  });

  it('last-write-wins — edit overwrites the original value', () => {
    const merged = mergeRebuildContext(base, { businessName: 'New Name' });
    expect(merged.businessName).toBe('New Name');
  });

  it('throws ZodError when the merged result is invalid', () => {
    // Removing businessName by setting it to '' makes the schema invalid.
    expect(() => mergeRebuildContext(base, { businessName: '' })).toThrow();
  });

  it('returns a fresh object and does not mutate the original', () => {
    const merged = mergeRebuildContext(base, { city: 'Princeton' });
    expect(base.city).toBe('Newark'); // original unchanged
    expect(merged.city).toBe('Princeton');
  });
});
