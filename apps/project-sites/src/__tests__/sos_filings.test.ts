/**
 * Unit tests for the Secretary-of-State new-filings provider. All pure — a fixed
 * nowMs is injected for deterministic age math (no Date.now()).
 */

import { describe, it, expect } from '@jest/globals';
import {
  monthsSince,
  isRecentlyIncorporated,
  parseSosRow,
  selectRecentSosLeads,
  type SosColumnMap,
} from '../services/sos_filings.js';

const NOW = Date.parse('2026-06-28T00:00:00Z');
const MAP: SosColumnMap = {
  name: 'BusinessName',
  filingDate: 'FilingDate',
  address: 'Address',
  filingId: 'EntityNumber',
};

describe('sos_filings — monthsSince', () => {
  it('computes whole months', () => {
    expect(monthsSince('2026-03-28', NOW)).toBe(3);
    expect(monthsSince('2025-06-28', NOW)).toBe(12);
  });
  it('future date clamps to 0; bad date → null', () => {
    expect(monthsSince('2027-01-01', NOW)).toBe(0);
    expect(monthsSince('not-a-date', NOW)).toBeNull();
    expect(monthsSince(null, NOW)).toBeNull();
  });
});

describe('sos_filings — isRecentlyIncorporated', () => {
  it('true within the window, false outside', () => {
    expect(isRecentlyIncorporated(3)).toBe(true);
    expect(isRecentlyIncorporated(6)).toBe(true);
    expect(isRecentlyIncorporated(7)).toBe(false);
    expect(isRecentlyIncorporated(null)).toBe(false);
    expect(isRecentlyIncorporated(12, 12)).toBe(true);
  });
});

describe('sos_filings — parseSosRow', () => {
  it('maps a row to a SosLead with age + external id', () => {
    const lead = parseSosRow(
      {
        BusinessName: 'Fresh Bakery LLC',
        FilingDate: '2026-05-01',
        Address: '5 Oak Ave, Columbus, OH',
        EntityNumber: '4567',
      },
      MAP,
      NOW,
      'OH',
    );
    expect(lead?.business.businessName).toBe('Fresh Bakery LLC');
    expect(lead?.business.address).toBe('5 Oak Ave, Columbus, OH');
    expect(lead?.business.externalId).toBe('sos_oh:4567');
    expect(lead?.incorporationAgeMonths).toBe(1);
  });
  it('returns null when the name is missing', () => {
    expect(parseSosRow({ BusinessName: '' }, MAP, NOW, 'OH')).toBeNull();
  });
});

describe('sos_filings — selectRecentSosLeads', () => {
  it('keeps only businesses within the recency window', () => {
    const rows = [
      { BusinessName: 'New Co', FilingDate: '2026-06-01', EntityNumber: '1' }, // <6mo
      { BusinessName: 'Old Co', FilingDate: '2024-01-01', EntityNumber: '2' }, // old
      { BusinessName: '', FilingDate: '2026-06-01', EntityNumber: '3' }, // no name
    ];
    const out = selectRecentSosLeads(rows, MAP, { nowMs: NOW, stateCode: 'OH' });
    expect(out).toHaveLength(1);
    expect(out[0].business.businessName).toBe('New Co');
  });
});
