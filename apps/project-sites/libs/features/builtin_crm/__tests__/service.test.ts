import { scoreLead, nextStages, pipelineSummary, nextAction } from '../service.js';

describe('scoreLead', () => {
  test('referral with phone + email scores hot', () => {
    const r = scoreLead({ source: 'referral', hasPhone: true, hasEmail: true, pageCount: 5, daysSinceLastActivity: 0, formSubmissions: 2, dealValue: 6000 });
    expect(r.label).toBe('hot');
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  test('social lead with no contact info scores cold', () => {
    const r = scoreLead({ source: 'social', hasPhone: false, hasEmail: false, pageCount: 1, daysSinceLastActivity: 14, formSubmissions: 0 });
    expect(r.label).toBe('cold');
    expect(r.score).toBeLessThan(40);
  });

  test('recent activity gives bonus', () => {
    const recent = scoreLead({ source: 'website_form', hasPhone: true, hasEmail: true, pageCount: 2, daysSinceLastActivity: 0, formSubmissions: 1 });
    const stale = scoreLead({ source: 'website_form', hasPhone: true, hasEmail: true, pageCount: 2, daysSinceLastActivity: 35, formSubmissions: 1 });
    expect(recent.score).toBeGreaterThan(stale.score);
  });

  test('score is clamped 0-100', () => {
    const r = scoreLead({ source: 'referral', hasPhone: true, hasEmail: true, pageCount: 10, daysSinceLastActivity: 0, formSubmissions: 5, dealValue: 10000 });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

describe('nextStages', () => {
  test('new → contacted, qualified, proposal, negotiation, won, lost', () => {
    expect(nextStages('new')).toContain('contacted');
  });

  test('won returns empty', () => {
    expect(nextStages('won')).toHaveLength(0);
  });

  test('lost returns empty', () => {
    expect(nextStages('lost')).toHaveLength(0);
  });
});

describe('pipelineSummary', () => {
  test('computes counts and total value', () => {
    const contacts = [
      { pipelineStage: 'new' as const, dealValue: 1000 },
      { pipelineStage: 'new' as const, dealValue: 2000 },
      { pipelineStage: 'won' as const, dealValue: 5000 },
    ];
    const s = pipelineSummary(contacts);
    expect(s.stages.new.count).toBe(2);
    expect(s.stages.new.value).toBe(3000);
    expect(s.totalValue).toBe(8000);
    expect(s.totalLeads).toBe(3);
  });
});

describe('nextAction', () => {
  test('hot new lead → call within 1 hour', () => {
    expect(nextAction({ pipelineStage: 'new', scoreLabel: 'hot' })).toContain('1 hour');
  });

  test('won → thank-you email', () => {
    expect(nextAction({ pipelineStage: 'won', scoreLabel: 'hot' })).toContain('thank-you');
  });

  test('lost → nurture campaign', () => {
    expect(nextAction({ pipelineStage: 'lost', scoreLabel: 'cold' })).toContain('nurture');
  });

  test('cold lead → monthly nurture', () => {
    expect(nextAction({ pipelineStage: 'new', scoreLabel: 'cold' })).toContain('nurture');
  });
});
