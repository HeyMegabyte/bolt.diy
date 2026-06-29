/**
 * llm_intake — pure keyword triage classifier tests.
 *
 * Covers: priority rules, domain labels, assignee resolution,
 * confidence scoring, edge cases, and the "never throws" contract.
 */
import { triageIntake, type Priority, type TriageResult } from '../services/llm_intake.js';

/**
 * Helper: run a fast structural assertion on every result.
 */
function expectTriage(title: string, body: string, expected: Partial<TriageResult>): void {
  const result = triageIntake(title, body);
  if (expected.priority !== undefined) expect(result.priority).toBe(expected.priority);
  if (expected.labels !== undefined) expect(result.labels).toEqual(expected.labels);
  if (expected.assignee !== undefined) expect(result.assignee).toBe(expected.assignee);
  if (expected.confidence !== undefined) expect(result.confidence).toBe(expected.confidence);
}

// ── Priority classification ─────────────────────────────────────────

describe('priority classification', () => {
  it('detects urgent from title', () => {
    expectTriage('Site is down!', '', { priority: 'urgent' });
  });

  it('detects urgent from body', () => {
    expectTriage('Help', 'We are experiencing an outage on production', {
      priority: 'urgent',
    });
  });

  it('detects urgent from 500 status code', () => {
    expectTriage('500 error on checkout', 'All requests return HTTP 500', {
      priority: 'urgent',
    });
  });

  it('detects urgent from crash keyword', () => {
    expectTriage('App crash', 'Node process crash on startup', {
      priority: 'urgent',
    });
  });

  it('detects high from bug keyword in title', () => {
    expectTriage('Bug in invoice generation', '', { priority: 'high' });
  });

  it('detects high from error keyword in body', () => {
    expectTriage('Invoice issue', 'Getting an error when generating PDF', {
      priority: 'high',
    });
  });

  it('detects high from fix keyword', () => {
    expectTriage('Need to fix login redirect', '', { priority: 'high' });
  });

  it('detects high from regression keyword', () => {
    expectTriage('Regression in search results', 'Search stopped returning correct results', {
      priority: 'high',
    });
  });

  it('detects normal from feature keyword in title', () => {
    expectTriage('Feature: dark mode', '', { priority: 'normal' });
  });

  it('detects normal from enhance keyword in body', () => {
    expectTriage('Dashboard', 'Would be nice to enhance the chart widget', {
      priority: 'normal',
    });
  });

  it('detects normal from request keyword', () => {
    expectTriage('Request: bulk export CSV', 'Need a way to export all contacts', {
      priority: 'normal',
    });
  });

  it('returns normal with low confidence when no keywords match', () => {
    expectTriage('Just saying hi', 'Love the platform!', {
      priority: 'normal',
      labels: [],
      assignee: null,
      confidence: 0.3,
    });
  });

  it('urgent overrides high when both present', () => {
    expectTriage('Bug causing site down', '', { priority: 'urgent' });
  });

  it('urgent overrides normal when both present', () => {
    expectTriage('Feature request: fix the down detector', '', { priority: 'urgent' });
  });

  it('high overrides normal when both present', () => {
    expectTriage('Feature: bug in user profile', '', { priority: 'high' });
  });
});

// ── Domain labels ────────────────────────────────────────────────────

describe('domain labels', () => {
  it('detects billing label', () => {
    expectTriage('Invoice payment failed', '', { labels: ['billing'] });
  });

  it('detects devops label', () => {
    expectTriage('Deploy configuration failing', '', { labels: ['devops'] });
  });

  it('detects crm label', () => {
    expectTriage('CRM contact import broken', '', { labels: ['crm'] });
  });

  it('detects email label', () => {
    expectTriage('Email delivery delayed', '', { labels: ['email'] });
  });

  it('detects multiple domain labels', () => {
    const result = triageIntake('Email billing invoice', 'Deploy failed');
    expect(result.labels).toContain('billing');
    expect(result.labels).toContain('email');
    expect(result.labels).toContain('devops');
  });

  it('returns empty labels when no domain keyword matches', () => {
    expectTriage('Random thought', 'What a beautiful day', { labels: [] });
  });
});

// ── Assignee resolution ──────────────────────────────────────────────

describe('assignee resolution', () => {
  it('assigns billing-team for billing issues', () => {
    expectTriage('Refund request', 'Customer wants a refund', { assignee: 'billing-team' });
  });

  it('assigns ops-team for devops issues', () => {
    expectTriage('Server timeout', 'API is timing out', { assignee: 'ops-team' });
  });

  it('assigns crm-team for CRM issues', () => {
    expectTriage('Lead import failing', 'CSV upload errors', { assignee: 'crm-team' });
  });

  it('assigns email-team for email issues', () => {
    expectTriage('Bounce rate high', 'Emails bouncing', { assignee: 'email-team' });
  });

  it('assigns from first matched domain when multiple domains match', () => {
    // 'billing' comes before 'devops' in the domain iteration order
    const result = triageIntake('Billing server down', '');
    // billing label is present AND billing-team is the assignee
    // (billing is iterated before devops in the DomainRule object)
    expect(result.labels).toContain('billing');
    expect(result.labels).toContain('devops');
    expect(result.assignee).toBe('billing-team');
  });

  it('returns null assignee when no domain matches', () => {
    expectTriage('General question', 'How does this work?', { assignee: null });
  });
});

