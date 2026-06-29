import {
  buildNotification,
  notificationTier,
  type QuotaNotification,
  THRESHOLD_CRITICAL,
  THRESHOLD_EXHAUSTED,
  THRESHOLD_WARN,
} from '../quota_notification';

describe('notificationTier', () => {
  it('returns null below 80%', () => {
    expect(notificationTier(0)).toBeNull();
    expect(notificationTier(50)).toBeNull();
    expect(notificationTier(79)).toBeNull();
  });

  it('returns 80 when >= 80 and < 90', () => {
    expect(notificationTier(80)).toBe(THRESHOLD_WARN);
    expect(notificationTier(85)).toBe(THRESHOLD_WARN);
    expect(notificationTier(89)).toBe(THRESHOLD_WARN);
  });

  it('returns 90 when >= 90 and < 100', () => {
    expect(notificationTier(90)).toBe(THRESHOLD_CRITICAL);
    expect(notificationTier(95)).toBe(THRESHOLD_CRITICAL);
    expect(notificationTier(99)).toBe(THRESHOLD_CRITICAL);
  });

  it('returns 100 when >= 100', () => {
    expect(notificationTier(100)).toBe(THRESHOLD_EXHAUSTED);
    expect(notificationTier(200)).toBe(THRESHOLD_EXHAUSTED);
  });

  it('clamps negative pctUsed to 0', () => {
    expect(notificationTier(-1)).toBeNull();
    expect(notificationTier(-100)).toBeNull();
  });
});

describe('buildNotification', () => {
  it('returns null when pctUsed is below 80%', () => {
    const result = buildNotification('API calls', 50, 100, 'admin@example.com');
    expect(result).toBeNull();
  });

  it('returns null when limit is 0 or negative', () => {
    expect(buildNotification('x', 50, 0, 'a@b.com')).toBeNull();
    expect(buildNotification('x', 50, -1, 'a@b.com')).toBeNull();
  });

  it('builds a warn notification at exactly 80%', () => {
    const result = buildNotification('API calls', 80, 100, 'admin@example.com');
    assertNotification(result, {
      email: 'admin@example.com',
      limit: 100,
      pctUsed: 80,
      threshold: 80,
      type: 'API calls',
      used: 80,
    });
  });

  it('builds a critical notification at exactly 90%', () => {
    const result = buildNotification('Storage', 90, 100, 'ops@example.com');
    assertNotification(result, {
      email: 'ops@example.com',
      limit: 100,
      pctUsed: 90,
      threshold: 90,
      type: 'Storage',
      used: 90,
    });
  });

  it('builds an exhausted notification at exactly 100%', () => {
    const result = buildNotification('Seats', 100, 100, 'billing@example.com');
    assertNotification(result, {
      email: 'billing@example.com',
      limit: 100,
      pctUsed: 100,
      threshold: 100,
      type: 'Seats',
      used: 100,
    });
  });

  it('picks the highest threshold when multiple are crossed', () => {
    const result = buildNotification('API calls', 95, 100, 'admin@example.com');
    assertNotification(result, {
      pctUsed: 95,
      threshold: 90,
    });
  });

  it('includes a non-empty subject', () => {
    const result = buildNotification('API calls', 85, 100, 'a@b.com');
    expect(result!.subject.length).toBeGreaterThan(0);
  });

  it('includes a non-empty body', () => {
    const result = buildNotification('API calls', 85, 100, 'a@b.com');
    expect(result!.body.length).toBeGreaterThan(0);
  });

  it('subject warns at 80% threshold', () => {
    const result = buildNotification('API calls', 80, 100, 'a@b.com');
    expect(result!.subject).toContain('80%');
  });

  it('subject warns at 90% threshold', () => {
    const result = buildNotification('API calls', 90, 100, 'a@b.com');
    expect(result!.subject).toContain('90%');
  });

  it('subject says "at capacity" when exhausted', () => {
    const result = buildNotification('API calls', 100, 100, 'a@b.com');
    expect(result!.subject).toContain('at capacity');
  });

  it('body includes used and limit', () => {
    const result = buildNotification('API calls', 85, 100, 'a@b.com');
    expect(result!.body).toContain('85');
    expect(result!.body).toContain('100');
  });
});

/** Thin helper that narrows the type and checks common fields. */
function assertNotification(
  n: QuotaNotification | null,
  expected: Partial<QuotaNotification>,
): asserts n is QuotaNotification {
  expect(n).not.toBeNull();
  for (const [k, v] of Object.entries(expected)) {
    expect((n as QuotaNotification)[k as keyof QuotaNotification]).toEqual(v);
  }
}
