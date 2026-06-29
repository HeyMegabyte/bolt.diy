/**
 * @module services/campaign_builder
 * @description LM13 (#293) — AI-driven campaign template builder for Listmonk.
 * Pure, zero-I/O module defining campaign kinds, template shapes, default templates,
 * variable extraction, and validation. Consumed by the LLM prompt layer that
 * generates the subject+body, then by the Listmonk send path (review-gated).
 *
 * Never throws. All validation funneled through {@link validateTemplate}.
 *
 * @packageDocumentation
 */

/** Supported campaign kinds for Listmonk AI-suggested templates. */
export type CampaignKind =
  | 'newsletter'
  | 'changelog'
  | 'announcement'
  | 'onboarding'
  | 'reengagement';

/**
 * A single campaign template definition. All string fields may contain
 * `{{variable}}` references that the LLM or Listmonk send path fills at runtime.
 */
export interface CampaignTemplate {
  /** Which campaign kind this template supports. */
  readonly kind: CampaignKind;
  /** Human reference name (e.g. "Monthly Newsletter"). */
  readonly name: string;
  /** Subject line template with {{vars}}. */
  readonly subjectTemplate: string;
  /** HTML body template with {{vars}}. */
  readonly bodyTemplate: string;
  /** Plain-text version with {{vars}}. */
  readonly textTemplate: string;
  /** Variables this template expects (e.g. ['business_name', 'month', 'highlights']). */
  readonly variables: readonly string[];
  /** Recommended send hour (0-23), derived from LM16 send-optimization defaults. */
  readonly sendHour: number;
  /**
   * Target cohort from LM10 lifecycle.
   * One of: 'all' | 'active' | 'trial' | 'churned' | 'new'.
   */
  readonly targetCohort: string;
}

const NEWS_VARS = ['business_name', 'month', 'highlights'] as const;
const CL_VARS = ['business_name', 'month', 'changes'] as const;
const ANN_VARS = ['business_name', 'announcement_title', 'cta_url'] as const;
const ONB_VARS = ['business_name', 'first_name', 'getting_started_url'] as const;
const RE_VARS = ['business_name', 'months_away', 'comeback_offer'] as const;

/** Per-campaign-kind recommended templates. */
export const DEFAULT_TEMPLATES: Readonly<Record<CampaignKind, CampaignTemplate>> = Object.freeze({
  announcement: Object.freeze({
    bodyTemplate: [
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>',
      '<h1>{{announcement_title}}</h1>',
      '<p>We are excited to share this news with you from {{business_name}}.</p>',
      '<p><a href="{{cta_url}}">Learn more</a></p>',
      '</body></html>',
    ].join(''),
    kind: 'announcement',
    name: 'Big Announcement',
    sendHour: 10,
    subjectTemplate: '🎉 {{announcement_title}} — {{business_name}}',
    targetCohort: 'all',
    textTemplate: [
      '🎉 {{announcement_title}} — {{business_name}}',
      '',
      'We are excited to share this news with you from {{business_name}}.',
      'Learn more: {{cta_url}}',
    ].join('\n'),
    variables: ANN_VARS,
  }),
  changelog: Object.freeze({
    bodyTemplate: [
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>',
      '<h1>What&#39;s new at {{business_name}}</h1>',
      '<p>Here is everything we shipped this {{month}}.</p>',
      '<ul>',
      '<li>{{changes}}</li>',
      '</ul>',
      '<p>Explore the full changelog on our website.</p>',
      '</body></html>',
    ].join(''),
    kind: 'changelog',
    name: 'Product Changelog',
    sendHour: 14,
    subjectTemplate: "What's new — {{business_name}} ({{month}})",
    targetCohort: 'active',
    textTemplate: [
      "What's new — {{business_name}} ({{month}})",
      '',
      'Here is everything we shipped this {{month}}.',
      '',
      '• {{changes}}',
      '',
      'Explore the full changelog on our website.',
    ].join('\n'),
    variables: CL_VARS,
  }),
  newsletter: Object.freeze({
    bodyTemplate: [
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>',
      '<h1>{{business_name}} — {{month}} Update</h1>',
      '<p>Here is what happened at {{business_name}} this {{month}}.</p>',
      '<h2>Highlights</h2>',
      '<p>{{highlights}}</p>',
      '<p>Thank you for being part of our journey.</p>',
      '</body></html>',
    ].join(''),
    kind: 'newsletter',
    name: 'Monthly Newsletter',
    sendHour: 10,
    subjectTemplate: '{{business_name}} — {{month}} Update',
    targetCohort: 'active',
    textTemplate: [
      '{{business_name}} — {{month}} Update',
      '',
      'Here is what happened at {{business_name}} this {{month}}.',
      '',
      'Highlights:',
      '{{highlights}}',
      '',
      'Thank you for being part of our journey.',
    ].join('\n'),
    variables: NEWS_VARS,
  }),
  onboarding: Object.freeze({
    bodyTemplate: [
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>',
      '<h1>Welcome, {{first_name}}!</h1>',
      '<p>Thank you for joining {{business_name}}. We are thrilled to have you.</p>',
      '<ol>',
      '<li>Set up your profile</li>',
      '<li>Explore our features</li>',
      '<li>Get started with <a href="{{getting_started_url}}">this guide</a></li>',
      '</ol>',
      '<p>Need help? Just reply to this email.</p>',
      '</body></html>',
    ].join(''),
    kind: 'onboarding',
    name: 'Welcome Series',
    sendHour: 9,
    subjectTemplate: 'Welcome to {{business_name}} 👋',
    targetCohort: 'new',
    textTemplate: [
      'Welcome to {{business_name}} 👋',
      '',
      'Welcome, {{first_name}}!',
      '',
      'Thank you for joining {{business_name}}. We are thrilled to have you.',
      '',
      '1. Set up your profile',
      '2. Explore our features',
      '3. Get started: {{getting_started_url}}',
      '',
      'Need help? Just reply to this email.',
    ].join('\n'),
    variables: ONB_VARS,
  }),
  reengagement: Object.freeze({
    bodyTemplate: [
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>',
      '<h1>We miss you</h1>',
      '<p>It has been {{months_away}} months since your last visit to {{business_name}}.</p>',
      '<p>Here is what is new:</p>',
      '<p>{{comeback_offer}}</p>',
      '<p>Come back and see what is new.</p>',
      '</body></html>',
    ].join(''),
    kind: 'reengagement',
    name: 'We Miss You',
    sendHour: 16,
    subjectTemplate: 'We miss you at {{business_name}}',
    targetCohort: 'churned',
    textTemplate: [
      'We miss you at {{business_name}}',
      '',
      'It has been {{months_away}} months since your last visit to {{business_name}}.',
      '',
      'Here is what is new:',
      '{{comeback_offer}}',
      '',
      'Come back and see what is new.',
    ].join('\n'),
    variables: RE_VARS,
  }),
});

