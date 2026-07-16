import { auditNapConsistency, suggestReplies, runLocalSeoAudit } from '../service.js';

describe('auditNapConsistency', () => {
  const canonical = { source: 'website', name: "Tony's Pizza", address: '123 Main St, Brooklyn, NY 11201', phone: '(718) 555-0123' };

  test('returns no discrepancies for matching records', () => {
    const sources = [{ source: 'google', name: "Tony's Pizza", address: '123 Main St, Brooklyn, NY 11201', phone: '(718) 555-0123' }];
    expect(auditNapConsistency(canonical, sources)).toHaveLength(0);
  });

  test('detects name mismatch as critical', () => {
    const sources = [{ source: 'yelp', name: "Tony's Pizzeria", address: '123 Main St, Brooklyn, NY 11201', phone: '(718) 555-0123' }];
    const d = auditNapConsistency(canonical, sources);
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe('critical');
    expect(d[0].field).toBe('name');
  });

  test('detects phone mismatch as critical', () => {
    const sources = [{ source: 'facebook', name: "Tony's Pizza", address: '123 Main St, Brooklyn, NY 11201', phone: '(718) 555-9999' }];
    const d = auditNapConsistency(canonical, sources);
    expect(d).toHaveLength(1);
    expect(d[0].field).toBe('phone');
  });

  test('detects address mismatch as warning', () => {
    const sources = [{ source: 'bing', name: "Tony's Pizza", address: '456 Other Ave, Brooklyn, NY 11201', phone: '(718) 555-0123' }];
    const d = auditNapConsistency(canonical, sources);
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe('warning');
  });

  test('handles multiple sources with multiple discrepancies', () => {
    const sources = [
      { source: 'yelp', name: "Tony's Pizzeria", address: '123 Main St, Brooklyn, NY 11201', phone: '(718) 555-9999' },
      { source: 'google', name: "Tony's Pizza", address: '456 Other Ave, Brooklyn, NY 11201', phone: '(718) 555-0123' },
    ];
    expect(auditNapConsistency(canonical, sources).length).toBeGreaterThanOrEqual(2);
  });
});

describe('suggestReplies', () => {
  test('5-star review gets grateful reply', () => {
    const r = suggestReplies([{ text: 'Amazing!', rating: 5, reviewerName: 'Alice', platform: 'Google' }]);
    expect(r[0].tone).toBe('grateful');
    expect(r[0].suggestedReply).toContain('Alice');
  });

  test('4-star review asks what would earn 5th star', () => {
    const r = suggestReplies([{ text: 'Good!', rating: 4, reviewerName: 'Bob', platform: 'Yelp' }]);
    expect(r[0].tone).toBe('grateful');
    expect(r[0].suggestedReply).toContain('fifth star');
  });

  test('2-3 star review gets apologetic reply', () => {
    const r = suggestReplies([{ text: 'Okay', rating: 2, reviewerName: 'Carol', platform: 'Google' }]);
    expect(r[0].tone).toBe('apologetic');
    expect(r[0].suggestedReply).toContain('sorry');
  });

  test('1-star review gets sincere apology', () => {
    const r = suggestReplies([{ text: 'Terrible', rating: 1, reviewerName: 'Dave', platform: 'Facebook' }]);
    expect(r[0].tone).toBe('apologetic');
    expect(r[0].suggestedReply).toContain('truly sorry');
  });

  test('all replies include keyPoints', () => {
    const reviews = [
      { text: 'a', rating: 5, reviewerName: 'A', platform: 'G' },
      { text: 'b', rating: 1, reviewerName: 'B', platform: 'Y' },
    ];
    const r = suggestReplies(reviews);
    for (const s of r) expect(s.keyPoints.length).toBeGreaterThan(0);
  });
});

describe('runLocalSeoAudit', () => {
  test('complete audit returns all sections', () => {
    const audit = runLocalSeoAudit('s1',
      { source: 'web', name: 'Cafe', address: '1 Main', phone: '555-0100' },
      [{ source: 'google', name: 'Cafe', address: '1 Main', phone: '555-0100' }],
      [{ text: 'Great', rating: 5, reviewerName: 'Eve', platform: 'Google' }],
    );
    expect(audit.discrepancyCount).toBe(0);
    expect(audit.reviewSuggestions).toHaveLength(1);
    expect(audit.directoryCoverage.claimed).toBe(1);
    expect(audit.summary).toBeTruthy();
  });
});
