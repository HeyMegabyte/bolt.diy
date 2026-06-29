import {
  classifyBounce,
  mapSesToSuppressions,
  type SesBounceNotification,
  type SuppressionEvent,
} from '../services/suppression_sync.js';

const NOW = 1_717_000_000_000; // Deterministic timestamp for all tests

describe('classifyBounce', () => {
  it('maps Permanent to bounce_permanent', () => {
    expect(classifyBounce('Permanent')).toBe('bounce_permanent');
  });

  it('maps Undetermined to bounce_permanent', () => {
    expect(classifyBounce('Undetermined')).toBe('bounce_permanent');
  });

  it('maps Transient to bounce_transient', () => {
    expect(classifyBounce('Transient')).toBe('bounce_transient');
  });

  it('maps anything else to bounce_transient', () => {
    expect(classifyBounce('')).toBe('bounce_transient');
    expect(classifyBounce('Unknown')).toBe('bounce_transient');
    expect(classifyBounce('some_garbage')).toBe('bounce_transient');
  });
});

describe('mapSesToSuppressions', () => {
  it('maps a permanent bounce to bounce_permanent', () => {
    const result = mapSesToSuppressions(
      {
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: 'user@example.com' }],
        },
      },
      NOW,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.email).toBe('user@example.com');
    expect(result[0]!.reason).toBe('bounce_permanent');
    expect(result[0]!.detail).toBe('Permanent bounce');
    expect(result[0]!.source).toBe('ses');
    expect(result[0]!.occurredAt).toBe(new Date(NOW).toISOString());
  });

  it('maps a transient bounce to bounce_transient', () => {
    const result = mapSesToSuppressions(
      {
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Transient',
          bouncedRecipients: [{ emailAddress: 'user@example.com' }],
        },
      },
      NOW,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.reason).toBe('bounce_transient');
    expect(result[0]!.detail).toBe('Transient bounce');
  });

  it('maps a complaint to complaint', () => {
    const result = mapSesToSuppressions(
      {
        notificationType: 'Complaint',
        complaint: {
          complainedRecipients: [{ emailAddress: 'spammy@example.com' }],
        },
      },
      NOW,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.email).toBe('spammy@example.com');
    expect(result[0]!.reason).toBe('complaint');
    expect(result[0]!.detail).toBe('Complaint');
  });

  it('includes complaintFeedbackType in detail when present', () => {
    const result = mapSesToSuppressions(
      {
        notificationType: 'Complaint',
        complaint: {
          complainedRecipients: [{ emailAddress: 'abuse@example.com' }],
          complaintFeedbackType: 'abuse',
        },
      },
      NOW,
    );

    expect(result[0]!.detail).toBe('Complaint: abuse');
  });

  it('returns [] for unknown notificationType', () => {
    const result = mapSesToSuppressions({ notificationType: 'Open' }, NOW);
    expect(result).toEqual([]);
  });

  it('handles multiple recipients in a bounce notification', () => {
    const result = mapSesToSuppressions(
      {
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [
            { emailAddress: 'alice@example.com' },
            { emailAddress: 'bob@example.com' },
            { emailAddress: 'carol@example.com' },
          ],
        },
      },
      NOW,
    );

    expect(result).toHaveLength(3);
    expect(result[0]!.email).toBe('alice@example.com');
    expect(result[1]!.email).toBe('bob@example.com');
    expect(result[2]!.email).toBe('carol@example.com');
    expect(result.every((e) => e.reason === 'bounce_permanent')).toBe(true);
  });

  it('handles multiple recipients in a complaint notification', () => {
    const result = mapSesToSuppressions(
      {
        notificationType: 'Complaint',
        complaint: {
          complainedRecipients: [
            { emailAddress: 'x@example.com' },
            { emailAddress: 'y@example.com' },
          ],
        },
      },
      NOW,
    );

    expect(result).toHaveLength(2);
    expect(result.every((e) => e.reason === 'complaint')).toBe(true);
  });

  it('skips recipients with empty email', () => {
    const result = mapSesToSuppressions(
      {
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [
            { emailAddress: '' },
            { emailAddress: '   ' },
            { emailAddress: 'valid@example.com' },
          ],
        },
      },
      NOW,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.email).toBe('valid@example.com');
  });

  it('truncates diagnosticCode at 200 characters', () => {
    const longCode = 'x'.repeat(500);
    const result = mapSesToSuppressions(
      {
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: 'user@example.com', diagnosticCode: longCode }],
        },
      },
      NOW,
    );

    expect(result[0]!.detail).toBe(`Permanent bounce: ${'x'.repeat(200)}`);
  });

  it('includes diagnosticCode in detail when present and short', () => {
    const result = mapSesToSuppressions(
      {
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Transient',
          bouncedRecipients: [{ emailAddress: 'user@example.com', diagnosticCode: 'mailbox full' }],
        },
      },
      NOW,
    );

    expect(result[0]!.detail).toBe('Transient bounce: mailbox full');
  });

  it('uses nowMs fallback to Date.now() when not passed', () => {
    const before = Date.now();
    const result = mapSesToSuppressions({
      notificationType: 'Bounce',
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [{ emailAddress: 'a@b.com' }],
      },
    });
    const after = Date.now();

    expect(result).toHaveLength(1);
    const occurred = new Date(result[0]!.occurredAt).getTime();
    expect(occurred).toBeGreaterThanOrEqual(before);
    expect(occurred).toBeLessThanOrEqual(after);
  });

  it('never throws on null/undefined/empty notification', () => {
    expect(() => mapSesToSuppressions(null, NOW)).not.toThrow();
    expect(() => mapSesToSuppressions(undefined, NOW)).not.toThrow();
    // @ts-expect-error Testing runtime resilience — non-object input
    expect(() => mapSesToSuppressions('', NOW)).not.toThrow();
    // @ts-expect-error Testing runtime resilience — numeric input
    expect(() => mapSesToSuppressions(42, NOW)).not.toThrow();
  });

  it('returns [] for null/undefined input', () => {
    expect(mapSesToSuppressions(null, NOW)).toEqual([]);
    expect(mapSesToSuppressions(undefined, NOW)).toEqual([]);
  });

  it('returns [] when bounce object is missing on a Bounce notification', () => {
    const result = mapSesToSuppressions({ notificationType: 'Bounce' }, NOW);
    expect(result).toEqual([]);
  });

  it('returns [] when complaint object is missing on a Complaint notification', () => {
    const result = mapSesToSuppressions({ notificationType: 'Complaint' }, NOW);
    expect(result).toEqual([]);
  });

  it('returns [] when bouncedRecipients is empty', () => {
    const result = mapSesToSuppressions(
      {
        notificationType: 'Bounce',
        bounce: { bounceType: 'Permanent', bouncedRecipients: [] },
      },
      NOW,
    );
    expect(result).toEqual([]);
  });

  it('returns [] when complainedRecipients is empty', () => {
    const result = mapSesToSuppressions(
      {
        notificationType: 'Complaint',
        complaint: { complainedRecipients: [] },
      },
      NOW,
    );
    expect(result).toEqual([]);
  });
});
