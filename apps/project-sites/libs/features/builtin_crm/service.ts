/**
 * @module libs/features/builtin_crm/service
 *
 * Built-in CRM (#78, ROI 2.00) — pure lead scoring engine, pipeline
 * stage manager, and contact timeline builder. Zero I/O, deterministic.
 */
export type LeadSource = 'website_form' | 'phone_call' | 'email' | 'social' | 'referral' | 'walk_in' | 'other';
export type PipelineStage = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type LeadScore = 'hot' | 'warm' | 'cold';

export interface Contact {
  id: string; name: string; email: string; phone?: string;
  source: LeadSource; createdAt: string; tags: string[];
  lastActivityAt: string; score: number; scoreLabel: LeadScore;
  pipelineStage: PipelineStage; dealValue?: number;
  notes: string[]; activityCount: number;
}

export interface ScoreInput {
  source: LeadSource; hasPhone: boolean; hasEmail: boolean;
  pageCount: number; daysSinceLastActivity: number;
  formSubmissions: number; dealValue?: number;
}

const SOURCE_SCORES: Record<LeadSource, number> = {
  website_form: 20, phone_call: 30, email: 15,
  social: 10, referral: 35, walk_in: 25, other: 5,
};

/**
 * Scores a lead from behavioral and demographic signals.
 * Returns 0-100 score + hot/warm/cold label.
 */
export function scoreLead(input: ScoreInput): { score: number; label: LeadScore } {
  let score = 0;

  // Source quality
  score += SOURCE_SCORES[input.source] || 5;

  // Contact completeness
  if (input.hasPhone) score += 15;
  if (input.hasEmail) score += 10;

  // Engagement signals
  if (input.pageCount >= 5) score += 15;
  else if (input.pageCount >= 2) score += 8;

  if (input.formSubmissions >= 2) score += 15;
  else if (input.formSubmissions >= 1) score += 8;

  // Recency bonus
  if (input.daysSinceLastActivity <= 1) score += 15;
  else if (input.daysSinceLastActivity <= 7) score += 8;
  else if (input.daysSinceLastActivity > 30) score -= 10;

  // Deal value signal
  if (input.dealValue && input.dealValue > 5000) score += 10;

  const clamped = Math.max(0, Math.min(100, score));
  const label: LeadScore = clamped >= 70 ? 'hot' : clamped >= 40 ? 'warm' : 'cold';
  return { score: clamped, label };
}

// ── Pipeline ────────────────────────────────────────────────────────────────

const PIPELINE_ORDER: PipelineStage[] = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

const STAGE_LABELS: Record<PipelineStage, string> = {
  new: 'New Lead', contacted: 'Contacted', qualified: 'Qualified',
  proposal: 'Proposal Sent', negotiation: 'Negotiation', won: 'Won', lost: 'Lost',
};

/**
 * Returns the next valid stage(s) from a given stage.
 */
export function nextStages(current: PipelineStage): PipelineStage[] {
  const idx = PIPELINE_ORDER.indexOf(current);
  if (idx === -1 || current === 'won' || current === 'lost') return [];
  return PIPELINE_ORDER.slice(idx + 1);
}

/**
 * Returns a pipeline summary: count of leads in each stage + total deal value.
 */
export function pipelineSummary(contacts: Pick<Contact, 'pipelineStage' | 'dealValue'>[]) {
  const stages: Record<string, { count: number; value: number }> = {};
  let totalValue = 0;
  for (const c of contacts) {
    const s = stages[c.pipelineStage] || { count: 0, value: 0 };
    s.count++;
    s.value += c.dealValue || 0;
    totalValue += c.dealValue || 0;
    stages[c.pipelineStage] = s;
  }
  return { stages, totalValue, totalLeads: contacts.length };
}

/**
 * Generates a next-action recommendation for a contact based on stage and score.
 */
export function nextAction(contact: Pick<Contact, 'pipelineStage' | 'scoreLabel'>): string {
  const { pipelineStage, scoreLabel } = contact;
  if (pipelineStage === 'won') return 'Send thank-you email and onboarding materials.';
  if (pipelineStage === 'lost') return 'Send follow-up in 30 days. Add to nurture campaign.';
  if (scoreLabel === 'hot' && pipelineStage === 'new') return 'Call within 1 hour. High-intent lead.';
  if (scoreLabel === 'hot') return 'Prioritize follow-up today.';
  if (scoreLabel === 'warm' && pipelineStage === 'new') return 'Send intro email within 24 hours.';
  if (pipelineStage === 'proposal') return 'Follow up within 48 hours if no response.';
  if (scoreLabel === 'cold') return 'Add to monthly nurture email.';
  return 'Review and update contact notes.';
}

export { PIPELINE_ORDER, STAGE_LABELS };
