import {
  AUDIT_ACTIONS,
  isAuditAction,
  PII_KEYS,
  auditSummary,
  createAuditEntry,
  redactPii,
  type AuditAction,
  type AuditEntry,
} from '../services/audit_trail.js';

describe('audit_trail', () => {
  // -----------------------------------------------------------------------
  // AUDIT_ACTIONS
  // -----------------------------------------------------------------------
  describe('AUDIT_ACTIONS', () => {
    it('is readonly and frozen', () => {
      expect(Object.isFrozen(AUDIT_ACTIONS)).toBe(true);
    });

    it('contains no duplicates', () => {
      expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    });

    it('contains exactly 8 action types', () => {
      expect(AUDIT_ACTIONS).toHaveLength(8);
    });
  });

  // -----------------------------------------------------------------------
  // isAuditAction
  // -----------------------------------------------------------------------
  describe('isAuditAction', () => {
    it('returns true for every known action', () => {
      for (const a of AUDIT_ACTIONS) {
        expect(isAuditAction(a)).toBe(true);
      }
    });

    it('returns false for an unknown string', () => {
      expect(isAuditAction('nope')).toBe(false);
      expect(isAuditAction('')).toBe(false);
      expect(isAuditAction('user.register')).toBe(false);
    });

    it('rejects a structurally similar but misspelled action', () => {
      expect(isAuditAction('user.loout')).toBe(false);
      expect(isAuditAction('site.creat')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // PII_KEYS
  // -----------------------------------------------------------------------
  describe('PII_KEYS', () => {
    it('is readonly and frozen', () => {
      expect(Object.isFrozen(PII_KEYS)).toBe(true);
    });

    it('contains no duplicates', () => {
      expect(new Set(PII_KEYS).size).toBe(PII_KEYS.length);
    });

    it('each key is a non-empty string', () => {
      for (const k of PII_KEYS) {
        expect(typeof k).toBe('string');
        expect(k.length).toBeGreaterThan(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // createAuditEntry
  // -----------------------------------------------------------------------
  describe('createAuditEntry', () => {
    it('creates an AuditEntry with required fields', () => {
      const e = createAuditEntry('user.login', 'user_1', 'session', 'sess_1');

      expect(e.id).toBeDefined();
      expect(typeof e.id).toBe('string');
      expect(e.id.length).toBeGreaterThan(0);
      expect(e.action).toBe('user.login');
      expect(e.actorId).toBe('user_1');
      expect(e.targetType).toBe('session');
      expect(e.targetId).toBe('sess_1');
    });

    it('creates an AuditEntry with provided metadata', () => {
      const meta = { ip: '127.0.0.1', slug: 'my-site' };
      const e = createAuditEntry('site.create', 'user_2', 'site', 'site_abc', meta);

      expect(e.metadata).toEqual(meta);
      expect(e.metadata).not.toBe(meta); // a copy, not the same ref
    });

    it('defaults metadata to {} when omitted', () => {
      const e = createAuditEntry('domain.add', 'user_3', 'domain', 'dom_1');
      expect(e.metadata).toEqual({});
    });

    it('generates a unique id per call', () => {
      const e1 = createAuditEntry('flag.change', 'u1', 'flag', 'f1');
      const e2 = createAuditEntry('flag.change', 'u1', 'flag', 'f1');
      expect(e1.id).not.toBe(e2.id);
    });

    it('generates an ISO timestamp', () => {
      const e = createAuditEntry('billing.upgrade', 'u1', 'subscription', 'sub_1');
      expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(() => new Date(e.timestamp)).not.toThrow();
    });

    it('accepts explicit timestamp via the optional parameter', () => {
      const t1 = '2026-01-01T00:00:00.000Z';
      const t2 = '2026-06-01T00:00:00.000Z';
      const e1 = createAuditEntry('user.login', 'u1', 'session', 's1', {}, t1);
      const e2 = createAuditEntry('user.login', 'u1', 'session', 's1', {}, t2);
      expect(e1.timestamp).toBe(t1);
      expect(e2.timestamp).toBe(t2);
    });

    it('accepts all known AuditAction values', () => {
      const actions: AuditAction[] = [
        'user.login',
        'user.logout',
        'site.create',
        'site.delete',
        'billing.upgrade',
        'domain.add',
        'flag.change',
        'api.call',
      ];
      for (const a of actions) {
        const e = createAuditEntry(a, 'u1', 'test', 't1');
        expect(e.action).toBe(a);
      }
    });
  });

  // -----------------------------------------------------------------------
  // redactPii
  // -----------------------------------------------------------------------
  describe('redactPii', () => {
    it('redacts known PII keys', () => {
      const e = createAuditEntry('user.login', 'u1', 'session', 's1', {
        email: 'alice@example.com',
        phone: '+15551234567',
      });
      const r = redactPii(e);
      expect(r.metadata.email).toBe('[REDACTED]');
      expect(r.metadata.phone).toBe('[REDACTED]');
    });

    it('does not mutate the original entry', () => {
      const e = createAuditEntry('user.login', 'u1', 'session', 's1', {
        email: 'alice@example.com',
      });
      redactPii(e);
      expect(e.metadata.email).toBe('alice@example.com');
    });

    it('redacts string values matching email pattern in arbitrary keys', () => {
      const e = createAuditEntry('api.call', 'u1', 'api', 'req_1', {
        contact: 'alice@example.com',
      });
      const r = redactPii(e);
      expect(r.metadata.contact).toBe('[REDACTED]');
    });

    it('redacts string values matching phone pattern in arbitrary keys', () => {
      const e = createAuditEntry('site.create', 'u1', 'site', 's1', {
        callback: '+15551112222',
      });
      const r = redactPii(e);
      expect(r.metadata.callback).toBe('[REDACTED]');
    });

    it('redacts string values that look like tokens', () => {
      const e = createAuditEntry('api.call', 'u1', 'api', 'req_1', {
        auth: 'sk_test_abc123xyz456',
      });
      const r = redactPii(e);
      expect(r.metadata.auth).toBe('[REDACTED]');
    });

    it('redacts base64 JWT-like tokens', () => {
      const e = createAuditEntry('api.call', 'u1', 'api', 'req_1', {
        session: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYSJ9.signature',
      });
      const r = redactPii(e);
      expect(r.metadata.session).toBe('[REDACTED]');
    });

    it('preserves non-sensitive metadata values', () => {
      const e = createAuditEntry('site.create', 'u1', 'site', 's1', {
        slug: 'my-awesome-site',
        plan: 'pro',
        locale: 'en-US',
      });
      const r = redactPii(e);
      expect(r.metadata.slug).toBe('my-awesome-site');
      expect(r.metadata.plan).toBe('pro');
      expect(r.metadata.locale).toBe('en-US');
    });

    it('preserves numeric and boolean metadata values', () => {
      const e = createAuditEntry('api.call', 'u1', 'api', 'r1', {
        count: 42,
        active: true,
        ratio: 3.14,
      });
      const r = redactPii(e);
      expect(r.metadata.count).toBe(42);
      expect(r.metadata.active).toBe(true);
      expect(r.metadata.ratio).toBe(3.14);
    });

    it('preserves null metadata values', () => {
      const e = createAuditEntry('api.call', 'u1', 'api', 'r1', {
        optional: null,
      });
      const r = redactPii(e);
      expect(r.metadata.optional).toBeNull();
    });

    it('returns the same entry reference when nothing changed', () => {
      const e = createAuditEntry('user.logout', 'u1', 'session', 's1', {
        ip: '127.0.0.1',
        user_agent: 'Mozilla/5.0',
      });
      const r = redactPii(e);
      expect(r).toBe(e); // same reference — no copy was made
    });

    it('handles empty metadata', () => {
      const e = createAuditEntry('site.delete', 'u1', 'site', 's1');
      const r = redactPii(e);
      expect(r.metadata).toEqual({});
      expect(r).toBe(e); // same reference
    });
  });

  // -----------------------------------------------------------------------
  // auditSummary
  // -----------------------------------------------------------------------
  describe('auditSummary', () => {
    it('returns total of 0 for an empty list', () => {
      const s = auditSummary([]);
      expect(s.total).toBe(0);
      expect(s.byAction).toEqual({});
      expect(s.byActor).toEqual({});
    });

    it('counts actions and actors for a single entry', () => {
      const e = createAuditEntry('user.login', 'alice', 'session', 's1');
      const s = auditSummary([e]);
      expect(s.total).toBe(1);
      expect(s.byAction).toEqual({ 'user.login': 1 });
      expect(s.byActor).toEqual({ alice: 1 });
    });

    it('aggregates multiple entries by action and actor', () => {
      const entries = [
        createAuditEntry('user.login', 'alice', 'session', 's1'),
        createAuditEntry('user.login', 'bob', 'session', 's2'),
        createAuditEntry('site.create', 'alice', 'site', 'sa'),
        createAuditEntry('billing.upgrade', 'bob', 'subscription', 'sub_1'),
        createAuditEntry('user.logout', 'alice', 'session', 's1'),
      ];
      const s = auditSummary(entries);
      expect(s.total).toBe(5);
      expect(s.byAction).toEqual({
        'user.login': 2,
        'site.create': 1,
        'billing.upgrade': 1,
        'user.logout': 1,
      });
      expect(s.byActor).toEqual({ alice: 3, bob: 2 });
    });

    it('works with a large entry set', () => {
      const entries = Array.from({ length: 100 }, (_, i) =>
        createAuditEntry(
          i % 2 === 0 ? 'api.call' : 'flag.change',
          i < 50 ? 'alice' : 'bob',
          'test',
          `t${i}`,
        ),
      );
      const s = auditSummary(entries);
      expect(s.total).toBe(100);
      expect(s.byAction['api.call']).toBe(50);
      expect(s.byAction['flag.change']).toBe(50);
      expect(s.byActor.alice).toBe(50);
      expect(s.byActor.bob).toBe(50);
    });

    it('handles entries sharing the same action and actor', () => {
      const entries = [
        createAuditEntry('api.call', 'system', 'api', 'r1'),
        createAuditEntry('api.call', 'system', 'api', 'r2'),
        createAuditEntry('api.call', 'system', 'api', 'r3'),
      ];
      const s = auditSummary(entries);
      expect(s.total).toBe(3);
      expect(s.byAction).toEqual({ 'api.call': 3 });
      expect(s.byActor).toEqual({ system: 3 });
    });

    it('handles a 1-element array correctly', () => {
      const e = createAuditEntry('domain.add', 'u1', 'domain', 'd1');
      const s = auditSummary([e]);
      expect(s.total).toBe(1);
      expect(s.byAction).toEqual({ 'domain.add': 1 });
      expect(s.byActor).toEqual({ u1: 1 });
    });
  });
});
