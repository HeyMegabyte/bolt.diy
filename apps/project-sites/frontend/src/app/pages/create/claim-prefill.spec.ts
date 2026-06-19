import { mapClaimPrefillToFields, parseClaimBuildState } from './claim-prefill';

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
    const f = mapClaimPrefillToFields({
      businessName: 'X',
      website: 'https://w',
      notes: 'note text',
    });
    expect(f.businessWebsite).toBe('https://w');
    expect(f.additionalContext).toBe('note text');
  });

  it('returns an empty object for an empty payload', () => {
    expect(mapClaimPrefillToFields({})).toEqual({});
  });
});

describe('parseClaimBuildState', () => {
  it('reports a building status as non-terminal with no preview', () => {
    const s = parseClaimBuildState({ buildStatus: 'building' });
    expect(s.status).toBe('building');
    expect(s.previewUrl).toBeNull();
    expect(s.terminal).toBe(false);
  });

  it('reports pending as non-terminal (keep polling)', () => {
    expect(parseClaimBuildState({ buildStatus: 'pending' }).terminal).toBe(false);
  });

  it('captures the preview URL + marks terminal on completed', () => {
    const s = parseClaimBuildState({
      buildStatus: 'completed',
      previewUrl: 'https://acme.projectsites.dev',
    });
    expect(s.status).toBe('completed');
    expect(s.previewUrl).toBe('https://acme.projectsites.dev');
    expect(s.terminal).toBe(true);
  });

  it('marks failed terminal but never surfaces a preview', () => {
    const s = parseClaimBuildState({ buildStatus: 'failed', previewUrl: 'https://x' });
    expect(s.status).toBe('failed');
    expect(s.previewUrl).toBeNull();
    expect(s.terminal).toBe(true);
  });

  it('ignores a previewUrl that arrives before completion', () => {
    const s = parseClaimBuildState({ buildStatus: 'building', previewUrl: 'https://early' });
    expect(s.previewUrl).toBeNull();
  });

  it('collapses an unknown/absent/malformed status to unknown, non-terminal', () => {
    expect(parseClaimBuildState({ buildStatus: 'weird' }).status).toBe('unknown');
    expect(parseClaimBuildState({}).status).toBe('unknown');
    expect(parseClaimBuildState(null).terminal).toBe(false);
    expect(parseClaimBuildState(undefined).previewUrl).toBeNull();
  });
});
