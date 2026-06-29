import {
  checkQuotaStatus,
  buildQuotaAlert,
  QUOTA_THRESHOLDS,
  type QuotaStatusResult,
  type QuotaAlertPayload,
} from '../services/quota_alert.js';

describe('checkQuotaStatus (AP10 quota_alert)', () => {
  it('returns ok when below warning threshold', () => {
    const r = checkQuotaStatus(50, 100);
    expect(r.status).toBe('ok');
    expect(r.pctUsed).toBe(50);
    expect(r.message).toContain('healthy');
  });

  it('returns warning exactly at 75%', () => {
    const r = checkQuotaStatus(75, 100);
    expect(r.status).toBe('warning');
    expect(r.pctUsed).toBe(75);
    expect(r.message).toContain('warning');
  });

  it('returns warning between 75% and 90%', () => {
    const r = checkQuotaStatus(80, 100);
    expect(r.status).toBe('warning');
    expect(r.pctUsed).toBe(80);
  });

  it('returns critical exactly at 90%', () => {
    const r = checkQuotaStatus(90, 100);
    expect(r.status).toBe('critical');
    expect(r.pctUsed).toBe(90);
    expect(r.message).toContain('critical');
  });

  it('returns critical between 90% and 100%', () => {
    const r = checkQuotaStatus(95, 100);
    expect(r.status).toBe('critical');
    expect(r.pctUsed).toBe(95);
  });

  it('returns exceeded exactly at 100%', () => {
    const r = checkQuotaStatus(100, 100);
    expect(r.status).toBe('exceeded');
    expect(r.pctUsed).toBe(100);
    expect(r.message).toContain('exceeded');
  });

  it('returns exceeded above 100%', () => {
    const r = checkQuotaStatus(150, 100);
    expect(r.status).toBe('exceeded');
    expect(r.pctUsed).toBe(150);
  });

  it('returns ok with 0% for zero limit (unlimited)', () => {
    const r = checkQuotaStatus(999, 0);
    expect(r.status).toBe('ok');
    expect(r.pctUsed).toBe(0);
    expect(r.message).toContain('no limit');
  });

  it('handles negative limit gracefully', () => {
    const r = checkQuotaStatus(50, -10);
    expect(r.status).toBe('ok');
    expect(r.pctUsed).toBe(0);
  });

  it('clamps negative used to 0', () => {
    const r = checkQuotaStatus(-20, 100);
    expect(r.pctUsed).toBe(0);
    expect(r.status).toBe('ok');
  });

  it('handles exactly 0 used and 0 limit', () => {
    const r = checkQuotaStatus(0, 0);
    expect(r.status).toBe('ok');
    expect(r.pctUsed).toBe(0);
  });

  it('pctUsed is always an integer', () => {
    const r = checkQuotaStatus(1, 3);
    expect(r.pctUsed).toBe(33);
    expect(Number.isInteger(r.pctUsed)).toBe(true);
  });
});

describe('QUOTA_THRESHOLDS (AP10 quota_alert)', () => {
  it('has warning=75, critical=90, exceeded=100', () => {
    expect(QUOTA_THRESHOLDS).toEqual({ warning: 75, critical: 90, exceeded: 100 });
  });
});

describe('buildQuotaAlert (AP10 quota_alert)', () => {
  it('returns shouldSend=false when quota is ok', () => {
    const p = buildQuotaAlert('API calls', 50, 100, 'ops@example.com');
    expect(p.shouldSend).toBe(false);
    expect(p.subject).toBe('');
    expect(p.body).toBe('');
  });

  it('returns shouldSend=true when quota is warning', () => {
    const p = buildQuotaAlert('Storage', 80, 100, 'dev@example.com');
    expect(p.shouldSend).toBe(true);
    expect(p.subject).toContain('Storage');
    expect(p.body).toContain('WARNING');
    expect(p.body).toContain('dev@example.com');
    expect(p.body).toContain('80%');
  });

  it('returns shouldSend=true when quota is critical', () => {
    const p = buildQuotaAlert('Build minutes', 95, 100, 'admin@example.com');
    expect(p.shouldSend).toBe(true);
    expect(p.subject).toContain('Build minutes');
    expect(p.body).toContain('CRITICAL');
    expect(p.body).toContain('95%');
  });

  it('returns shouldSend=true when quota is exceeded', () => {
    const p = buildQuotaAlert('Requests', 200, 100, 'billing@example.com');
    expect(p.shouldSend).toBe(true);
    expect(p.subject).toContain('Requests');
    expect(p.body).toContain('EXCEEDED');
    expect(p.body).toContain('200%');
  });

  it('uses "Resource" as fallback label for empty type', () => {
    const p = buildQuotaAlert('', 90, 100, 'x@example.com');
    expect(p.subject).toContain('Resource');
    expect(p.shouldSend).toBe(true);
  });

  it('shows clamped values in the body when negative inputs supplied', () => {
    const p = buildQuotaAlert('Disk', -10, 100, 'it@example.com');
    // Negative used is clamped to 0, so pctUsed = 0% → ok → shouldSend=false
    expect(p.shouldSend).toBe(false);
  });

  it('includes quota threshold summary in the body for alerts', () => {
    const p = buildQuotaAlert('BW', 80, 100, 'net@example.com');
    expect(p.body).toMatch(/80%/);
    expect(p.body).toMatch(/80\/100/);
    expect(p.body).toMatch(/WARNING/);
  });
});
