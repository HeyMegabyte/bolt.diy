import {
  alarmState,
  checkAlarm,
  escalateAlarm,
  LATENCY_OK_MS,
  LATENCY_WARN_MS,
  type AlarmResult,
} from '../health_alarm';

describe('checkAlarm', () => {
  it('returns ok for a fast healthy service', () => {
    const r = checkAlarm('api', 'ok', 45);
    expect(r).toEqual({ service: 'api', status: 'ok', latencyMs: 45 });
  });

  it('returns warn when the probe status is warn', () => {
    const r = checkAlarm('db', 'warn', 120);
    expect(r).toEqual({ service: 'db', status: 'warn', latencyMs: 120 });
  });

  it('returns error when the probe status is error', () => {
    const r = checkAlarm('redis', 'error', 0);
    expect(r).toEqual({ service: 'redis', status: 'error', latencyMs: 0 });
  });

  it('upgrades ok to warn when latency exceeds LATENCY_WARN_MS', () => {
    const r = checkAlarm('slow-service', 'ok', LATENCY_WARN_MS + 100);
    expect(r.status).toBe('warn');
    expect(r.latencyMs).toBe(LATENCY_WARN_MS + 100);
  });

  it('keeps ok when latency is within LATENCY_WARN_MS', () => {
    const r = checkAlarm('fast-service', 'ok', LATENCY_OK_MS);
    expect(r.status).toBe('ok');
  });

  it('does not downgrade error to warn when latency is fast', () => {
    const r = checkAlarm('failing-fast', 'error', 1);
    expect(r.status).toBe('error');
  });

  it('clamps negative latency to zero', () => {
    const r = checkAlarm('api', 'ok', -50);
    expect(r.latencyMs).toBe(0);
    expect(r.status).toBe('ok');
  });
});

describe('alarmState', () => {
  const ok = (service = 'a'): AlarmResult => ({ service, status: 'ok', latencyMs: 10 });
  const warn = (service = 'b'): AlarmResult => ({ service, status: 'warn', latencyMs: 1500 });
  const err = (service = 'c'): AlarmResult => ({ service, status: 'error', latencyMs: 0 });

  it('returns healthy when all checks are ok', () => {
    expect(alarmState([ok(), ok('other')])).toBe('healthy');
  });

  it('returns degraded when at least one check is warn and none are error', () => {
    expect(alarmState([ok(), warn()])).toBe('degraded');
  });

  it('returns degraded when all checks are warn', () => {
    expect(alarmState([warn('x'), warn('y')])).toBe('degraded');
  });

  it('returns down when at least one check is error', () => {
    expect(alarmState([ok(), err()])).toBe('down');
  });

  it('returns down even when errors and warns mix', () => {
    expect(alarmState([ok(), warn(), err()])).toBe('down');
  });

  it('returns down when all checks are error', () => {
    expect(alarmState([err('x'), err('y')])).toBe('down');
  });

  it('throws RangeError for an empty array', () => {
    expect(() => alarmState([])).toThrow(RangeError);
  });
});

describe('escalateAlarm', () => {
  it('returns non-notifying healthy plan', () => {
    const plan = escalateAlarm('healthy');
    expect(plan).toEqual({
      shouldNotify: false,
      severity: 'none',
      summary: 'All services healthy',
    });
  });

  it('returns warning plan for degraded', () => {
    const plan = escalateAlarm('degraded');
    expect(plan).toEqual({
      shouldNotify: true,
      severity: 'warning',
      summary: 'One or more services are degraded',
    });
  });

  it('returns critical plan for down', () => {
    const plan = escalateAlarm('down');
    expect(plan).toEqual({
      shouldNotify: true,
      severity: 'critical',
      summary: 'One or more services are down',
    });
  });
});
