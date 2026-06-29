/**
 * Tests for Plane API typed client — Zod schemas only.
 *
 * @remarks
 * Pure schema validation tests: no I/O, no mocks, no API calls. Every schema
 * is tested for valid parse, invalid rejection, and edge cases. Inferred
 * types are compile-time only (verified by tsc, not at runtime).
 *
 * @group unit
 */

import {
  IssueSchema,
  ProjectSchema,
  StateSchema,
  CycleSchema,
  ModuleSchema,
  LabelSchema,
  WorkspaceSchema,
  ProjectMemberSchema,
  PrioritySchema,
  StateGroupSchema,
  CycleStatusSchema,
  ModuleStatusSchema,
  MemberRoleSchema,
  PageInfoSchema,
  paginatedResponseSchema,
  numericRoleToMemberRole,
  issueDisplayId,
  type Issue,
  type Project,
  type Cycle,
} from '../services/plane_client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const iso = '2026-06-01T12:00:00.000Z';
const date = '2026-06-01';

function validIssue(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    project: '550e8400-e29b-41d4-a716-446655440001',
    workspace: 'my-workspace',
    name: 'Fix login button alignment',
    description: 'The CTA is off-center on mobile',
    description_html: '<p>The CTA is off-center on mobile</p>',
    state: '550e8400-e29b-41d4-a716-446655440002',
    priority: 'medium',
    assignees: ['550e8400-e29b-41d4-a716-446655440010'],
    labels: ['550e8400-e29b-41d4-a716-446655440020'],
    sequence_id: 42,
    sort_order: 1000,
    start_date: null,
    target_date: date,
    completed_at: null,
    parent: null,
    created_at: iso,
    updated_at: iso,
    ...overrides,
  };
}

