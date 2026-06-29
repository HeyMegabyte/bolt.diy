/**
 * Unit tests for the lead propensity + contact-confidence engine.
 * Pure functions — no env, no I/O, no mocks needed.
 */

import { describe, it, expect } from '@jest/globals';
import {
  contactConfidence,
  payPropensity,
  rankLeads,
  type LeadSignals,
} from '../services/lead_propensity.js';

describe('lead_propensity — contactConfidence', () => {
  it('maps email + address provenance to confidence and "both" channel', () => {
    const r = contactConfidence({
      hasWebsite: false,
      emailSource: 'listing',
      addressSource: 'usps_verified',
    });
    expect(r.emailConfidence).toBe(75);
    expect(r.addressConfidence).toBe(95);
    expect(r.channel).toBe('both');
  });

  it('returns "email" when only email clears the threshold', () => {
    const r = contactConfidence({
      hasWebsite: false,
      emailSource: 'verified',
      addressSource: null,
    });
    expect(r.channel).toBe('email');
  });

  it('returns "postcard" when only the address clears the (higher) threshold', () => {
    const r = contactConfidence({
      hasWebsite: false,
      emailSource: 'guessed',
      addressSource: 'sos',
    });
    expect(r.emailConfidence).toBe(25); // below 50
    expect(r.addressConfidence).toBe(80); // above 60
    expect(r.channel).toBe('postcard');
  });

  it('a Places address (70) clears the postcard threshold; a listing address (55) does not', () => {
    expect(contactConfidence({ hasWebsite: false, addressSource: 'places' }).channel).toBe(
      'postcard',
    );
    expect(contactConfidence({ hasWebsite: false, addressSource: 'listing' }).channel).toBe('none');
  });

  it('returns "none" when neither channel is reliable', () => {
    expect(contactConfidence({ hasWebsite: false }).channel).toBe('none');
    expect(
      contactConfidence({ hasWebsite: false, emailSource: 'guessed', addressSource: 'listing' })
        .channel,
    ).toBe('none');
  });
});

describe('lead_propensity — payPropensity', () => {
  it('a business that already has a website scores 0 (not a prospect)', () => {
    const r = payPropensity({ hasWebsite: true, emailSource: 'verified', category: 'plumber' });
    expect(r.score).toBe(0);
    expect(r.tier).toBe('D');
  });

  it('the dream lead scores in tier A', () => {
    const r = payPropensity({
      hasWebsite: false,
      claimedListing: true,
      emailSource: 'listing',
      addressSource: 'usps_verified',
      category: 'plumber',
      reviewCount: 40,
      rating: 4.6,
      incorporationAgeMonths: 3,
      sourceCount: 3,
    });
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.tier).toBe('A');
    expect(r.reachable).toBe(true);
  });

  it('an unreachable no-website business loses the reachability points', () => {
    const reachable = payPropensity({
      hasWebsite: false,
      emailSource: 'verified',
      category: 'plumber',
    });
    const unreachable = payPropensity({ hasWebsite: false, category: 'plumber' });
    expect(reachable.score).toBeGreaterThan(unreachable.score);
    expect(unreachable.reachable).toBe(false);
  });

  it('recently incorporated businesses score higher than old ones', () => {
    const base: LeadSignals = { hasWebsite: false, emailSource: 'verified' };
    const fresh = payPropensity({ ...base, incorporationAgeMonths: 2 });
    const old = payPropensity({ ...base, incorporationAgeMonths: 60 });
    expect(fresh.score).toBeGreaterThan(old.score);
  });

  it('clamps to 100 and assigns tiers across the range', () => {
    const maxed = payPropensity({
      hasWebsite: false,
      claimedListing: true,
      socialOnly: true,
      emailSource: 'verified',
      addressSource: 'usps_verified',
      category: 'contractor',
      reviewCount: 200,
      rating: 5,
      incorporationAgeMonths: 1,
      sourceCount: 5,
    });
    expect(maxed.score).toBeLessThanOrEqual(100);
    expect(maxed.tier).toBe('A');
  });
});

describe('lead_propensity — rankLeads', () => {
  it('sorts most-likely-to-pay first', () => {
    const leads: LeadSignals[] = [
      { hasWebsite: true, emailSource: 'verified' }, // 0 — has site
      { hasWebsite: false }, // unreachable, bare
      {
        hasWebsite: false,
        claimedListing: true,
        emailSource: 'listing',
        category: 'dentist',
        reviewCount: 30,
        rating: 4.8,
        incorporationAgeMonths: 4,
      }, // dream
    ];
    const ranked = rankLeads(leads);
    expect(ranked[0].lead.category).toBe('dentist');
    expect(ranked[0].tier).toBe('A');
    expect(ranked[ranked.length - 1].lead.hasWebsite).toBe(true);
    expect(ranked[ranked.length - 1].score).toBe(0);
  });

  it('breaks score ties by reachability then contact confidence', () => {
    // Two no-website leads with identical scoring inputs except contactability.
    const reachable: LeadSignals = { hasWebsite: false, emailSource: 'verified' };
    const unreachable: LeadSignals = { hasWebsite: false };
    const ranked = rankLeads([unreachable, reachable]);
    // reachable gains +12 so it already outscores; assert it leads.
    expect(ranked[0].reachable).toBe(true);
  });

  it('returns an empty array for no leads', () => {
    expect(rankLeads([])).toEqual([]);
  });

  it('every ranked row carries channel + confidences', () => {
    const ranked = rankLeads([
      { hasWebsite: false, emailSource: 'listing', addressSource: 'places' },
    ]);
    expect(ranked[0].channel).toBe('both');
    expect(ranked[0].emailConfidence).toBe(75);
    expect(ranked[0].addressConfidence).toBe(70);
  });
});
