import {
  userSubject,
  siteResource,
  orgResource,
  platformResource,
} from '../platform/authz-subjects.js';

describe('authz-subjects (OpenFGA typed-identifier convention)', () => {
  it('builds typed subject/resource identifiers', () => {
    expect(userSubject('u1')).toBe('user:u1');
    expect(siteResource('s1')).toBe('site:s1');
    expect(orgResource('o1')).toBe('org:o1');
    expect(platformResource()).toBe('platform');
  });
  it('preserves the raw id verbatim (no encoding) so writes + checks match', () => {
    expect(userSubject('api-key_abc.123')).toBe('user:api-key_abc.123');
    expect(siteResource('')).toBe('site:');
  });
  it('uses distinct type prefixes per resource kind', () => {
    const id = 'x';
    const all = [userSubject(id), siteResource(id), orgResource(id)];
    expect(new Set(all).size).toBe(3);
  });
});
