import { agencyMrr, churnRate, buildAgencyDashboard } from '../service.js';

const sites = [
  { siteId: 's1', clientName: 'Acme', plan: 'pro', monthlyFee: 50, status: 'active' as const },
  { siteId: 's2', clientName: 'Beta', plan: 'pro', monthlyFee: 50, status: 'active' as const },
  { siteId: 's3', clientName: 'Gamma', plan: 'basic', monthlyFee: 29, status: 'canceled' as const },
];

describe('agencyMrr', () => { test('sums active site fees', () => { expect(agencyMrr(sites)).toBe(100); }); });
describe('churnRate', () => { test('computes percentage', () => { expect(churnRate(sites)).toBe(33); }); });
describe('buildAgencyDashboard', () => {
  test('returns complete dashboard', () => {
    const d = buildAgencyDashboard({ agencyName: 'AgencyX', logoUrl: '/logo.png', primaryColor: '#000', accentColor: '#0ff', customDomain: 'sites.agencyx.com', footerText: 'Powered by AgencyX' }, sites);
    expect(d.totalMrr).toBe(100);
    expect(d.activeClients).toBe(2);
    expect(d.churnRate).toBe(33);
    expect(d.brand.customDomain).toBe('sites.agencyx.com');
  });
});
