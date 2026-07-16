import { createPortal, validateAccess, listPages, generateMagicLink, isExpired } from '../service.js';

const portal = createPortal('client-1', 'Acme Corp', ['/invoices', '/projects', '/files']);

describe('createPortal', () => {
  test('returns complete portal config', () => {
    expect(portal.portalId).toContain('portal_');
    expect(portal.clientName).toBe('Acme Corp');
    expect(portal.accessiblePages).toHaveLength(3);
    expect(portal.magicLinkToken).toBeTruthy();
    expect(portal.expiresAt).toBeTruthy();
  });
});

describe('validateAccess', () => {
  test('grants access with correct token and page', () => {
    expect(validateAccess(portal, portal.magicLinkToken, '/invoices')).toBe(true);
  });

  test('grants access to sub-pages', () => {
    expect(validateAccess(portal, portal.magicLinkToken, '/invoices/2024/january')).toBe(true);
  });

  test('denies access with wrong token', () => {
    expect(validateAccess(portal, 'wrong-token', '/invoices')).toBe(false);
  });

  test('denies access to unauthorized page', () => {
    expect(validateAccess(portal, portal.magicLinkToken, '/admin')).toBe(false);
  });

  test('denies access to expired portal', () => {
    const expired = { ...portal, expiresAt: '2020-01-01T00:00:00.000Z' };
    expect(validateAccess(expired, expired.magicLinkToken, '/invoices')).toBe(false);
  });
});

describe('listPages', () => {
  test('returns all accessible pages', () => {
    expect(listPages(portal)).toEqual(['/invoices', '/projects', '/files']);
  });
});

describe('generateMagicLink', () => {
  test('returns a URL with token and email', () => {
    const link = generateMagicLink(portal, 'client@acme.com');
    expect(link).toContain('portal.projectsites.dev');
    expect(link).toContain(portal.magicLinkToken);
    expect(link).toContain('client%40acme.com');
  });
});

describe('isExpired', () => {
  test('returns false for active portal', () => {
    expect(isExpired(portal)).toBe(false);
  });

  test('returns true for expired portal', () => {
    expect(isExpired({ ...portal, expiresAt: '2020-01-01T00:00:00.000Z' })).toBe(true);
  });
});