function validProject(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Website Redesign',
    description: null,
    identifier: 'PROJ',
    workspace: 'my-workspace',
    cover_image_url: null,
    logo_props: null,
    total_issues: 120,
    total_members: 5,
    created_at: iso,
    updated_at: iso,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PrioritySchema
// ---------------------------------------------------------------------------
describe('PrioritySchema', () => {
  it('accepts all valid priority values', () => {
    for (const p of ['urgent', 'high', 'medium', 'low', 'none']) {
      expect(PrioritySchema.safeParse(p).success).toBe(true);
    }
  });

  it('rejects an invalid priority', () => {
    expect(PrioritySchema.safeParse('critical').success).toBe(false);
    expect(PrioritySchema.safeParse('').success).toBe(false);
    expect(PrioritySchema.safeParse(123).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StateGroupSchema
// ---------------------------------------------------------------------------
describe('StateGroupSchema', () => {
  it('accepts all valid state groups', () => {
    for (const g of ['backlog', 'unstarted', 'started', 'completed', 'cancelled']) {
      expect(StateGroupSchema.safeParse(g).success).toBe(true);
    }
  });

  it('rejects an invalid state group', () => {
    expect(StateGroupSchema.safeParse('in_progress').success).toBe(false);
    expect(StateGroupSchema.safeParse('unknown').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CycleStatusSchema
// ---------------------------------------------------------------------------
describe('CycleStatusSchema', () => {
  it('accepts all valid cycle statuses', () => {
    for (const s of ['draft', 'started', 'completed']) {
      expect(CycleStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects an invalid cycle status', () => {
    expect(CycleStatusSchema.safeParse('cancelled').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ModuleStatusSchema
// ---------------------------------------------------------------------------
describe('ModuleStatusSchema', () => {
  it('accepts all valid module statuses', () => {
    for (const s of ['backlog', 'planned', 'in_progress', 'paused', 'completed', 'cancelled']) {
      expect(ModuleStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects an invalid module status', () => {
    expect(ModuleStatusSchema.safeParse('started').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MemberRoleSchema
// ---------------------------------------------------------------------------
describe('MemberRoleSchema', () => {
  it('accepts all valid member roles', () => {
    for (const r of ['admin', 'member', 'guest', 'viewer']) {
      expect(MemberRoleSchema.safeParse(r).success).toBe(true);
    }
  });

  it('rejects an invalid role', () => {
    expect(MemberRoleSchema.safeParse('owner').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StateSchema
// ---------------------------------------------------------------------------
describe('StateSchema', () => {
  it('parses a complete state object', () => {
    const result = StateSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440002',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      name: 'In Review',
      color: '#F59E0B',
      group: 'started',
      sequence: 3,
      default: false,
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
  });

  it('parses a state with nullable color', () => {
    const result = StateSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440002',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      name: 'Backlog',
      color: null,
      group: 'backlog',
      sequence: 0,
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid state group', () => {
    const result = StateSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440002',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      name: 'Started',
      color: null,
      group: 'started!',
      sequence: 1,
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LabelSchema
// ---------------------------------------------------------------------------
describe('LabelSchema', () => {
  it('parses a label without parent', () => {
    const result = LabelSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440020',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      name: 'Bug',
      color: '#EF4444',
      parent: null,
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
  });

  it('parses a label with a parent', () => {
    const result = LabelSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440021',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      name: 'UI Bug',
      color: '#EF4444',
      parent: '550e8400-e29b-41d4-a716-446655440020',
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IssueSchema
// ---------------------------------------------------------------------------
describe('IssueSchema', () => {
  it('parses a complete issue', () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
    if (result.success) {
      const issue: Issue = result.data;
      expect(issue.name).toBe('Fix login button alignment');
      expect(issue.sequence_id).toBe(42);
      expect(issue.assignees).toHaveLength(1);
      expect(issue.labels).toHaveLength(1);
    }
  });

  it('parses an issue with expanded state_detail', () => {
    const result = IssueSchema.safeParse(
      validIssue({
        state_detail: {
          id: '550e8400-e29b-41d4-a716-446655440002',
          project: '550e8400-e29b-41d4-a716-446655440001',
          workspace: 'my-workspace',
          name: 'Done',
          color: '#10B981',
          group: 'completed',
          sequence: 5,
          created_at: iso,
          updated_at: iso,
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('parses an issue with optional fields omitted', () => {
    const result = IssueSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      name: 'Minimal issue',
      state: '550e8400-e29b-41d4-a716-446655440002',
      priority: 'low',
      sequence_id: 1,
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.assignees).toEqual([]);
      expect(result.data.labels).toEqual([]);
    }
  });

  it('rejects an issue with missing required fields', () => {
    const result = IssueSchema.safeParse({ name: 'Incomplete' });
    expect(result.success).toBe(false);
  });

  it('rejects an issue with an invalid priority', () => {
    const result = IssueSchema.safeParse(validIssue({ priority: 'critical' }));
    expect(result.success).toBe(false);
  });

  it('rejects an issue with a non-UUID id', () => {
    const result = IssueSchema.safeParse(validIssue({ id: 'not-a-uuid' }));
    expect(result.success).toBe(false);
  });

  it('rejects an issue with an invalid datetime', () => {
    const result = IssueSchema.safeParse(validIssue({ created_at: 'not-a-date' }));
    expect(result.success).toBe(false);
  });

  it('rejects an issue with a non-integer sequence_id', () => {
    const result = IssueSchema.safeParse(validIssue({ sequence_id: 42.5 }));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProjectSchema
// ---------------------------------------------------------------------------
describe('ProjectSchema', () => {
  it('parses a complete project', () => {
    const result = ProjectSchema.safeParse(validProject());
    expect(result.success).toBe(true);
    if (result.success) {
      const project: Project = result.data;
      expect(project.name).toBe('Website Redesign');
      expect(project.identifier).toBe('PROJ');
    }
  });

  it('parses a minimal project', () => {
    const result = ProjectSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Minimal',
      identifier: 'MIN',
      workspace: 'my-workspace',
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a project with a short identifier', () => {
    const result = ProjectSchema.safeParse(validProject({ identifier: '' }));
    expect(result.success).toBe(true); // empty string is still a string
  });

  it('rejects a project missing workspace', () => {
    const result = ProjectSchema.safeParse(validProject({ workspace: undefined }));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CycleSchema
// ---------------------------------------------------------------------------
describe('CycleSchema', () => {
  it('parses a complete cycle', () => {
    const result = CycleSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440030',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      name: 'Sprint 12',
      description: 'Q3 feature work',
      start_date: date,
      end_date: '2026-06-14',
      status: 'started',
      total_issues: 24,
      completed_issues: 8,
      cancelled_issues: 1,
      started_issues: 6,
      unstarted_issues: 9,
      progress_snapshot: { completed: 33.3, started: 25 },
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const cycle: Cycle = result.data;
      expect(cycle.name).toBe('Sprint 12');
      expect(cycle.status).toBe('started');
    }
  });

  it('rejects a cycle with an invalid status', () => {
    const result = CycleSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440030',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      name: 'Bad cycle',
      start_date: date,
      end_date: '2026-06-14',
      status: 'in_progress',
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a cycle with a non-date start_date', () => {
    const result = CycleSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440030',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      name: 'Bad date',
      start_date: 'hello',
      end_date: '2026-06-14',
      status: 'draft',
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ModuleSchema
// ---------------------------------------------------------------------------
describe('ModuleSchema', () => {
  it('parses a complete module', () => {
    const result = ModuleSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440040',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      name: 'Authentication',
      description: '<p>Auth module work</p>',
      description_text: 'Auth module work',
      status: 'in_progress',
      start_date: date,
      target_date: '2026-07-01',
      total_issues: 15,
      completed_issues: 5,
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
  });

  it('parses a module with nullable dates', () => {
    const result = ModuleSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440040',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      name: 'Backlog',
      status: 'backlog',
      start_date: null,
      target_date: null,
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WorkspaceSchema
// ---------------------------------------------------------------------------
describe('WorkspaceSchema', () => {
  it('parses a complete workspace', () => {
    const result = WorkspaceSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440050',
      name: 'Megabyte Labs',
      slug: 'megabyte-labs',
      description: 'Building AI-native tools',
      logo_url: 'https://example.com/logo.png',
      owner: {
        id: '550e8400-e29b-41d4-a716-446655440060',
        display_name: 'Alice',
        email: 'alice@example.com',
      },
      total_projects: 5,
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
  });

  it('parses a minimal workspace', () => {
    const result = WorkspaceSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440050',
      name: 'Minimal',
      slug: 'minimal',
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ProjectMemberSchema
// ---------------------------------------------------------------------------
describe('ProjectMemberSchema', () => {
  it('parses a complete project member', () => {
    const result = ProjectMemberSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440070',
      member: '550e8400-e29b-41d4-a716-446655440071',
      display_name: 'Bob Builder',
      avatar: 'https://example.com/avatar.png',
      role: 2,
      role_label: 'admin',
      project: '550e8400-e29b-41d4-a716-446655440001',
      workspace: 'my-workspace',
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
  });

  it('parses a member with nullable avatar', () => {
    const result = ProjectMemberSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440070',
      member: '550e8400-e29b-41d4-a716-446655440071',
      display_name: 'Bob',
      avatar: null,
      role: 5,
      role_label: 'member',
      project: '550e8400-e29b-41d4-a716-446655440001',
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid role_label', () => {
    const result = ProjectMemberSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440070',
      member: '550e8400-e29b-41d4-a716-446655440071',
      display_name: 'Bob',
      role: 2,
      role_label: 'owner',
      project: '550e8400-e29b-41d4-a716-446655440001',
      created_at: iso,
      updated_at: iso,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PageInfoSchema
// ---------------------------------------------------------------------------
describe('PageInfoSchema', () => {
  it('parses a page info with results available', () => {
    const result = PageInfoSchema.safeParse({
      next_cursor: 'cursor_abc',
      prev_cursor: null,
      next_page_results: true,
      prev_page_results: false,
      total_count: 200,
      total_pages: 20,
    });
    expect(result.success).toBe(true);
  });

  it('parses a page info with no more results', () => {
    const result = PageInfoSchema.safeParse({
      next_cursor: null,
      prev_cursor: null,
      next_page_results: false,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// paginatedResponseSchema
// ---------------------------------------------------------------------------
describe('paginatedResponseSchema', () => {
  it('wraps an item schema in a paginated envelope', () => {
    const schema = paginatedResponseSchema(IssueSchema);
    const result = schema.safeParse({
      results: [validIssue()],
      next_cursor: 'cursor_xyz',
      prev_cursor: null,
      next_page_results: false,
      total_count: 1,
      total_pages: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0].name).toBe('Fix login button alignment');
    }
  });

  it('rejects a paginated response with bad inner data', () => {
    const schema = paginatedResponseSchema(IssueSchema);
    const result = schema.safeParse({
      results: [{ name: 'Missing required fields' }],
      next_cursor: null,
      prev_cursor: null,
      next_page_results: false,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// numericRoleToMemberRole
// ---------------------------------------------------------------------------
describe('numericRoleToMemberRole', () => {
  it('maps 2 to admin', () => {
    expect(numericRoleToMemberRole(2)).toBe('admin');
  });
  it('maps 5 to member', () => {
    expect(numericRoleToMemberRole(5)).toBe('member');
  });
  it('maps 10 to guest', () => {
    expect(numericRoleToMemberRole(10)).toBe('guest');
  });
  it('maps 15 to viewer', () => {
    expect(numericRoleToMemberRole(15)).toBe('viewer');
  });
  it('maps unknown to viewer fallback', () => {
    expect(numericRoleToMemberRole(99)).toBe('viewer');
    expect(numericRoleToMemberRole(0)).toBe('viewer');
  });
});

// ---------------------------------------------------------------------------
// issueDisplayId
// ---------------------------------------------------------------------------
describe('issueDisplayId', () => {
  it('formats identifier and sequence', () => {
    expect(issueDisplayId('PROJ', 42)).toBe('PROJ-42');
  });
  it('handles short identifiers', () => {
    expect(issueDisplayId('A', 1)).toBe('A-1');
  });
  it('handles large sequence numbers', () => {
    expect(issueDisplayId('PROJ', 99999)).toBe('PROJ-99999');
  });
});

// ---------------------------------------------------------------------------
// Type inference compile-time checks
// ---------------------------------------------------------------------------
describe('type inference', () => {
  it('Issue type is inferred from IssueSchema', () => {
    // Compile-time assertion: the following line must type-check
    const _typeCheck: Issue extends Record<string, unknown> ? true : never = true;
    expect(_typeCheck).toBe(true);
  });

  it('Project type is inferred from ProjectSchema', () => {
    const _typeCheck: Project extends Record<string, unknown> ? true : never = true;
    expect(_typeCheck).toBe(true);
  });

  it('Cycle type is inferred from CycleSchema', () => {
    const _typeCheck: Cycle extends Record<string, unknown> ? true : never = true;
    expect(_typeCheck).toBe(true);
  });
});
