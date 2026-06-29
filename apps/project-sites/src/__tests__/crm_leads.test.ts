/**
 * Unit tests for the CRM lead sink (Twenty @ crm.projectsites.dev, HTTP boundary).
 * Pure mapper tested directly; the thin client tested with a stub fetch.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  leadToCrmCompany,
  isCrmConfigured,
  upsertLeadToCrm,
  type CrmLeadPayload,
} from '../services/crm_leads.js';
import type { Env } from '../types/env.js';

const cfgEnv = { TWENTY_API_URL: 'https://crm.projectsites.dev', TWENTY_API_KEY: 'k' } as Env;
const darkEnv = {} as Env;

describe('crm_leads — leadToCrmCompany (pure mapper)', () => {
  it('maps a discovered business + signals into a scored payload', () => {
    const p = leadToCrmCompany(
      { businessName: "Joe's Plumbing", phone: '+12015551234', category: 'plumber' },
      { hasWebsite: false, emailSource: 'listing', addressSource: 'places', category: 'plumber' },
      'google_places',
    );
    expect(p.name).toBe("Joe's Plumbing");
    expect(p.phone).toBe('+12015551234');
    expect(p.hasWebsite).toBe(false);
    expect(p.source).toBe('google_places');
    expect(p.leadScore).toBeGreaterThan(0);
    expect(['A', 'B', 'C', 'D']).toContain(p.payTier);
    expect(p.emailConfidence).toBe(75);
    expect(p.addressConfidence).toBe(70);
    expect(p.outreachChannel).toBe('both');
  });

  it('omits absent optional fields (no empty strings)', () => {
    const p = leadToCrmCompany(
      { businessName: 'Bare Co' },
      { hasWebsite: false },
      'osm',
    );
    expect(p).not.toHaveProperty('phone');
    expect(p).not.toHaveProperty('email');
    expect(p).not.toHaveProperty('address');
    expect(p.name).toBe('Bare Co');
  });

  it('a business with a website scores 0 / tier D', () => {
    const p = leadToCrmCompany(
      { businessName: 'Has Site LLC' },
      { hasWebsite: true, emailSource: 'verified' },
      'google_places',
    );
    expect(p.leadScore).toBe(0);
    expect(p.payTier).toBe('D');
    expect(p.hasWebsite).toBe(true);
  });
});

describe('crm_leads — isCrmConfigured', () => {
  it('true only when both URL and key are set', () => {
    expect(isCrmConfigured(cfgEnv)).toBe(true);
    expect(isCrmConfigured(darkEnv)).toBe(false);
    expect(isCrmConfigured({ TWENTY_API_URL: 'x' } as Env)).toBe(false);
  });
});

const samplePayload: CrmLeadPayload = {
  name: 'Test Co',
  leadScore: 60,
  payTier: 'B',
  emailConfidence: 75,
  addressConfidence: 70,
  outreachChannel: 'both',
  hasWebsite: false,
  source: 'google_places',
};

describe('crm_leads — upsertLeadToCrm', () => {
  it('skips (dark) when the CRM is not configured', async () => {
    const fetchSpy = jest.fn();
    const r = await upsertLeadToCrm(darkEnv, samplePayload, fetchSpy as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts to /rest/companies with a bearer token and returns the new id', async () => {
    const fetchStub = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ data: { id: 'co_123' } }),
    });
    const r = await upsertLeadToCrm(cfgEnv, samplePayload, fetchStub as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, skipped: false, id: 'co_123' });
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://crm.projectsites.dev/rest/companies');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(init.method).toBe('POST');
  });

  it('returns ok:false on an HTTP error (never throws)', async () => {
    const fetchStub = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({}),
    });
    const r = await upsertLeadToCrm(cfgEnv, samplePayload, fetchStub as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(false);
    expect(r.status).toBe(422);
  });

  it('returns ok:false on a network throw (never throws)', async () => {
    const fetchStub = jest.fn().mockRejectedValue(new Error('boom'));
    const r = await upsertLeadToCrm(cfgEnv, samplePayload, fetchStub as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('boom');
  });

  it('strips a trailing slash from the base URL', async () => {
    const fetchStub = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'co_9' }),
    });
    await upsertLeadToCrm(
      { TWENTY_API_URL: 'https://crm.projectsites.dev/', TWENTY_API_KEY: 'k' } as Env,
      samplePayload,
      fetchStub as unknown as typeof fetch,
    );
    expect((fetchStub.mock.calls[0] as [string])[0]).toBe(
      'https://crm.projectsites.dev/rest/companies',
    );
  });
});
