/**
 * Unit tests for the Twenty CRM lead scoring model.
 * Pure functions — no env, no I/O, no mocks needed.
 *
 * @group unit
 */

import { describe, it, expect } from '@jest/globals';
import { scoreLead, type LeadInput } from '../services/twenty_lead_scoring.js';

function makeInput(overrides: Partial<LeadInput> = {}): LeadInput {
  return {
    hasWebsite: false,
    hasEmail: false,
    hasPhone: false,
    reviewCount: 0,
    reviewRating: 0,
    socialLinks: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tier thresholds
// ---------------------------------------------------------------------------

describe('twenty_lead_scoring — tier thresholds', () => {
  it('A tier when score ≥ 70 (all signals strong)', () => {
    const r = scoreLead(
      makeInput({
        hasWebsite: true,
        hasEmail: true,
        hasPhone: true,
        reviewCount: 30,
        reviewRating: 4.7,
        socialLinks: 5,
        employees: 50,
      }),
    );
    // 20 + 15 + 15 + 15+10 (=25) + 15 + 8 = 98
    expect(r.tier).toBe('A');
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it('B tier when score ≥ 50 but < 70 (moderate signals)', () => {
    const r = scoreLead(
      makeInput({
        hasWebsite: true,
        hasEmail: true,
        hasPhone: false,
        reviewCount: 8,
        reviewRating: 4.0,
        socialLinks: 2,
        employees: 3,
      }),
    );
    // 20 + 15 + 0 + 10+8 (=18, capped at 25) + 6 + 3 = 62
    expect(r.tier).toBe('B');
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(r.score).toBeLessThan(70);
  });

  it('C tier when score ≥ 30 but < 50 (weak signals)', () => {
    const r = scoreLead(
      makeInput({
        hasWebsite: true,
        hasEmail: false,
        hasPhone: true,
        reviewCount: 3,
        reviewRating: 3.8,
        socialLinks: 1,
      }),
    );
    // 20 + 0 + 15 + 5+5 (=10) + 3 + 0 = 48
    expect(r.tier).toBe('C');
    expect(r.score).toBeGreaterThanOrEqual(30);
    expect(r.score).toBeLessThan(50);
  });

  it('D tier when score < 30 (nearly no signals)', () => {
    const r = scoreLead(makeInput({}));
    // 0 + 0 + 0 + 0 + 0 + 0 = 0
    expect(r.tier).toBe('D');
    expect(r.score).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------------------
// Individual signal components
// ---------------------------------------------------------------------------

describe('twenty_lead_scoring — components', () => {
  it('website contributes 20 when present', () => {
    const r = scoreLead(makeInput({ hasWebsite: true }));
    expect(r.components.website).toBe(20);
  });

  it('website contributes 0 when absent', () => {
    const r = scoreLead(makeInput({ hasWebsite: false }));
    expect(r.components.website).toBe(0);
  });

  it('email contributes 15 when present', () => {
    const r = scoreLead(makeInput({ hasEmail: true }));
    expect(r.components.email).toBe(15);
  });

  it('phone contributes 15 when present', () => {
    const r = scoreLead(makeInput({ hasPhone: true }));
    expect(r.components.phone).toBe(15);
  });

  it('reviews combines count (max 15) and rating (max 10) capped at 25', () => {
    const r = scoreLead(makeInput({ reviewCount: 50, reviewRating: 5.0 }));
    // count: 15, rating: 10
    expect(r.components.reviews).toBe(25);
  });

  it('social contributes 3 points per link capped at 15', () => {
    const r = scoreLead(makeInput({ socialLinks: 3 }));
    expect(r.components.social).toBe(9);

    const capped = scoreLead(makeInput({ socialLinks: 10 }));
    expect(capped.components.social).toBe(15);
  });

  it('employees uses range scaling', () => {
    expect(scoreLead(makeInput({ employees: 2 })).components.employees).toBe(3);
    expect(scoreLead(makeInput({ employees: 14 })).components.employees).toBe(5);
    expect(scoreLead(makeInput({ employees: 50 })).components.employees).toBe(8);
    expect(scoreLead(makeInput({ employees: 500 })).components.employees).toBe(10);
  });

  it('employees is 0 when undefined', () => {
    const r = scoreLead(makeInput({}));
    expect(r.components.employees).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('twenty_lead_scoring — edge cases', () => {
  it('handles zero values without errors', () => {
    const r = scoreLead(makeInput({}));
    expect(r.score).toBe(0);
    expect(r.tier).toBe('D');
  });

  it('handles negative review count as zero', () => {
    const r = scoreLead(makeInput({ reviewCount: -5, reviewRating: 0 }));
    expect(r.components.reviews).toBe(0);
  });

  it('clamps very large values to 100', () => {
    const r = scoreLead(
      makeInput({
        hasWebsite: true,
        hasEmail: true,
        hasPhone: true,
        reviewCount: 9999,
        reviewRating: 5.0,
        socialLinks: 999,
        employees: 9999,
      }),
    );
    // 20 + 15 + 15 + 25 + 15 + 10 = 100
    expect(r.score).toBe(100);
  });

  it('scores are integers', () => {
    const r = scoreLead(
      makeInput({
        hasWebsite: true,
        hasEmail: true,
        hasPhone: false,
        reviewCount: 10,
        reviewRating: 4.2,
        socialLinks: 2,
        employees: 3,
      }),
    );
    expect(Number.isInteger(r.score)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Snapshot-style deterministic
// ---------------------------------------------------------------------------

describe('twenty_lead_scoring — deterministic', () => {
  it('same input always produces same output', () => {
    const input: LeadInput = {
      hasWebsite: true,
      hasEmail: false,
      hasPhone: true,
      reviewCount: 20,
      reviewRating: 4.0,
      socialLinks: 4,
      employees: 30,
    };
    const a = scoreLead(input);
    const b = scoreLead(input);
    expect(a).toEqual(b);
  });

  it('provides a components map with all expected keys', () => {
    const r = scoreLead(makeInput({ hasWebsite: true, socialLinks: 2 }));
    expect(r.components).toHaveProperty('website');
    expect(r.components).toHaveProperty('email');
    expect(r.components).toHaveProperty('phone');
    expect(r.components).toHaveProperty('reviews');
    expect(r.components).toHaveProperty('social');
    expect(r.components).toHaveProperty('employees');
  });
});
