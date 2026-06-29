/**
 * @module __tests__/audit_alert
 * @description Unit tests for the audit_alert service module.
 *
 * Covers:
 * - createAlert: id format, defaults, timestamp freshness
 * - acknowledge: non-mutation, flag toggle
 * - filterAlerts: severity rank, acknowledged filter, no-op when omitting opts
 * - ALERT_THRESHOLDS: known patterns, unknown patterns
 */

import {
  createAlert,
  acknowledge,
  filterAlerts,
  ALERT_THRESHOLDS,
} from '../services/audit_alert.js';
import type { AuditAlert, AlertSeverity } from '../services/audit_alert.js';

// ── Helpers ─────────────────────────────────────────────────────────

/** Quick UUID-like regex check (8-4-4-4-12 hex). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeAlert(overrides: Partial<AuditAlert> = {}): AuditAlert {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    severity: 'info',
    action: 'flag.feature_x.enabled',
    message: 'Feature X enabled',
    actorId: 'user_abc',
    timestamp: '2026-06-29T12:00:00.000Z',
    acknowledged: false,
    ...overrides,
  };
}

// ── UUIDv7 version-nibble helpers ────────────────────────────────────

function versionNibble(uuid: string): number {
  return parseInt(uuid[14]!, 16);
}

function variantNibble(uuid: string): number {
  return parseInt(uuid[19]!, 16);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('createAlert', () => {
  it('returns an AuditAlert with all required fields', () => {
    const alert = createAlert('critical', 'site.delete', 'Site "acme" deleted', 'user_1');

    expect(alert).toMatchObject({
      severity: 'critical',
      action: 'site.delete',
      message: 'Site "acme" deleted',
      actorId: 'user_1',
      acknowledged: false,
    });
  });

  it('generates a UUIDv7 id with version 7 nibble', () => {
    const alert = createAlert('info', 'flag.test', 'Test', 'sys');
    expect(alert.id).toMatch(UUID_RE);
    expect(versionNibble(alert.id)).toBe(7);
    expect(variantNibble(alert.id)).toBeGreaterThanOrEqual(8);
    expect(variantNibble(alert.id)).toBeLessThanOrEqual(11);
  });

  it('sets acknowledged to false', () => {
    const alert = createAlert('warning', 'domain.expiry', 'Expiring soon', 'sys');
    expect(alert.acknowledged).toBe(false);
  });

  it('sets timestamp to an ISO-8601 string', () => {
    const alert = createAlert('info', 'flag.x', 'X', 'u1');
    expect(() => new Date(alert.timestamp)).not.toThrow();
    expect(alert.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('id is unique on successive calls', () => {
    const a1 = createAlert('info', 'a', 'A', 'u1');
    const a2 = createAlert('info', 'b', 'B', 'u2');
    expect(a1.id).not.toBe(a2.id);
  });
});

describe('acknowledge', () => {
  it('returns a new object with acknowledged=true', () => {
    const alert = makeAlert({ acknowledged: false });
    const acked = acknowledge(alert);

    expect(acked.acknowledged).toBe(true);
    expect(alert.acknowledged).toBe(false); // original unchanged
    expect(acked).not.toBe(alert); // new reference
  });

  it('preserves all other fields', () => {
    const alert = makeAlert({
      id: 'abc',
      severity: 'critical',
      action: 'site.delete',
      message: 'Deleted',
      actorId: 'user_x',
      timestamp: '2026-06-01T00:00:00.000Z',
    });

    const acked = acknowledge(alert);
    expect(acked).toMatchObject({
      id: 'abc',
      severity: 'critical',
      action: 'site.delete',
      message: 'Deleted',
      actorId: 'user_x',
      timestamp: '2026-06-01T00:00:00.000Z',
      acknowledged: true,
    });
  });

  it('idempotent — calling twice still returns acknowledged=true', () => {
    const alert = makeAlert();
    const acked1 = acknowledge(alert);
    const acked2 = acknowledge(acked1);
    expect(acked2.acknowledged).toBe(true);
  });
});

describe('filterAlerts', () => {
  const info1 = makeAlert({ id: 'i1', severity: 'info', action: 'flag.a' });
  const info2 = makeAlert({ id: 'i2', severity: 'info', action: 'flag.b' });
  const warn = makeAlert({ id: 'w1', severity: 'warning', action: 'domain.expiry' });
  const crit = makeAlert({ id: 'c1', severity: 'critical', action: 'billing.failure' });

  const all = [info1, info2, warn, crit];

  it('returns all alerts when no filters provided', () => {
    const result = filterAlerts(all, {});
    expect(result).toEqual(all);
    expect(result).not.toBe(all); // new reference
  });

  describe('minSeverity', () => {
    it('minSeverity=info includes everything', () => {
      expect(filterAlerts(all, { minSeverity: 'info' })).toEqual(all);
    });

    it('minSeverity=warning excludes info', () => {
      const result = filterAlerts(all, { minSeverity: 'warning' });
      expect(result).toEqual([warn, crit]);
    });

    it('minSeverity=critical includes only critical', () => {
      const result = filterAlerts(all, { minSeverity: 'critical' });
      expect(result).toEqual([crit]);
    });

    it('returns empty when nothing meets minSeverity', () => {
      const onlyInfo = [info1, info2];
      expect(filterAlerts(onlyInfo, { minSeverity: 'critical' })).toEqual([]);
    });
  });

  describe('acknowledged', () => {
    it('acknowledged=true returns only acknowledged alerts', () => {
      const ackedWarn = acknowledge(warn);
      const alerts = [info1, ackedWarn, crit];
      const result = filterAlerts(alerts, { acknowledged: true });
      expect(result).toEqual([ackedWarn]);
    });

    it('acknowledged=false returns only unacknowledged alerts', () => {
      const ackedWarn = acknowledge(warn);
      const alerts = [info1, ackedWarn, crit];
      const result = filterAlerts(alerts, { acknowledged: false });
      expect(result).toEqual([info1, crit]);
    });
  });

  describe('combined filters', () => {
    it('filters by both minSeverity and acknowledged', () => {
      const ackedCrit = acknowledge(crit);
      const unackedWarn = warn;
      const alerts = [info1, unackedWarn, ackedCrit];

      const result = filterAlerts(alerts, {
        minSeverity: 'warning',
        acknowledged: false,
      });
      expect(result).toEqual([unackedWarn]);
    });

    it('returns empty when combined filters exclude everything', () => {
      const ackedInfo = acknowledge(info1);
      expect(filterAlerts([ackedInfo], { minSeverity: 'critical', acknowledged: false })).toEqual(
        [],
      );
    });
  });

  it('does not mutate the original array', () => {
    const snapshot = [...all];
    filterAlerts(all, { minSeverity: 'critical' });
    expect(all).toEqual(snapshot);
  });

  it('accepts readonly arrays', () => {
    const frozen: readonly AuditAlert[] = Object.freeze([...all]);
    const result = filterAlerts(frozen, {});
    expect(result).toEqual(all);
  });
});

describe('ALERT_THRESHOLDS', () => {
  it('maps billing patterns to critical', () => {
    expect(ALERT_THRESHOLDS['billing.*']).toBe('critical');
  });

  it('maps site.delete to critical', () => {
    expect(ALERT_THRESHOLDS['site.delete']).toBe('critical');
  });

  it('maps domain patterns to warning', () => {
    expect(ALERT_THRESHOLDS['domain.*']).toBe('warning');
  });

  it('maps flag patterns to info', () => {
    expect(ALERT_THRESHOLDS['flag.*']).toBe('info');
  });

  it('does not contain an entry for an unknown action', () => {
    expect(ALERT_THRESHOLDS['unknown.action']).toBeUndefined();
  });

  it('contains exactly 4 entries', () => {
    expect(Object.keys(ALERT_THRESHOLDS).length).toBe(4);
  });
});
