/**
 * @module services/workflow_templates
 *
 * @description
 * Twenty CRM workflow templates. Pure data — no I/O, no clock, never throws.
 * Each template is a no-Zapier workflow definition: a named sequence of
 * trigger → actions that can be instantiated per-custom-object in the Twenty
 * 2.0 apps framework.
 *
 *   company.created    → send_email (welcome)
 *   deal.stage_changed → create_task (follow-up)
 *   person.email_opened → update_deal (re-engage)
 *   task.completed     → create_task (close-cycle)
 *   scheduled          → webhook (weekly digest)
 *
 * @see services/crm/twenty.ts (workflow engine consumer, if/when built)
 */

/** Events that can start a workflow. */
export type WorkflowTrigger =
  | 'company.created'
  | 'deal.stage_changed'
  | 'person.email_opened'
  | 'task.completed'
  | 'scheduled';

/** Actions a workflow step can perform. */
export type WorkflowAction =
  | 'send_email'
  | 'create_task'
  | 'update_deal'
  | 'add_to_list'
  | 'webhook';

/** One step in a workflow: the action + its configuration. */
export interface WorkflowStep {
  readonly type: WorkflowAction;
  readonly config: Record<string, string>;
}

/** A named workflow: what starts it + what happens next. */
export interface WorkflowDef {
  readonly name: string;
  readonly trigger: WorkflowTrigger;
  readonly actions: readonly WorkflowStep[];
}

/**
 * The five built-in workflows a Twenty workspace receives at provisioning.
 *
 *   1. **Welcome email** on `company.created` — sends a branded intro to the
 *      org contact. Config keys: `template_id`, `from_address`, `subject`.
 *
 *   2. **Follow-up task** on `deal.stage_changed` — creates a task for the
 *      deal owner when a deal moves stage. Config keys: `task_owner`,
 *      `task_subject`, `due_in_days`.
 *
 *   3. **Re-engagement flag** on `person.email_opened` — bumps the deal's
 *      priority when a prospect opens a tracked email. Config keys:
 *      `new_stage`, `note`.
 *
 *   4. **Close-cycle task** on `task.completed` — creates a review task for
 *      the assignee's manager. Config keys: `task_owner`, `task_subject`,
 *      `due_in_days`.
 *
 *   5. **Weekly digest** via `scheduled` — fires a webhook every Monday
 *      morning with a usage summary. Config keys: `webhook_url`, `day`,
 *      `timezone`.
 */
export const DEFAULT_WORKFLOWS: readonly WorkflowDef[] = [
  {
    actions: [
      {
        config: {
          from_address: 'hello@projectsites.dev',
          subject: 'Welcome to Projectsites!',
          template_id: 'welcome_company',
        },
        type: 'send_email',
      },
    ],
    name: 'Company Welcome',
    trigger: 'company.created',
  },
  {
    actions: [
      {
        config: {
          due_in_days: '3',
          task_owner: 'deal_owner',
          task_subject: 'Follow up on {{deal_name}}',
        },
        type: 'create_task',
      },
    ],
    name: 'Deal Stage Follow-Up',
    trigger: 'deal.stage_changed',
  },
  {
    actions: [
      {
        config: {
          new_stage: 'engaged',
          note: 'Prospect opened email — re-engage',
        },
        type: 'update_deal',
      },
    ],
    name: 'Re-Engagement Flag',
    trigger: 'person.email_opened',
  },
  {
    actions: [
      {
        config: {
          due_in_days: '2',
          task_owner: 'manager',
          task_subject: 'Review completed {{original_task}}',
        },
        type: 'create_task',
      },
    ],
    name: 'Close-Cycle Review',
    trigger: 'task.completed',
  },
  {
    actions: [
      {
        config: {
          day: 'monday',
          timezone: 'America/New_York',
          webhook_url: 'https://hooks.projectsites.dev/digest',
        },
        type: 'webhook',
      },
    ],
    name: 'Weekly Digest',
    trigger: 'scheduled',
  },
] as const;

// Runtime freeze so callers can rely on structural immutability.
Object.freeze(DEFAULT_WORKFLOWS);

/**
 * All unique trigger values across the built-in workflows.
 * Useful for populating a "trigger picker" in admin UI.
 */
export const WORKFLOW_TRIGGERS: readonly WorkflowTrigger[] = Object.freeze([
  ...new Set(DEFAULT_WORKFLOWS.map((w) => w.trigger)),
]);

/**
 * All unique action types across the built-in workflows.
 * Useful for populating a "step type picker" in admin UI.
 */
export const WORKFLOW_ACTIONS: readonly WorkflowAction[] = Object.freeze([
  ...new Set(DEFAULT_WORKFLOWS.flatMap((w) => w.actions.map((a) => a.type))),
]);