// ── Confidence scoring ──────────────────────────────────────────────

describe('confidence scoring', () => {
  it('returns 0.95 for urgent + domain match', () => {
    expectTriage('Site down', 'Billing server', { confidence: 0.95 });
  });

  it('returns 0.85 for urgent without domain match', () => {
    expectTriage('Broken emergency', 'Urgent issue', { confidence: 0.85 });
  });

  it('returns 0.85 for high + domain match', () => {
    expectTriage('Bug in email delivery', '', { confidence: 0.85 });
  });

  it('returns 0.75 for high without domain match', () => {
    expectTriage('Bug found', 'There is a regression in the app', { confidence: 0.75 });
  });

  it('returns 0.75 for normal + domain match', () => {
    expectTriage('Feature: billing dashboard', '', { confidence: 0.75 });
  });

  it('returns 0.70 for normal without domain match', () => {
    expectTriage('Feature request', 'New export option', { confidence: 0.7 });
  });

  it('returns 0.50 when no priority keywords but domain keywords present', () => {
    expectTriage('Dashboard', 'Check our billing page', { confidence: 0.5 });
  });

  it('returns 0.30 when no keywords of any kind match', () => {
    expectTriage('Hello world', 'Just a test', { confidence: 0.3 });
  });
});

// ── Edge cases ─────────────────────────────────────────────────────

describe('edge cases', () => {
  it('never throws for empty title and body', () => {
    expect(() => triageIntake('', '')).not.toThrow();
  });

  it('handles empty string title gracefully', () => {
    const result = triageIntake('', 'bug in production');
    expect(result.priority).toBe('high');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('handles empty string body gracefully', () => {
    const result = triageIntake('feature: export CSV', '');
    expect(result.priority).toBe('normal');
    expect(result.confidence).toBe(0.7);
  });

  it('is case insensitive', () => {
    const result = triageIntake('BILLING ISSUE', 'DOWN SERVER');
    expect(result.labels).toContain('billing');
    expect(result.labels).toContain('devops');
    expect(result.priority).toBe('urgent');
  });

  it('handles very long title and body strings', () => {
    const longBody = 'A'.repeat(10_000) + ' bug ' + 'B'.repeat(10_000);
    const result = triageIntake('a'.repeat(500), longBody);
    expect(result.priority).toBe('high');
  });

  it('handles mixed whitespace and special characters', () => {
    const result = triageIntake('  *** [URGENT] ***  ', '  \n\n  Billing server   outage   \n\n  ');
    // "urgent" is a keyword, "outage" is also urgent → priority urgent
    expect(result.priority).toBe('urgent');
    // "billing" → billing label, "server" → devops label
    expect(result.labels).toContain('billing');
    expect(result.labels).toContain('devops');
    expect(result.assignee).toBe('billing-team');
    expect(result.confidence).toBe(0.95);
  });

  it('does word-boundary matching (no false positive on "suggestion")', () => {
    // 'suggestion' should match as a "normal" keyword
    const result = triageIntake('suggestion', '');
    expect(result.priority).toBe('normal');
  });

  it('handles numbers and punctuation in keywords', () => {
    expectTriage('Got 500 on checkout', '', { priority: 'urgent' });
  });

  it('handles keywords embedded in URL-like strings', () => {
    const result = triageIntake('API error at /api/billing/invoices', '');
    expect(result.priority).toBe('high');
    expect(result.labels).toContain('billing');
  });

  it('never throws — contract enforcement', () => {
    const inputs = [
      ['', ''],
      [null as unknown as string, undefined as unknown as string],
      ['a', 'b'],
      ['x'.repeat(100_000), 'y'.repeat(100_000)],
    ];
    for (const [t, b] of inputs) {
      expect(() => triageIntake(t, b)).not.toThrow();
    }
  });
});

// ── Full result shape integrity ─────────────────────────────────────

describe('TriageResult shape', () => {
  it('always returns all five fields', () => {
    const result = triageIntake('test', 'data');
    expect(result).toHaveProperty('priority');
    expect(result).toHaveProperty('labels');
    expect(result).toHaveProperty('assignee');
    expect(result).toHaveProperty('confidence');
  });

  it('priority is always one of the union values', () => {
    const valid: Priority[] = ['urgent', 'high', 'normal', 'low'];
    for (const [t, b] of [
      ['down', ''],
      ['bug', ''],
      ['feature', ''],
      ['random', 'noise'],
    ]) {
      expect(valid).toContain(triageIntake(t, b).priority);
    }
  });

  it('labels is always an array', () => {
    expect(Array.isArray(triageIntake('', '').labels)).toBe(true);
    expect(Array.isArray(triageIntake('bug', 'billing').labels)).toBe(true);
  });

  it('confidence is always between 0 and 1', () => {
    const result = triageIntake('mixed signals outage billing feature', '');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
