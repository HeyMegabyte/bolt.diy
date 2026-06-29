import {
  ledgerItemToIssue,
  fireReportToComment,
  summarizeFires,
  type LedgerItem,
  type FireReport,
  type PlaneIssue,
} from '../services/loop_plane';

// ---------------------------------------------------------------------------
// ledgerItemToIssue
// ---------------------------------------------------------------------------
describe('ledgerItemToIssue', () => {
  it('uses the line as the title and description', () => {
    const item: LedgerItem = { line: 'Deploy new dashboard', checked: false };
    const issue = ledgerItemToIssue(item);

    expect(issue.title).toBe('Deploy new dashboard');
    expect(issue.description).toBe('Deploy new dashboard');
  });

  it('sets medium priority with no tag and unchecked', () => {
    const issue = ledgerItemToIssue({ line: 'Fix login bug', checked: false });
    expect(issue.priority).toBe('medium');
  });

  it('sets low priority with no tag and checked', () => {
    const issue = ledgerItemToIssue({ line: 'Fix login bug', checked: true });
    expect(issue.priority).toBe('low');
  });

  it('maps P0 tag to urgent priority', () => {
    const issue = ledgerItemToIssue({ line: 'Security patch', checked: false, tag: 'P0' });
    expect(issue.priority).toBe('urgent');
  });

  it('maps P1 tag to high priority', () => {
    const issue = ledgerItemToIssue({ line: 'Revenue fix', checked: false, tag: 'P1' });
    expect(issue.priority).toBe('high');
  });

  it('maps P2 tag to medium priority', () => {
    const issue = ledgerItemToIssue({ line: 'Refactor module', checked: false, tag: 'P2' });
    expect(issue.priority).toBe('medium');
  });

  it('maps P3 tag to low priority', () => {
    const issue = ledgerItemToIssue({ line: 'Clean up logs', checked: false, tag: 'P3' });
    expect(issue.priority).toBe('low');
  });

  it('adds done label when checked', () => {
    const issue = ledgerItemToIssue({ line: 'Shipped feature', checked: true });
    expect(issue.labels).toContain('done');
  });

  it('does not add done label when unchecked', () => {
    const issue = ledgerItemToIssue({ line: 'Pending work', checked: false });
    expect(issue.labels).not.toContain('done');
  });

  it('splits comma-separated tag into multiple labels', () => {
    const issue = ledgerItemToIssue({
      line: 'Multi-labelled',
      checked: false,
      tag: 'bug,frontend',
    });
    expect(issue.labels).toEqual(['bug', 'frontend']);
  });

  it('truncates title over 100 chars', () => {
    const longLine = 'A'.repeat(120);
    const issue = ledgerItemToIssue({ line: longLine, checked: false });
    expect(issue.title).toHaveLength(100);
    expect(issue.title.endsWith('...')).toBe(true);
    expect(issue.title).toBe('A'.repeat(97) + '...');
  });

  it('handles empty line gracefully', () => {
    const item = { line: '', checked: false } as LedgerItem;
    const issue = ledgerItemToIssue(item);

    expect(issue.title).toBe('');
    expect(issue.description).toBe('(empty)');
    expect(issue.priority).toBe('medium');
    expect(issue.labels).toEqual([]);
  });

  it('handles malformed object without throwing', () => {
    const issue = ledgerItemToIssue(null as never);
    expect(issue.title).toBe('');
    expect(issue.description).toBe('(empty)');
    expect(issue.priority).toBe('medium');
    expect(issue.labels).toEqual([]);
  });

  it('handles undefined item without throwing', () => {
    const issue = ledgerItemToIssue(undefined as never);
    expect(issue.title).toBe('');
    expect(issue.description).toBe('(empty)');
  });
});

// ---------------------------------------------------------------------------
// fireReportToComment
// ---------------------------------------------------------------------------
describe('fireReportToComment', () => {
  it('formats a fire report as markdown', () => {
    const comment = fireReportToComment({ tickedCount: 5, parkedCount: 2, elapsedMs: 300_000 });

    expect(comment).toBe('**/loop fire**\n- Ticked: 5\n- Parked: 2\n- Duration: 5m 0s');
  });

  it('handles zero values', () => {
    const comment = fireReportToComment({ tickedCount: 0, parkedCount: 0, elapsedMs: 0 });

    expect(comment).toContain('Ticked: 0');
    expect(comment).toContain('Parked: 0');
    expect(comment).toContain('Duration: 0s');
  });

  it('coerces undefined or missing fields safely', () => {
    const comment = fireReportToComment({} as FireReport);

    expect(comment).toContain('Ticked: 0');
    expect(comment).toContain('Parked: 0');
  });

  it('formats sub-second elapsedMs', () => {
    const comment = fireReportToComment({ tickedCount: 1, parkedCount: 0, elapsedMs: 500 });
    expect(comment).toContain('Duration: 0s');
  });

  it('formats elapsedMs over one minute', () => {
    const comment = fireReportToComment({ tickedCount: 3, parkedCount: 1, elapsedMs: 90_000 });
    expect(comment).toContain('Duration: 1m 30s');
  });

  it('formats elapsedMs exactly one hour', () => {
    const comment = fireReportToComment({ tickedCount: 10, parkedCount: 0, elapsedMs: 3_600_000 });
    expect(comment).toContain('Duration: 60m 0s');
  });
});

// ---------------------------------------------------------------------------
// summarizeFires
// ---------------------------------------------------------------------------
describe('summarizeFires', () => {
  it('returns fallback for empty array', () => {
    expect(summarizeFires([])).toBe('No fires recorded this cycle.');
  });

  it('returns fallback for non-array input', () => {
    expect(summarizeFires(null as never)).toBe('No fires recorded this cycle.');
  });

  it('summarizes a single fire report', () => {
    const reports: FireReport[] = [{ tickedCount: 4, parkedCount: 1, elapsedMs: 120_000 }];
    const note = summarizeFires(reports);

    expect(note).toContain('**Total fires:** 1');
    expect(note).toContain('**Total ticked:** 4');
    expect(note).toContain('**Total parked:** 1');
    expect(note).toContain('**Total duration:** 2m 0s');
    expect(note).toContain('**Avg ticked/fire:** 4.0');
  });

  it('aggregates multiple fire reports', () => {
    const reports: FireReport[] = [
      { tickedCount: 3, parkedCount: 1, elapsedMs: 120_000 },
      { tickedCount: 5, parkedCount: 2, elapsedMs: 300_000 },
      { tickedCount: 1, parkedCount: 0, elapsedMs: 60_000 },
    ];
    const note = summarizeFires(reports);

    expect(note).toContain('**Total fires:** 3');
    expect(note).toContain('**Total ticked:** 9');
    expect(note).toContain('**Total parked:** 3');
    expect(note).toContain('**Total duration:** 8m 0s');
    expect(note).toContain('**Avg ticked/fire:** 3.0');
    expect(note).toContain('**Avg parked/fire:** 1.0');
    expect(note).toContain('**Avg duration/fire:** 2m 40s');
  });

  it('handles reports with missing fields gracefully', () => {
    const reports = [{ tickedCount: 2 } as FireReport, { parkedCount: 1 } as FireReport];
    const note = summarizeFires(reports);

    expect(note).toContain('**Total fires:** 2');
    expect(note).toContain('**Total ticked:** 2');
    expect(note).toContain('**Total parked:** 1');
  });
});
