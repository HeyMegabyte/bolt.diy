/**
 * Unit tests for scan profiles (Lead Scanner editable config, #89). All pure;
 * a fixed nowMs is injected for deterministic due-logic (no Date.now()).
 */

import { describe, it, expect } from '@jest/globals';
import {
  validateScanProfile,
  isProfileDue,
  listDueProfiles,
  profileToRunSpecs,
  defaultScanProfile,
  ScanProfileConfigSchema,
  type ScanProfileConfig,
} from '../services/scan_profiles.js';

const NOW = 1_782_700_000_000;

function profile(over: Partial<ScanProfileConfig> = {}): ScanProfileConfig {
  return ScanProfileConfigSchema.parse({
    id: 'p1',
    name: 'Test',
    bboxes: [[40, -74.3, 40.1, -74.2]],
    ...over,
  });
}

describe('scan_profiles — validate', () => {
  it('accepts a minimal valid profile and applies defaults', () => {
    const r = validateScanProfile({ id: 'p1', name: 'X', bboxes: [[0, 0, 1, 1]] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profile.enabled).toBe(false);
      expect(r.profile.providers).toEqual(['osm']);
      expect(r.profile.maxLeadsPerRun).toBe(50);
      expect(r.profile.intervalMinutes).toBe(0);
    }
  });

  it('rejects missing bboxes / bad bbox / unknown provider', () => {
    expect(validateScanProfile({ id: 'p', name: 'X', bboxes: [] }).ok).toBe(false);
    expect(validateScanProfile({ id: 'p', name: 'X', bboxes: [[1, 2, 3]] }).ok).toBe(false);
    expect(
      validateScanProfile({ id: 'p', name: 'X', bboxes: [[0, 0, 1, 1]], providers: ['bing'] }).ok,
    ).toBe(false);
  });

  it('returns a flat error map on failure', () => {
    const r = validateScanProfile({ name: 'X', bboxes: [[0, 0, 1, 1]] }); // missing id
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.id).toBeDefined();
  });
});

describe('scan_profiles — isProfileDue', () => {
  it('never due when disabled or manual (interval 0)', () => {
    expect(isProfileDue(profile({ enabled: false, intervalMinutes: 60 }), NOW)).toBe(false);
    expect(isProfileDue(profile({ enabled: true, intervalMinutes: 0 }), NOW)).toBe(false);
  });

  it('due when enabled + interval set + never run', () => {
    expect(isProfileDue(profile({ enabled: true, intervalMinutes: 60, lastRunAt: null }), NOW)).toBe(
      true,
    );
  });

  it('due only after the interval elapses', () => {
    const p = profile({ enabled: true, intervalMinutes: 60, lastRunAt: NOW - 30 * 60_000 });
    expect(isProfileDue(p, NOW)).toBe(false); // 30m < 60m
    const p2 = profile({ enabled: true, intervalMinutes: 60, lastRunAt: NOW - 61 * 60_000 });
    expect(isProfileDue(p2, NOW)).toBe(true); // 61m >= 60m
  });
});

describe('scan_profiles — listDueProfiles', () => {
  it('filters to due profiles only', () => {
    const due = profile({ id: 'due', enabled: true, intervalMinutes: 60, lastRunAt: null });
    const notDue = profile({ id: 'off', enabled: false, intervalMinutes: 60 });
    const manual = profile({ id: 'man', enabled: true, intervalMinutes: 0 });
    const out = listDueProfiles([due, notDue, manual], NOW);
    expect(out.map((p) => p.id)).toEqual(['due']);
  });
});

describe('scan_profiles — profileToRunSpecs', () => {
  it('expands each bbox into a run spec carrying source/categories/maxLeads', () => {
    const p = profile({
      bboxes: [
        [40, -74.3, 40.1, -74.2],
        [41, -73.3, 41.1, -73.2],
      ],
      categories: ['shop'],
      source: 'osm',
      maxLeadsPerRun: 25,
    });
    const specs = profileToRunSpecs(p);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toEqual({
      source: 'osm',
      bbox: [40, -74.3, 40.1, -74.2],
      categories: ['shop'],
      maxLeads: 25,
    });
  });
});

describe('scan_profiles — defaultScanProfile', () => {
  it('returns a disabled, schema-valid starter', () => {
    const p = defaultScanProfile('seed1');
    expect(p.id).toBe('seed1');
    expect(p.enabled).toBe(false);
    expect(ScanProfileConfigSchema.safeParse(p).success).toBe(true);
  });
});
