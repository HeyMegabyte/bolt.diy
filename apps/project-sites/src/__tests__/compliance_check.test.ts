import { checkCompliance, JURISDICTION_RULES } from '../services/compliance_check.js';

describe('checkCompliance (GDPR/EU data-residency rule engine)', () => {
  it('passes a fully compliant EU setup', () => {
    const r = checkCompliance({
      hasConsentBanner: true,
      hasDataDeletion: true,
      hasDataExport: true,
      jurisdiction: 'eu',
      storesPii: true,
      usesThirdPartyTracking: false,
    });
    expect(r.pass).toBe(true);
    expect(r.violations).toEqual([]);
    // Data-residency infrastructure requirement is a requiredAction, not a violation
    expect(r.requiredActions).toEqual([
      'ensure all PII storage (database, cache, backups) is in EU',
    ]);
  });

  it('fails EU config with no consent banner and PII stored', () => {
    const r = checkCompliance({
      hasConsentBanner: false,
      hasDataDeletion: true,
      hasDataExport: true,
      jurisdiction: 'eu',
      storesPii: true,
      usesThirdPartyTracking: false,
    });
    expect(r.pass).toBe(false);
    expect(r.violations).toContain('consent banner required but missing');
  });

  it('flags missing data export and deletion under EU', () => {
    const r = checkCompliance({
      hasConsentBanner: true,
      hasDataDeletion: false,
      hasDataExport: false,
      jurisdiction: 'eu',
      storesPii: true,
      usesThirdPartyTracking: false,
    });
    expect(r.pass).toBe(false);
    expect(r.violations).toContain('data export endpoint required but missing');
    expect(r.violations).toContain('data deletion endpoint required but missing');
  });

  it('flags third-party tracking without consent under EU', () => {
    const r = checkCompliance({
      hasConsentBanner: false,
      hasDataDeletion: true,
      hasDataExport: true,
      jurisdiction: 'eu',
      storesPii: true,
      usesThirdPartyTracking: true,
    });
    expect(r.pass).toBe(false);
    expect(r.violations).toContain('third-party tracking used without consent banner');
    expect(r.violations).toContain('Data Processing Agreement required for third-party services');
  });

  it('flags DPA requirement for EU + tracking even with consent banner', () => {
    const r = checkCompliance({
      hasConsentBanner: true,
      hasDataDeletion: true,
      hasDataExport: true,
      jurisdiction: 'eu',
      storesPii: true,
      usesThirdPartyTracking: true,
    });
    expect(r.pass).toBe(false);
    expect(r.violations).toContain('Data Processing Agreement required for third-party services');
  });

  it('passes EU when no PII is stored (nothing to regulate)', () => {
    const r = checkCompliance({
      hasConsentBanner: false,
      hasDataDeletion: false,
      hasDataExport: false,
      jurisdiction: 'eu',
      storesPii: false,
      usesThirdPartyTracking: false,
    });
    expect(r.pass).toBe(true);
  });

  it('enforces UK GDPR same as EU', () => {
    const r = checkCompliance({
      hasConsentBanner: false,
      hasDataDeletion: false,
      hasDataExport: false,
      jurisdiction: 'gb',
      storesPii: true,
      usesThirdPartyTracking: true,
    });
    expect(r.pass).toBe(false);
    expect(r.violations).toContain('consent banner required but missing');
    expect(r.violations).toContain('Data Processing Agreement required for third-party services');
  });

  it('enforces LGPD for Brazil — consent + no DPA', () => {
    const r = checkCompliance({
      hasConsentBanner: false,
      hasDataDeletion: false,
      hasDataExport: false,
      jurisdiction: 'br',
      storesPii: true,
      usesThirdPartyTracking: true,
    });
    expect(r.pass).toBe(false);
    expect(r.violations).toContain('consent banner required but missing');
    // LGPD does not require a formal DPA
    expect(r.violations).not.toContain(
      'Data Processing Agreement required for third-party services',
    );
  });

  it('enforces CCPA for California — no DPA', () => {
    const r = checkCompliance({
      hasConsentBanner: false,
      hasDataDeletion: false,
      hasDataExport: false,
      jurisdiction: 'us-ca',
      storesPii: true,
      usesThirdPartyTracking: true,
    });
    expect(r.pass).toBe(false);
    expect(r.violations).toContain('consent banner required but missing');
    expect(r.violations).not.toContain(
      'Data Processing Agreement required for third-party services',
    );
  });

  it('passes US (other states) — no violations, just data-residency requirement', () => {
    const r = checkCompliance({
      hasConsentBanner: false,
      hasDataDeletion: false,
      hasDataExport: false,
      jurisdiction: 'us',
      storesPii: true,
      usesThirdPartyTracking: true,
    });
    // US has no comprehensive federal privacy law — no config violations
    expect(r.pass).toBe(true);
    expect(r.violations).toEqual([]);
    // Data-residency requirement is an infrastructure action, not a violation
    expect(r.requiredActions).toContain(
      'ensure all PII storage (database, cache, backups) is in US',
    );
  });

  it('passes Australia — no violations, just data-residency requirement', () => {
    const r = checkCompliance({
      hasConsentBanner: false,
      hasDataDeletion: false,
      hasDataExport: false,
      jurisdiction: 'au',
      storesPii: true,
      usesThirdPartyTracking: true,
    });
    expect(r.pass).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.requiredActions).toContain(
      'ensure all PII storage (database, cache, backups) is in AU',
    );
  });

  it('passes a fully compliant JP setup', () => {
    const r = checkCompliance({
      hasConsentBanner: true,
      hasDataDeletion: true,
      hasDataExport: true,
      jurisdiction: 'jp',
      storesPii: true,
      usesThirdPartyTracking: false,
    });
    expect(r.pass).toBe(true);
  });

  it('passes unknown jurisdiction with no violations', () => {
    const r = checkCompliance({
      hasConsentBanner: false,
      hasDataDeletion: false,
      hasDataExport: false,
      jurisdiction: 'unknown',
      storesPii: true,
      usesThirdPartyTracking: true,
    });
    expect(r.pass).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('passes when no PII stored under a strict jurisdiction', () => {
    const r = checkCompliance({
      hasConsentBanner: false,
      hasDataDeletion: false,
      hasDataExport: false,
      jurisdiction: 'eu',
      storesPii: false,
      usesThirdPartyTracking: false,
    });
    expect(r.pass).toBe(true);
  });

  it('uses Object.freeze on JURISDICTION_RULES', () => {
    expect(Object.isFrozen(JURISDICTION_RULES)).toBe(true);
    expect(Object.isFrozen(JURISDICTION_RULES.eu)).toBe(true);
  });

  it('emits data-residency required action when PII stored regardless of consent', () => {
    const r = checkCompliance({
      hasConsentBanner: true,
      hasDataDeletion: true,
      hasDataExport: true,
      jurisdiction: 'eu',
      storesPii: true,
      usesThirdPartyTracking: false,
    });
    // Data-residency surfaces as a required action (infrastructure concern),
    // not a violation — pass is still true when all site-config rules are met
    expect(r.pass).toBe(true);
    expect(r.requiredActions).toContain(
      'ensure all PII storage (database, cache, backups) is in EU',
    );
  });
});
