/**
 * webhook_receiver — Plane webhook event classification unit tests.
 *
 * Tests the pure Zod validation layer: known events classify,
 * unknown events return null, missing/corrupt bodies return null,
 * and the PLANE_EVENT_TYPES list matches the schema union.
 */
import {
  classifyPlaneEvent,
  PLANE_EVENT_TYPES,
  PlaneWebhookEventSchema,
} from '../services/webhook_receiver.js';

// ── Fixture helpers ───────────────────────────────────────────────────

function makeIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    event: 'issue.created',
    payload: {
      issue: {
        id: 'issue-1',
        sequence_id: 42,
        name: 'Fix login button',
        description_html: '<p>The login button is misaligned</p>',
        priority: 'medium',
        state: 'state-abc',
        state_name: 'In Progress',
        created_at: '2026-01-15T10:00:00Z',
        updated_at: '2026-01-15T12:00:00Z',
      },
      project: { id: 'proj-1', identifier: 'PROJ', name: 'Website' },
      workspace: { name: 'My Workspace', slug: 'my-workspace' },
    },
    event_context: { workspace_slug: 'my-workspace', project_slug: 'proj-1', user: 'user-1' },
    timestamp: '2026-01-15T12:00:00Z',
    webhook_id: 'wh-001',
    ...overrides,
  };
}

function makeCyclePayload() {
  return {
    event: 'cycle.created',
    payload: {
      cycle: { id: 'cycle-1', name: 'Sprint 1', start_date: '2026-01-01', end_date: '2026-01-14' },
      project: { id: 'proj-1', identifier: 'PROJ', name: 'Website' },
      workspace: { name: 'My Workspace', slug: 'my-workspace' },
    },
    event_context: { workspace_slug: 'my-workspace', project_slug: 'proj-1', user: 'user-1' },
    timestamp: '2026-01-01T00:00:00Z',
    webhook_id: 'wh-002',
  };
}

function makeModulePayload() {
  return {
    event: 'module.created',
    payload: {
      module: { id: 'mod-1', name: 'Auth Rewrite', description: 'Replace legacy auth' },
      project: { id: 'proj-2', identifier: 'V2', name: 'Project V2' },
      workspace: { name: 'My Workspace', slug: 'my-workspace' },
    },
  };
}

function makeProjectPayload() {
  return {
    event: 'project.created',
    payload: {
      project: {
        id: 'proj-3',
        identifier: 'NEW',
        name: 'New Project',
        created_at: '2026-02-01T08:00:00Z',
        created_by: 'user-1',
      },
      workspace: { name: 'My Workspace', slug: 'my-workspace' },
    },
  };
}

