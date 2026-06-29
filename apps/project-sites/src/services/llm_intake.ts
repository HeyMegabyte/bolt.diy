/**
 * @module services/llm_intake
 * @description Pure keyword + heuristic intake triage classifier.
 * Given a new issue/request title + body, classifies priority, labels, assignee,
 * and confidence. Zero I/O — never throws. Designed to validate and normalize
 * LLM-generated triage suggestions.
 */

// ── Types ─────────────────────────────────────────────────────────

export type Priority = 'urgent' | 'high' | 'normal' | 'low';

export interface TriageResult {
  priority: Priority;
  labels: string[];
  assignee: string | null;
  confidence: number;
}

// ── Keyword tables ─────────────────────────────────────────────────

interface PriorityRule {
  keywords: string[];
  priority: Priority;
}

interface DomainRule {
  assignee: string;
  keywords: string[];
  label: string;
}

const PRIORITY_RULES: PriorityRule[] = [
  {
    keywords: ['down', 'outage', '500', 'broken', 'crash', 'emergency'],
    priority: 'urgent',
  },
  {
    keywords: ['bug', 'error', 'fix', 'regression', 'defect', 'fault'],
    priority: 'high',
  },
  {
    keywords: ['feature', 'enhance', 'enhancement', 'improvement', 'request', 'suggestion'],
    priority: 'normal',
  },
];

const DOMAIN_RULES: Record<string, DomainRule> = {
  billing: {
    assignee: 'billing-team',
    keywords: [
      'billing',
      'charge',
      'credit',
      'invoice',
      'payment',
      'plan',
      'pricing',
      'refund',
      'renewal',
      'subscription',
      'trial',
    ],
    label: 'billing',
  },
  crm: {
    assignee: 'crm-team',
    keywords: [
      'account',
      'contact',
      'crm',
      'customer',
      'deal',
      'lead',
      'opportunity',
      'pipeline',
      'prospect',
      'sales',
      'stage',
    ],
    label: 'crm',
  },
  devops: {
    assignee: 'ops-team',
    keywords: [
      'alert',
      'certificate',
      'crash',
      'deploy',
      'deployment',
      'dns',
      'down',
      'incident',
      'infra',
      'infrastructure',
      'latency',
      'outage',
      'performance',
      'server',
      'ssl',
      'timeout',
      '500',
      '502',
      '503',
    ],
    label: 'devops',
  },
  email: {
    assignee: 'email-team',
    keywords: [
      'bounce',
      'campaign',
      'delivery',
      'email',
      'inbox',
      'mail',
      'newsletter',
      'notification',
      'send',
      'spam',
      'unsubscribe',
    ],
    label: 'email',
  },
};

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Build a single regex that matches any of the keywords as whole words (case-insensitive).
 * Returns null when the list is empty.
 */
function wordMatcher(keywords: string[]): RegExp | null {
  if (keywords.length === 0) return null;
  const escaped = keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

/**
 * Returns true when at least one keyword in the list appears as a whole word in `text`.
 */
function hasAnyKeyword(text: string, keywords: string[]): boolean {
  const matcher = wordMatcher(keywords);
  if (!matcher) return false;
  return matcher.test(text);
}

/**
 * Ordering for priority comparisons. Lower index = higher priority.
 */
const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'normal', 'low'];

/**
 * Returns the higher-priority value between two priorities.
 */
function higherPriority(a: Priority, b: Priority): Priority {
  const ai = PRIORITY_ORDER.indexOf(a);
  const bi = PRIORITY_ORDER.indexOf(b);
  return ai <= bi ? a : b;
}

// ── Main classifier ────────────────────────────────────────────────

/**
 * Classify an issue/request title + body into a triage verdict.
 *
 * @remarks
 * Pure keyword + heuristic classifier — no I/O, never throws. Designed to
 * validate and normalize an LLM-generated triage suggestion. The combined
 * title + body text is scanned for priority and domain keywords.
 *
 * Priority matching (first-highlight wins):
 *   - 'urgent' — down/outage/500/broken/crash/emergency
 *   - 'high' — bug/error/fix/regression/defect/fault
 *   - 'normal' — feature/enhance/enhancement/improvement/request/suggestion
 *   - 'low' — default when no priority keywords match (confidence drops to 0.3)
 *
 * Labels are drawn from any matching domain (billing/devops/crm/email).
 * The assignee reflects the first domain that had a keyword hit.
 * Confidence scales from 0.3 (default no-match) to 0.95 (urgent + domain match).
 *
 * @example
 * ```ts
 * const result = triageIntake('Server is down!', '500 error on checkout page');
 * // => { priority: 'urgent', labels: ['devops', 'billing'], assignee: 'ops-team', confidence: 0.95 }
 *
 * const result = triageIntake('New feature', 'Add a dark mode toggle');
 * // => { priority: 'normal', labels: [], assignee: null, confidence: 0.7 }
 *
 * const result = triageIntake('Just saying hi', 'Love the product!');
 * // => { priority: 'normal', labels: [], assignee: null, confidence: 0.3 }
 * ```
 */
export function triageIntake(title: string, body: string): TriageResult {
  const combined = `${title} ${body}`.trim();

  // ── Priority classification ────────────────────────────────

  let priority: Priority = 'normal';
  let priorityFound = false;

  for (const rule of PRIORITY_RULES) {
    if (hasAnyKeyword(combined, rule.keywords)) {
      priority = priorityFound ? higherPriority(priority, rule.priority) : rule.priority;
      priorityFound = true;
    }
  }

  // ── Domain classification (labels + assignee) ──────────────

  const labels: string[] = [];
  let assignee: string | null = null;

  for (const [, rule] of Object.entries(DOMAIN_RULES)) {
    if (hasAnyKeyword(combined, rule.keywords)) {
      labels.push(rule.label);
      if (assignee === null) {
        assignee = rule.assignee;
      }
    }
  }

  // ── Confidence scoring ─────────────────────────────────────

  // Base confidence: priority keywords were found
  const confidence = computeConfidence(combined, priorityFound, labels.length > 0, priority);

  return { assignee, confidence, labels, priority };
}

/**
 * Compute a numeric confidence score (0.0–1.0) for the triage verdict.
 *
 * Factors:
 *   - 0.95  urgent keywords + domain match (strong signal)
 *   - 0.85  high priority + domain match
 *   - 0.75  priority keywords found + no domain match
 *   - 0.70  'feature/enhance' keyword found (explicit but low urgency)
 *   - 0.50  no priority keywords but domain keywords present
 *   - 0.30  no keywords of any kind (pure default)
 */
function computeConfidence(
  combined: string,
  priorityFound: boolean,
  domainFound: boolean,
  priority: Priority,
): number {
  if (!priorityFound && !domainFound) return 0.3;
  if (!priorityFound && domainFound) return 0.5;

  if (priority === 'urgent') {
    return domainFound ? 0.95 : 0.85;
  }
  if (priority === 'high') {
    return domainFound ? 0.85 : 0.75;
  }

  // normal
  return domainFound ? 0.75 : 0.7;
}
