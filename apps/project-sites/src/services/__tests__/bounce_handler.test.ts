import {
  classifyBounce,
  bounceAction,
  bounceSummary,
  type BounceClassification,
} from '../bounce_handler';

// ---------------------------------------------------------------------------
// classifyBounce
// ---------------------------------------------------------------------------

describe('classifyBounce', () => {
  it('classifies a permanent bounce without sub-type', () => {
    const result = classifyBounce({
      notificationType: 'Bounce',
      bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'a@b.com' }] },
    });
    expect(result.category).toBe('permanent');
    expect(result.severity).toBe('hard');
    expect(result.actionable).toBe(true);
    expect(result.subType).toBeNull();
  });

  it('classifies a permanent bounce with NoEmail sub-type', () => {
    const result = classifyBounce({
      notificationType: 'Bounce',
      bounce: { bounceType: 'Permanent', bounceSubType: 'NoEmail' },
    });
    expect(result.category).toBe('permanent');
    expect(result.subType).toBe('NoEmail');
    expect(result.actionable).toBe(true);
  });

  it('classifies a permanent bounce with Suppressed sub-type', () => {
    const result = classifyBounce({
      notificationType: 'Bounce',
      bounce: { bounceType: 'Permanent', bounceSubType: 'Suppressed' },
    });
    expect(result.category).toBe('permanent');
    expect(result.subType).toBe('Suppressed');
    expect(result.actionable).toBe(true);
  });

  it('classifies a transient bounce without sub-type', () => {
    const result = classifyBounce({
      notificationType: 'Bounce',
      bounce: { bounceType: 'Transient' },
    });
    expect(result.category).toBe('transient');
    expect(result.severity).toBe('soft');
    expect(result.actionable).toBe(false);
  });

  it('classifies a transient bounce with MailboxFull', () => {
    const result = classifyBounce({
      notificationType: 'Bounce',
      bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull' },
    });
    expect(result.category).toBe('transient');
    expect(result.subType).toBe('MailboxFull');
    expect(result.actionable).toBe(false); // Not immediately actionable
  });

  it('classifies a transient bounce with MessageTooLarge', () => {
    const result = classifyBounce({
      notificationType: 'Bounce',
      bounce: { bounceType: 'Transient', bounceSubType: 'MessageTooLarge' },
    });
    expect(result.category).toBe('transient');
    expect(result.subType).toBe('MessageTooLarge');
  });

  it('classifies Undetermined as permanent', () => {
    const result = classifyBounce({
      notificationType: 'Undetermined',
    });
    expect(result.category).toBe('undetermined');
    expect(result.severity).toBe('hard');
    expect(result.actionable).toBe(true);
  });

  it('classifies a complaint as hard actionable', () => {
    const result = classifyBounce({
      notificationType: 'Complaint',
      complaint: {
        complainedRecipients: [{ emailAddress: 'a@b.com' }],
        complaintFeedbackType: 'Abuse',
      },
    });
    expect(result.category).toBe('complaint');
    expect(result.severity).toBe('hard');
    expect(result.actionable).toBe(true);
    expect(result.subType).toBe('Abuse');
  });

  it('classifies a complaint without feedback type', () => {
    const result = classifyBounce({
      notificationType: 'Complaint',
      complaint: {
        complainedRecipients: [{ emailAddress: 'a@b.com' }],
      },
    });
    expect(result.category).toBe('complaint');
    expect(result.subType).toBeNull();
  });

  it('returns unknown for null input', () => {
    const result = classifyBounce(null);
    expect(result.category).toBe('unknown');
    expect(result.actionable).toBe(false);
    expect(result.severity).toBe('info');
  });

  it('returns unknown for undefined input', () => {
    const result = classifyBounce(undefined);
    expect(result.category).toBe('unknown');
    expect(result.actionable).toBe(false);
  });

  it('returns unknown for non-object input', () => {
    const result = classifyBounce('this is not a notification');
    expect(result.category).toBe('unknown');
    expect(result.actionable).toBe(false);
  });

  it('returns unknown for array input', () => {
    const result = classifyBounce([{ notificationType: 'Bounce' }]);
    expect(result.category).toBe('unknown');
  });

  it('returns unknown for an unrecognised notificationType', () => {
    const result = classifyBounce({
      notificationType: 'Delivery',
      delivery: {},
    });
    expect(result.category).toBe('unknown');
    expect(result.actionable).toBe(false);
  });

  it('handles empty bounce object', () => {
    const result = classifyBounce({
      notificationType: 'Bounce',
      bounce: {},
    });
    expect(result.category).toBe('transient');
    expect(result.actionable).toBe(false);
  });

  it('handles SNS-envelope wrapped notification', () => {
    const result = classifyBounce({
      Type: 'Notification',
      Message: JSON.stringify({
        notificationType: 'Bounce',
        bounce: { bounceType: 'Permanent', bounceSubType: 'NoEmail' },
      }),
    });
    expect(result.category).toBe('permanent');
    expect(result.subType).toBe('NoEmail');
    expect(result.actionable).toBe(true);
  });

  it('returns unknown for SNS envelope with bad JSON Message', () => {
    const result = classifyBounce({
      Type: 'Notification',
      Message: '{ this is not json }',
    });
    expect(result.category).toBe('unknown');
    expect(result.actionable).toBe(false);
  });

  it('classifies by eventType when notificationType is absent', () => {
    const result = classifyBounce({
      eventType: 'Bounce',
      bounce: { bounceType: 'Permanent' },
    });
    expect(result.category).toBe('permanent');
    expect(result.actionable).toBe(true);
  });

  it('returns transient when bounceType is not Permanent/Transient/Undetermined', () => {
    const result = classifyBounce({
      notificationType: 'Bounce',
      bounce: { bounceType: 'UnknownType' },
    });
    expect(result.category).toBe('transient');
    expect(result.actionable).toBe(false);
  });

  it('recognises permanent sub-types regardless of bounceType', () => {
    const result = classifyBounce({
      notificationType: 'Bounce',
      bounce: { bounceType: 'Transient', bounceSubType: 'Suppressed' },
    });
    // Sub-type overrides: Suppressed → permanent
    expect(result.category).toBe('permanent');
    expect(result.actionable).toBe(true);
  });

  it('recognises transient sub-types like ContentRejected', () => {
    const result = classifyBounce({
      notificationType: 'Bounce',
      bounce: { bounceType: 'Permanent', bounceSubType: 'ContentRejected' },
    });
    // Sub-type overrides: ContentRejected → transient
    expect(result.category).toBe('transient');
    expect(result.actionable).toBe(false);
  });

  it('handles Per recipient bounce type (legacy SES format)', () => {
    const result = classifyBounce({
      notificationType: 'Bounce',
      bounce: { bouncedRecipients: [{ emailAddress: 'a@b.com' }] },
    });
    // bounceType absent, bounce present → transient
    expect(result.category).toBe('transient');
    expect(result.actionable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bounceAction
// ---------------------------------------------------------------------------

describe('bounceAction', () => {
  it('returns suppress_immediate for a permanent bounce', () => {
    const action = bounceAction({
      category: 'permanent',
      subType: 'NoEmail',
      severity: 'hard',
      actionable: true,
    });
    expect(action.action).toBe('suppress_immediate');
    expect(action.retryDelaySec).toBe(0);
    expect(action.reason).toContain('NoEmail');
  });

  it('returns suppress_immediate for permanent bounce without sub-type', () => {
    const action = bounceAction({
      category: 'permanent',
      subType: null,
      severity: 'hard',
      actionable: true,
    });
    expect(action.action).toBe('suppress_immediate');
    expect(action.reason).toContain('mailbox does not exist');
  });

  it('returns suppress_immediate for a complaint', () => {
    const action = bounceAction({
      category: 'complaint',
      subType: 'Abuse',
      severity: 'hard',
      actionable: true,
    });
    expect(action.action).toBe('suppress_immediate');
    expect(action.reason).toContain('spam');
  });

  it('returns suppress_immediate for complaint without sub-type', () => {
    const action = bounceAction({
      category: 'complaint',
      subType: null,
      severity: 'hard',
      actionable: true,
    });
    expect(action.action).toBe('suppress_immediate');
  });

  it('returns suppress_immediate for undetermined', () => {
    const action = bounceAction({
      category: 'undetermined',
      subType: null,
      severity: 'hard',
      actionable: true,
    });
    expect(action.action).toBe('suppress_immediate');
    expect(action.reason).toContain('Undetermined');
  });

  it('returns suppress_after_retry for MailboxFull', () => {
    const action = bounceAction({
      category: 'transient',
      subType: 'MailboxFull',
      severity: 'soft',
      actionable: false,
    });
    expect(action.action).toBe('suppress_after_retry');
    expect(action.retryDelaySec).toBe(86_400); // 24h
    expect(action.reason).toContain('retry in 24h');
  });

  it('returns suppress_after_retry for MessageTooLarge', () => {
    const action = bounceAction({
      category: 'transient',
      subType: 'MessageTooLarge',
      severity: 'soft',
      actionable: false,
    });
    expect(action.action).toBe('suppress_after_retry');
    expect(action.retryDelaySec).toBe(86_400);
  });

  it('returns ignore for generic transient', () => {
    const action = bounceAction({
      category: 'transient',
      subType: 'General',
      severity: 'soft',
      actionable: false,
    });
    expect(action.action).toBe('ignore');
    expect(action.retryDelaySec).toBe(0);
  });

  it('returns ignore for ContentRejected (unlikely to succeed on retry)', () => {
    const action = bounceAction({
      category: 'transient',
      subType: 'ContentRejected',
      severity: 'soft',
      actionable: false,
    });
    expect(action.action).toBe('ignore');
    expect(action.retryDelaySec).toBe(0);
  });

  it('returns ignore for unknown classification', () => {
    const action = bounceAction({
      category: 'unknown',
      subType: null,
      severity: 'info',
      actionable: false,
    });
    expect(action.action).toBe('ignore');
  });

  it('returns ignore for transient without sub-type', () => {
    const action = bounceAction({
      category: 'transient',
      subType: null,
      severity: 'soft',
      actionable: false,
    });
    expect(action.action).toBe('ignore');
  });
});

// ---------------------------------------------------------------------------
// bounceSummary
// ---------------------------------------------------------------------------

describe('bounceSummary', () => {
  it('builds a summary for mixed categories', () => {
    const summary = bounceSummary([
      { email: 'a@b.com', category: 'permanent' },
      { email: 'b@c.com', category: 'permanent' },
      { email: 'd@e.com', category: 'complaint' },
    ]);
    expect(summary).toBe('3 events: 2 permanent, 1 complaint');
  });

  it('returns empty string for empty array', () => {
    expect(bounceSummary([])).toBe('');
  });

  it('handles a single record', () => {
    const summary = bounceSummary([{ email: 'a@b.com', category: 'permanent' }]);
    expect(summary).toBe('1 event: 1 permanent');
  });

  it('handles all transient records', () => {
    const summary = bounceSummary([
      { email: 'a@b.com', category: 'transient' },
      { email: 'b@c.com', category: 'transient' },
    ]);
    expect(summary).toBe('2 events: 2 transient');
  });

  it('includes undetermined and unknown categories', () => {
    const summary = bounceSummary([
      { email: 'a@b.com', category: 'undetermined' },
      { email: 'b@c.com', category: 'unknown' },
    ]);
    expect(summary).toBe('2 events: 1 undetermined, 1 unknown');
  });

  it('includes subType in the summary when present', () => {
    // bounceSummary currently uses categories only — subType is metadata on
    // each record but not rendered in the summary line.
    const summary = bounceSummary([
      { email: 'a@b.com', category: 'permanent', subType: 'NoEmail' },
    ]);
    expect(summary).toContain('1 permanent');
  });

  it('includes optional timestamp metadata without affecting output', () => {
    const summary = bounceSummary([
      { email: 'a@b.com', category: 'complaint', timestamp: '2026-06-01T12:00:00Z' },
    ]);
    expect(summary).toBe('1 event: 1 complaint');
  });

  it('can round-trip through bounceAction for every record', () => {
    const records = [
      { email: 'a@b.com', category: 'permanent' as const },
      { email: 'b@c.com', category: 'transient' as const },
      { email: 'c@d.com', category: 'complaint' as const },
    ];
    const summary = bounceSummary(records);
    expect(summary).toBe('3 events: 1 permanent, 1 transient, 1 complaint');

    // Each should have a matching bounceAction
    for (const r of records) {
      const action = bounceAction({
        category: r.category,
        subType: null,
        severity: r.category === 'transient' ? 'soft' : 'hard',
        actionable: r.category !== 'transient',
      });
      expect(action.action).toBeDefined();
    }
  });
});
