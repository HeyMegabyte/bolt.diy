import { buildClaimSiteParams } from '../services/claim_site_params';
import type { ClaimLeadProfile } from '../services/claim_lead_profile';

/**
 * The claim → SiteGenerationParams bridge (#1 generation-consumer keystone).
 * Pure mapping — no env/DB/network. Asserts: required identity passthrough,
 * composed address, folded context, and that absent profile fields produce NO
 * empty-string params (the workflow treats "" and undefined differently).
 */
const OPTS = { siteId: 'site-1', slug: 'acme', orgId: 'org-1' };

function profile(over: Partial<ClaimLeadProfile> = {}): ClaimLeadProfile {
  return { businessName: 'Acme Plumbing', ...over };
}

describe('buildClaimSiteParams', () => {
  it('passes through the provisioned site identity + business name', () => {
    const p = buildClaimSiteParams(profile(), OPTS);
    expect(p.siteId).toBe('site-1');
    expect(p.slug).toBe('acme');
    expect(p.orgId).toBe('org-1');
    expect(p.businessName).toBe('Acme Plumbing');
  });

  it('composes a single address line from address/city/state/postal', () => {
    const p = buildClaimSiteParams(
      profile({ address: '1 Main St', city: 'Newark', state: 'NJ', postal: '07102' }),
      OPTS,
    );
    expect(p.businessAddress).toBe('1 Main St, Newark, NJ, 07102');
  });

  it('omits the address entirely when no address parts are present', () => {
    const p = buildClaimSiteParams(profile(), OPTS);
    expect('businessAddress' in p).toBe(false);
  });

  it('maps phone, category, existing website, and place id', () => {
    const p = buildClaimSiteParams(
      profile({
        phone: '+19735551234',
        category: 'plumber',
        existingWebsite: 'https://old.example',
      }),
      { ...OPTS, googlePlaceId: 'place-9' },
    );
    expect(p.businessPhone).toBe('+19735551234');
    expect(p.businessCategory).toBe('plumber');
    expect(p.businessWebsite).toBe('https://old.example');
    expect(p.googlePlaceId).toBe('place-9');
  });

  it('folds description, services, hours, and map into additionalContext', () => {
    const p = buildClaimSiteParams(
      profile({
        description: 'Family-run since 1998.',
        services: ['Drain cleaning', 'Water heaters'],
        hours: 'Mon-Sat 8-6',
        mapsUrl: 'https://maps.example/x',
      }),
      OPTS,
    );
    expect(p.additionalContext).toContain('Family-run since 1998.');
    expect(p.additionalContext).toContain('Services: Drain cleaning, Water heaters');
    expect(p.additionalContext).toContain('Hours: Mon-Sat 8-6');
    expect(p.additionalContext).toContain('Map: https://maps.example/x');
  });

  it('produces NO empty-string optionals when profile fields are absent', () => {
    const p = buildClaimSiteParams(profile(), OPTS);
    expect('businessPhone' in p).toBe(false);
    expect('businessCategory' in p).toBe(false);
    expect('businessWebsite' in p).toBe(false);
    expect('additionalContext' in p).toBe(false);
    expect('googlePlaceId' in p).toBe(false);
  });

  it('trims whitespace on mapped fields', () => {
    const p = buildClaimSiteParams(profile({ phone: '  555  ', category: '  salon  ' }), OPTS);
    expect(p.businessPhone).toBe('555');
    expect(p.businessCategory).toBe('salon');
  });
});
