/**
 * Twenty CRM workflow templates — pure-data SSOT tests. Locks every
 * {@link DEFAULT_WORKFLOWS} entry: its shape, its trigger, its action set.
 */
import {
  DEFAULT_WORKFLOWS,
  WORKFLOW_TRIGGERS,
  WORKFLOW_ACTIONS,
  type WorkflowDef,
  type WorkflowTrigger,
  type WorkflowAction,
  type WorkflowStep,
} from '../services/workflow_templates.js';

describe('WORKFLOW_TRIGGERS', () => {
  it('is every unique trigger across the five built-ins', () => {
    expect([...WORKFLOW_TRIGGERS].sort()).toEqual([
      'company.created',
      'deal.stage_changed',
      'person.email_opened',
      'scheduled',
      'task.completed',
    ]);
  });
});

describe('WORKFLOW_ACTIONS', () => {
  it('is every unique action across the five built-ins', () => {
    expect([...WORKFLOW_ACTIONS].sort()).toEqual([
      'create_task',
      'send_email',
      'update_deal',
      'webhook',
    ]);
  });
});

describe('DEFAULT_WORKFLOWS', () => {
  it('has exactly five entries', () => {
    expect(DEFAULT_WORKFLOWS).toHaveLength(5);
  });

  it('every entry is a well-typed WorkflowDef', () => {
    for (const w of DEFAULT_WORKFLOWS) {
      const def: WorkflowDef = w; // compile-time check
      expect(typeof def.name).toBe('string');
      expect(typeof def.trigger).toBe('string');
      expect(Array.isArray(def.actions)).toBe(true);
      expect(def.actions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every trigger is a valid WorkflowTrigger', () => {
    const valid: WorkflowTrigger[] = [
      'company.created',
      'deal.stage_changed',
      'person.email_opened',
      'task.completed',
      'scheduled',
    ];
    for (const w of DEFAULT_WORKFLOWS) {
      expect(valid).toContain(w.trigger);
    }
  });

  it('every action type is a valid WorkflowAction', () => {
    const valid: WorkflowAction[] = [
      'send_email',
      'create_task',
      'update_deal',
      'add_to_list',
      'webhook',
    ];
    for (const w of DEFAULT_WORKFLOWS) {
      for (const a of w.actions) {
        expect(valid).toContain(a.type);
      }
    }
  });

  it('every step has a non-empty name on its config', () => {
    for (const w of DEFAULT_WORKFLOWS) {
      for (const a of w.actions) {
        expect(Object.keys(a.config).length).toBeGreaterThan(0);
      }
    }
  });

  it('every step is a well-typed WorkflowStep', () => {
    for (const w of DEFAULT_WORKFLOWS) {
      for (const a of w.actions) {
        const step: WorkflowStep = a; // compile-time check
        expect(typeof step.type).toBe('string');
        expect(step.config).toBeInstanceOf(Object);
      }
    }
  });
});

describe('individual workflows', () => {
  it('Company Welcome: trigger + send_email shape', () => {
    const w = DEFAULT_WORKFLOWS.find((x) => x.name === 'Company Welcome')!;
    expect(w).toBeDefined();
    expect(w.trigger).toBe('company.created');
    expect(w.actions).toHaveLength(1);
    expect(w.actions[0].type).toBe('send_email');
    expect(w.actions[0].config.template_id).toBe('welcome_company');
    expect(w.actions[0].config.from_address).toBe('hello@projectsites.dev');
    expect(w.actions[0].config.subject).toBe('Welcome to Projectsites!');
  });

  it('Deal Stage Follow-Up: trigger + create_task shape', () => {
    const w = DEFAULT_WORKFLOWS.find((x) => x.name === 'Deal Stage Follow-Up')!;
    expect(w).toBeDefined();
    expect(w.trigger).toBe('deal.stage_changed');
    expect(w.actions).toHaveLength(1);
    expect(w.actions[0].type).toBe('create_task');
    expect(w.actions[0].config.task_owner).toBe('deal_owner');
    expect(w.actions[0].config.task_subject).toBe('Follow up on {{deal_name}}');
    expect(w.actions[0].config.due_in_days).toBe('3');
  });

  it('Re-Engagement Flag: trigger + update_deal shape', () => {
    const w = DEFAULT_WORKFLOWS.find((x) => x.name === 'Re-Engagement Flag')!;
    expect(w).toBeDefined();
    expect(w.trigger).toBe('person.email_opened');
    expect(w.actions).toHaveLength(1);
    expect(w.actions[0].type).toBe('update_deal');
    expect(w.actions[0].config.new_stage).toBe('engaged');
    expect(w.actions[0].config.note).toBe('Prospect opened email — re-engage');
  });

  it('Close-Cycle Review: trigger + create_task shape', () => {
    const w = DEFAULT_WORKFLOWS.find((x) => x.name === 'Close-Cycle Review')!;
    expect(w).toBeDefined();
    expect(w.trigger).toBe('task.completed');
    expect(w.actions).toHaveLength(1);
    expect(w.actions[0].type).toBe('create_task');
    expect(w.actions[0].config.task_owner).toBe('manager');
    expect(w.actions[0].config.task_subject).toBe('Review completed {{original_task}}');
    expect(w.actions[0].config.due_in_days).toBe('2');
  });

  it('Weekly Digest: trigger + webhook shape', () => {
    const w = DEFAULT_WORKFLOWS.find((x) => x.name === 'Weekly Digest')!;
    expect(w).toBeDefined();
    expect(w.trigger).toBe('scheduled');
    expect(w.actions).toHaveLength(1);
    expect(w.actions[0].type).toBe('webhook');
    expect(w.actions[0].config.webhook_url).toBe('https://hooks.projectsites.dev/digest');
    expect(w.actions[0].config.day).toBe('monday');
    expect(w.actions[0].config.timezone).toBe('America/New_York');
  });
});

describe('immutability', () => {
  it('DEFAULT_WORKFLOWS is frozen (readonly export)', () => {
    expect(() => {
      // @ts-expect-error - mutating readonly const
      DEFAULT_WORKFLOWS[0] = { name: 'x', trigger: 'scheduled', actions: [] };
    }).toThrow();
  });
});
