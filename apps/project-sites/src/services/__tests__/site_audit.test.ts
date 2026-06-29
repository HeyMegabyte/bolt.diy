import {
  AUDIT_ACTIONS,
  isAuditAction,
  recordAudit,
  auditHistory,
  type AuditAction,
  type AuditEvent,
} from '../site_audit';

const ALL_ACTIONS: readonly AuditAction[] = [
  'site.created',
  'site.published',
  'site.archived',
  'site.deleted',
  'page.published',
  'page.unpublished',
  'domain.added',
  'domain.removed',
  'domain.verified',
  'billing.plan_changed',
  'billing.payment_failed',
  'billing.cancelled',
  'team.member_added',
  'team.member_removed',
  'team.role_changed',
  'build.started',
  'build.completed',
  'build.failed',
];

describe('AUDIT_ACTIONS', () => {
  it('defines all 18 actions', () => {
    expect(AUDIT_ACTIONS).toHaveLength(18);
  });

  it('contains every expected action', () => {
    for (const action of ALL_ACTIONS) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });

  it('Object.freeze prevents mutation', () => {
    expect(Object.isFrozen(AUDIT_ACTIONS)).toBe(true);
  });
});

describe('isAuditAction', () => {
  it.each(ALL_ACTIONS.map((a): [AuditAction] => [a]))('returns true for %s', (action) => {
    expect(isAuditAction(action)).toBe(true);
  });

  it('returns false for an unknown string', () => {
    expect(isAuditAction('bogus.event')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAuditAction('')).toBe(false);
  });
});

describe('recordAudit', () => {
  it('creates an AuditEvent with the given siteId, action, and userId', () => {
    const ev = recordAudit('site_001', 'site.published', 'user_abc');
    expect(ev.siteId).toBe('site_001');
    expect(ev.action).toBe('site.published');
    expect(ev.userId).toBe('user_abc');
  });

  it('generates a unique id for each event', () => {
    const a = recordAudit('s1', 'site.created', 'u1');
    const b = recordAudit('s1', 'site.created', 'u1');
    expect(a.id).not.toBe(b.id);
  });

  it('sets timestamp to now when omitted', () => {
    const before = new Date().toISOString();
    const ev = recordAudit('s1', 'build.started', 'u1');
    const after = new Date().toISOString();
    expect(ev.timestamp >= before).toBe(true);
    expect(ev.timestamp <= after).toBe(true);
  });

  it('uses the provided timestamp when given', () => {
    const ts = '2026-06-01T12:00:00.000Z';
    const ev = recordAudit('s1', 'build.completed', 'u1', ts);
    expect(ev.timestamp).toBe(ts);
  });

  it('returns a valid AuditEvent shape', () => {
    const ev = recordAudit('s1', 'site.created', 'u1');
    expect(ev).toMatchObject<AuditEvent>({
      id: expect.any(String) as string,
      siteId: 's1',
      action: 'site.created',
      userId: 'u1',
      timestamp: expect.any(String) as string,
    });
  });
});

describe('auditHistory', () => {
  const s1_created: AuditEvent = {
    id: crypto.randomUUID(),
    siteId: 's1',
    action: 'site.created',
    userId: 'u1',
    timestamp: '2026-01-01T00:00:00.000Z',
  };
  const s1_published: AuditEvent = {
    id: crypto.randomUUID(),
    siteId: 's1',
    action: 'site.published',
    userId: 'u1',
    timestamp: '2026-01-02T00:00:00.000Z',
  };
  const s2_created: AuditEvent = {
    id: crypto.randomUUID(),
    siteId: 's2',
    action: 'site.created',
    userId: 'u2',
    timestamp: '2026-01-03T00:00:00.000Z',
  };

  const all = [s1_created, s1_published, s2_created] as const;

  it('returns only events matching the given siteId', () => {
    const result = auditHistory(all, 's1');
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(s1_created);
    expect(result).toContainEqual(s1_published);
    expect(result).not.toContainEqual(s2_created);
  });

  it('returns an empty array when no events match', () => {
    expect(auditHistory(all, 'nonexistent')).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    expect(auditHistory([], 's1')).toEqual([]);
  });

  it('returns a new array (not the original reference)', () => {
    const copy = [...all];
    const result = auditHistory(all, 's1');
    expect(result).not.toBe(copy);
    // mutating the result must not affect the original
    result.pop();
    expect(all).toHaveLength(3);
  });

  it('works with a single matching event', () => {
    const result = auditHistory(all, 's2');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(s2_created);
  });
});

describe('TypeScript type coverage', () => {
  it('AuditAction is assignable from all known strings', () => {
    const a: AuditAction = 'site.created';
    expect(a).toBe('site.created');
  });

  it('AuditEvent shape is complete', () => {
    const ev: AuditEvent = {
      id: 'x',
      siteId: 'y',
      action: 'page.published',
      userId: 'z',
      timestamp: '2026-06-01T00:00:00.000Z',
    };
    expect(ev.action).toBe('page.published');
  });

  it('AUDIT_ACTIONS satisfies readonly AuditAction[]', () => {
    const check: readonly AuditAction[] = AUDIT_ACTIONS;
    expect(check.length).toBeGreaterThan(0);
  });

  it('recordAudit returns AuditEvent', () => {
    const result: AuditEvent = recordAudit('s', 'build.failed', 'u');
    expect(result.id).toBeDefined();
  });

  it('auditHistory accepts readonly AuditEvent[]', () => {
    const result: AuditEvent[] = auditHistory(
      Object.freeze([
        {
          id: 'x',
          siteId: 'y',
          action: 'site.created',
          userId: 'z',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ]),
      'y',
    );
    expect(result).toHaveLength(1);
  });
});