function makeCommentPayload() {
  return {
    event: 'comment.created',
    payload: {
      comment: { id: 'cmt-1', comment_html: '<p>Good catch</p>', issue: 'issue-1' },
      issue: {
        id: 'issue-1',
        sequence_id: 42,
        name: 'Fix login button',
        state: 'state-abc',
      },
      project: { id: 'proj-1', identifier: 'PROJ', name: 'Website' },
      workspace: { name: 'My Workspace', slug: 'my-workspace' },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('classifyPlaneEvent', () => {
  describe('issue events', () => {
    it('classifies issue.created', () => {
      const result = classifyPlaneEvent(makeIssuePayload({ event: 'issue.created' }));
      expect(result).not.toBeNull();
      expect(result!.event).toBe('issue.created');
      if (result!.event === 'issue.created') {
        expect(result.payload.issue.name).toBe('Fix login button');
        expect(result.payload.project.identifier).toBe('PROJ');
      }
    });

    it('classifies issue.updated', () => {
      const result = classifyPlaneEvent(makeIssuePayload({ event: 'issue.updated' }));
      expect(result).not.toBeNull();
      expect(result!.event).toBe('issue.updated');
    });

    it('classifies issue.deleted', () => {
      const result = classifyPlaneEvent({
        event: 'issue.deleted',
        payload: {
          issue: { id: 'issue-42' },
          project: { id: 'proj-1', identifier: 'PROJ', name: 'Website' },
          workspace: { name: 'My Workspace', slug: 'my-workspace' },
        },
      });
      expect(result).not.toBeNull();
      expect(result!.event).toBe('issue.deleted');
    });
  });

  describe('cycle / module / project / comment events', () => {
    it('classifies cycle.created', () => {
      const result = classifyPlaneEvent(makeCyclePayload());
      expect(result).not.toBeNull();
      expect(result!.event).toBe('cycle.created');
      if (result!.event === 'cycle.created') {
        expect(result.payload.cycle.name).toBe('Sprint 1');
      }
    });

    it('classifies module.created', () => {
      const result = classifyPlaneEvent(makeModulePayload());
      expect(result).not.toBeNull();
      expect(result!.event).toBe('module.created');
      if (result!.event === 'module.created') {
        expect(result.payload.module.name).toBe('Auth Rewrite');
      }
    });

    it('classifies project.created', () => {
      const result = classifyPlaneEvent(makeProjectPayload());
      expect(result).not.toBeNull();
      expect(result!.event).toBe('project.created');
    });

    it('classifies comment.created', () => {
      const result = classifyPlaneEvent(makeCommentPayload());
      expect(result).not.toBeNull();
      expect(result!.event).toBe('comment.created');
    });
  });

  describe('edge cases — returns null', () => {
    it('returns null for unknown event type', () => {
      const result = classifyPlaneEvent({
        event: 'unknown.event',
        payload: {},
      });
      expect(result).toBeNull();
    });

    it('returns null for empty body', () => {
      expect(classifyPlaneEvent({})).toBeNull();
    });

    it('returns null when event field is missing', () => {
      expect(classifyPlaneEvent({ payload: {} })).toBeNull();
    });

    it('returns null when event is not a string', () => {
      expect(classifyPlaneEvent({ event: 42 })).toBeNull();
    });

    it('returns null for null input', () => {
      expect(classifyPlaneEvent(null as unknown as Record<string, unknown>)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(classifyPlaneEvent(undefined as unknown as Record<string, unknown>)).toBeNull();
    });

    it('returns null for malformed payload (missing required field)', () => {
      const result = classifyPlaneEvent({
        event: 'issue.created',
        payload: { workspace: { name: 'W', slug: 'w' } },
      });
      expect(result).toBeNull();
    });

    it('returns null for known event type with structurally wrong body', () => {
      // event type matches known list but payload fails the discrimated union schema
      const result = classifyPlaneEvent({
        event: 'issue.created',
        payload: 'not-an-object',
      });
      expect(result).toBeNull();
    });
  });

  describe('issue.deleted payload is sparse', () => {
    it('accepts minimal issue ref (id only)', () => {
      const result = classifyPlaneEvent({
        event: 'issue.deleted',
        payload: {
          issue: { id: 'issue-99' },
          project: { id: 'proj-1', identifier: 'PROJ', name: 'Website' },
          workspace: { name: 'W', slug: 'w' },
        },
      });
      expect(result).not.toBeNull();
      expect(result!.event).toBe('issue.deleted');
    });
  });

  describe('extra fields are tolerated (passthrough)', () => {
    it('preserves unknown fields on the envelope', () => {
      const result = classifyPlaneEvent({
        ...makeIssuePayload(),
        some_extra: 'hello',
      });
      expect(result).not.toBeNull();
    });

    it('preserves unknown fields in the event context', () => {
      const result = classifyPlaneEvent({
        ...makeIssuePayload(),
        event_context: {
          workspace_slug: 'w',
          project_slug: 'p',
          user: 'u',
          region: 'us-east',
        },
      });
      expect(result).not.toBeNull();
    });
  });
});

describe('PLANE_EVENT_TYPES', () => {
  it('is a frozen array of known event types', () => {
    expect(PLANE_EVENT_TYPES).toEqual([
      'issue.created',
      'issue.updated',
      'issue.deleted',
      'cycle.created',
      'module.created',
      'project.created',
      'comment.created',
    ]);
    expect(Object.isFrozen(PLANE_EVENT_TYPES)).toBe(true);
  });

  it('every event type is parseable by the union schema', () => {
    for (const evtType of PLANE_EVENT_TYPES) {
      // Build a minimal valid shape per event type
      const base = {
        payload: {
          project: { id: 'p', identifier: 'X', name: 'X' },
          workspace: { name: 'W', slug: 'w' },
        },
      };
      const body =
        evtType === 'issue.created' || evtType === 'issue.updated'
          ? {
              ...base,
              event: evtType,
              payload: {
                ...base.payload,
                issue: { id: 'i', sequence_id: 1, name: 'n', state: 's' },
              },
            }
          : evtType === 'issue.deleted'
            ? { event: evtType, payload: { ...base.payload, issue: { id: 'i' } } }
            : evtType === 'cycle.created'
              ? { event: evtType, payload: { ...base.payload, cycle: { id: 'c', name: 'C' } } }
              : evtType === 'module.created'
                ? { event: evtType, payload: { ...base.payload, module: { id: 'm', name: 'M' } } }
                : evtType === 'project.created'
                  ? {
                      event: evtType,
                      payload: {
                        ...base.payload,
                        project: { id: 'p-2', identifier: 'Y', name: 'Y' },
                      },
                    }
                  : {
                      event: evtType,
                      payload: {
                        ...base.payload,
                        comment: { id: 'c', comment_html: '<p>x</p>' },
                        issue: { id: 'i', sequence_id: 1, name: 'n', state: 's' },
                      },
                    };

      const parsed = PlaneWebhookEventSchema.safeParse(body);
      expect(parsed.success).toBe(true);
    }
  });
});
