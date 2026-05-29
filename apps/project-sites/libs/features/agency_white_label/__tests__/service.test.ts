/**
 * Unit tests for agency_white_label schemas.
 *
 * Service-level tests with D1 live in the integration suite. Here we
 * pin down the schema invariants that prevent garbage tenants from
 * ever reaching the table.
 */

import {
  AgencyConfigSchema,
  CreateAgencyRequestSchema,
} from '../schemas.js';

describe('agency_white_label/schemas', () => {
  test('accepts a clean brand chrome config', () => {
    const ok = AgencyConfigSchema.safeParse({
      brand_name: 'Acme Studio',
      logo_url: 'https://cdn.acme.test/logo.svg',
      primary_color: '#00E5FF',
      custom_domain: 'studio.acme.test',
      support_email: 'hello@acme.test',
    });
    expect(ok.success).toBe(true);
  });

  test('rejects 3-digit hex colors', () => {
    const bad = AgencyConfigSchema.safeParse({
      brand_name: 'X',
      primary_color: '#fff',
    });
    expect(bad.success).toBe(false);
  });

  test('rejects single-label hostnames', () => {
    const bad = AgencyConfigSchema.safeParse({
      brand_name: 'X Studio',
      custom_domain: 'localhost',
    });
    expect(bad.success).toBe(false);
  });

  test('defaults tier to starter on create', () => {
    const parsed = CreateAgencyRequestSchema.parse({
      brand_name: 'Acme Studio',
    });
    expect(parsed.tier).toBe('starter');
  });

  test('rejects empty brand_name', () => {
    const bad = CreateAgencyRequestSchema.safeParse({ brand_name: '' });
    expect(bad.success).toBe(false);
  });

  test('rejects brand_name > 64 chars', () => {
    const bad = CreateAgencyRequestSchema.safeParse({
      brand_name: 'x'.repeat(65),
    });
    expect(bad.success).toBe(false);
  });
});
