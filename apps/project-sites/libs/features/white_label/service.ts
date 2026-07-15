/** White-Label Agency Mode (#12, ROI 2.10) — pure branding + reseller engine. Zero I/O. */
export interface AgencyBrand { agencyName: string; logoUrl: string; primaryColor: string; accentColor: string; customDomain: string; footerText: string; }
export interface ClientSite { siteId: string; clientName: string; plan: string; monthlyFee: number; status: 'active' | 'paused' | 'canceled'; }
export interface AgencyDashboard { agencyName: string; brand: AgencyBrand; clientSites: ClientSite[]; totalMrr: number; activeClients: number; churnRate: number; }

export function agencyMrr(sites: ClientSite[]): number {
  return sites.filter((s) => s.status === 'active').reduce((sum, s) => sum + s.monthlyFee, 0);
}
export function churnRate(sites: ClientSite[]): number {
  const canceled = sites.filter((s) => s.status === 'canceled').length;
  return sites.length > 0 ? Math.round((canceled / sites.length) * 100) : 0;
}
export function buildAgencyDashboard(brand: AgencyBrand, sites: ClientSite[]): AgencyDashboard {
  return { agencyName: brand.agencyName, brand, clientSites: sites, totalMrr: agencyMrr(sites), activeClients: sites.filter((s) => s.status === 'active').length, churnRate: churnRate(sites) };
}
