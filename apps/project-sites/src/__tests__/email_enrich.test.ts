/**
 * Unit tests for email enrichment (Lead Scanner). Pure helpers tested directly;
 * enrichEmail tested with a stub fetch (DoH MX via hasDeliverableMx).
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  extractEmailDomain,
  emailCandidatesForDomain,
  classifyEmailSource,
  enrichEmail,
} from '../services/email_enrich.js';

describe('email_enrich — extractEmailDomain', () => {
  it('returns the domain lowercased', () => {
    expect(extractEmailDomain('Owner@Acme.COM')).toBe('acme.com');
  });
  it('returns null for malformed input', () => {
    expect(extractEmailDomain('no-at')).toBeNull();
    expect(extractEmailDomain('@x.com')).toBeNull();
    expect(extractEmailDomain('a@')).toBeNull();
    expect(extractEmailDomain(null)).toBeNull();
  });
});

describe('email_enrich — emailCandidatesForDomain', () => {
  it('generates ranked candidates for a domain', () => {
    const c = emailCandidatesForDomain('acme.com');
    expect(c[0]).toBe('info@acme.com');
    expect(c).toContain('contact@acme.com');
  });
  it('strips scheme/path and returns [] for non-domains', () => {
    expect(emailCandidatesForDomain('https://acme.com/x')[0]).toBe('info@acme.com');
    expect(emailCandidatesForDomain('notadomain')).toEqual([]);
    expect(emailCandidatesForDomain('')).toEqual([]);
  });
});

describe('email_enrich — classifyEmailSource', () => {
  it('listing wins', () => {
    expect(classifyEmailSource({ fromListing: true, guessed: true })).toBe('listing');
  });
  it('guessed maps by MX validity', () => {
    expect(classifyEmailSource({ guessed: true, mxValid: true })).toBe('guessed_mx');
    expect(classifyEmailSource({ guessed: true, mxValid: false })).toBe('guessed');
  });
  it('null when nothing applies', () => {
    expect(classifyEmailSource({})).toBeNull();
  });
});

describe('email_enrich — enrichEmail', () => {
  it('returns a listing email as source=listing without any fetch', async () => {
    const stub = jest.fn();
    const r = await enrichEmail(
      { listingEmail: 'hi@joe.com' },
      stub as unknown as typeof fetch,
    );
    expect(r).toEqual({ email: 'hi@joe.com', source: 'listing' });
    expect(stub).not.toHaveBeenCalled();
  });

  it('guesses from domain and upgrades to guessed_mx when MX resolves', async () => {
    // hasDeliverableMx hits cloudflare-dns DoH; stub a positive MX answer.
    const stub = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ Status: 0, Answer: [{ type: 15, data: '10 mx.acme.com' }] }),
    });
    const r = await enrichEmail({ domain: 'acme.com' }, stub as unknown as typeof fetch);
    expect(r.email).toBe('info@acme.com');
    expect(r.source).toBe('guessed_mx');
  });

  it('falls back to guessed when MX lookup fails', async () => {
    const stub = jest.fn().mockRejectedValue(new Error('dns down'));
    const r = await enrichEmail({ domain: 'acme.com' }, stub as unknown as typeof fetch);
    expect(r.email).toBe('info@acme.com');
    expect(r.source).toBe('guessed');
  });

  it('returns null/null when no listing email and no domain', async () => {
    const r = await enrichEmail({}, (jest.fn() as unknown) as typeof fetch);
    expect(r).toEqual({ email: null, source: null });
  });
});
