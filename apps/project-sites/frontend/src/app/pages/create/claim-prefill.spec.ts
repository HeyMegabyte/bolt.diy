import { mapClaimPrefillToFields } from './claim-prefill';

/**
 * #1 claimyour.site — the /create prefill mapper. Pure: the component fetches the
 * claim profile then applies this to its business* fields. (Karma/Jasmine — this
 * is the frontend, so toBeUndefined/toBe, not Jest.)
 */
describe('mapClaimPrefillToFields', () => {
  it('maps the ClaimLeadProfile keys onto /create field names', () => {
    const f = mapClaimPrefillToFields({
      businessName: 'Acme Roofing',
      address: '1 Main St',
      phone: '555-1212',
      existingWebsite: 'https://old.example',
      category: 'roofing',
      description: 'Family roofers since 1990',
    });
    expect(f.businessName).toBe('Acme Roofing');
    expect(f.businessAddress).toBe('1 Main St');
    expect(f.businessPhone).toBe('555-1212');
    expect(f.businessWebsite).toBe('https://old.example');
    expect(f.businessCategory).toBe('roofing');
    expect(f.additionalContext).toBe('Family roofers since 1990');
  });

  it('omits absent / empty / non-string values (never blanks a field)', () => {
    const f = mapClaimPrefillToFields({ businessName: 'Acme', address: '   ', phone: 42 });
    expect(f.businessName).toBe('Acme');
    expect(f.businessAddress).toBeUndefined();
    expect(f.businessPhone).toBeUndefined();
  });

  it('falls back website→existingWebsite and context→notes', () => {
    const f = mapClaimPrefillToFields({ businessName: 'X', website: 'https://w', notes: 'note text' });
    expect(f.businessWebsite).toBe('https://w');
    expect(f.additionalContext).toBe('note text');
  });

  it('returns an empty object for an empty payload', () => {
    expect(mapClaimPrefillToFields({})).toEqual({});
  });
});