const VAR_RE = /\{\{(\w+)\}\}/g;

/**
 * Extract unique, sorted variable names from a template string.
 * Matches `{{var_name}}` — underscores and alphanumeric only.
 *
 * @param template - A template string that may contain `{{var}}` markers.
 * @returns Sorted, deduplicated variable names, lower-cased.
 *
 * @example
 * extractTemplateVars('Hello {{name}}, welcome to {{business_name}}');
 * // → ['business_name', 'name']
 */
export function extractTemplateVars(template: string): string[] {
  const vars = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(VAR_RE.source, 'g');
  while ((match = re.exec(template)) !== null) {
    vars.add(match[1].toLowerCase());
  }
  return [...vars].sort();
}

/** Required keys on a CampaignTemplate for validation. */
const REQUIRED_STRING_KEYS = [
  'name',
  'subjectTemplate',
  'bodyTemplate',
  'textTemplate',
  'targetCohort',
] as const;

const VALID_COHORTS = new Set(['all', 'active', 'trial', 'churned', 'new']);
const VALID_KINDS: ReadonlySet<string> = new Set([
  'newsletter',
  'changelog',
  'announcement',
  'onboarding',
  'reengagement',
]);

/**
 * Validate an unknown value as a {@link CampaignTemplate}.
 * Returns an array of human-readable error strings. An empty array means valid.
 *
 * @param t - The value to validate.
 * @returns Error strings, one per violation. Empty when valid.
 *
 * @example
 * validateTemplate({ kind: 'newsletter', name: 'Test' });
 * // → ['missing or invalid kind', ...]
 */
export function validateTemplate(t: unknown): string[] {
  const errors: string[] = [];

  if (t === null || t === undefined || typeof t !== 'object') {
    errors.push('template must be a non-null object');
    return errors;
  }

  const obj = t as Record<string, unknown>;

  // Validate kind
  if (!VALID_KINDS.has(obj.kind as string)) {
    errors.push('missing or invalid kind');
  }

  // Validate required string keys
  for (const key of REQUIRED_STRING_KEYS) {
    const val = obj[key];
    if (typeof val !== 'string' || val.trim().length === 0) {
      errors.push(`missing or empty ${key}`);
    }
  }

  // Validate sendHour
  const sh = obj.sendHour;
  if (typeof sh !== 'number' || !Number.isInteger(sh) || sh < 0 || sh > 23) {
    errors.push('sendHour must be an integer between 0 and 23');
  }

  // Validate targetCohort when present as a string
  if (typeof obj.targetCohort === 'string') {
    if (!VALID_COHORTS.has(obj.targetCohort)) {
      errors.push(
        `invalid targetCohort "${obj.targetCohort}"; must be one of: ${[...VALID_COHORTS].join(', ')}`,
      );
    }
  }

  // Validate variables is an array of strings when present
  if (obj.variables !== undefined) {
    if (!Array.isArray(obj.variables)) {
      errors.push('variables must be an array');
    } else if (obj.variables.some((v: unknown) => typeof v !== 'string')) {
      errors.push('all variables must be strings');
    }
  }

  return errors;
}
