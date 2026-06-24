/**
 * §42/ADR-0019 — parseSesNotification deliverability semantics:
 * permanent bounce + complaint suppress; transient bounce does NOT; SNS-wrapped
 * envelopes unwrap; malformed input never throws; recipients dedup + normalize.
 */
import { parseSesNotification } from '../services/ses_notifications.js';

const permanentBounce = {
  notificationType: 'Bounce',
  bounce: {
    bounceType: 'Permanent',
    timestamp: '2026-06-23T10:00:00.000Z',
    bouncedRecipients: [{ emailAddress: 'Gone@Example.com' }],
  },
  mail: { messageId: 'msg-1' },
};

const transientBounce = {
  notificationType: 'Bounce',
  bounce: {
    bounceType: 'Transient',
    bouncedRecipients: [{ emailAddress: 'full@example.com' }],
  },
  mail: { messageId: 'msg-2' },
};

const complaint = {
  notificationType: 'Complaint',
  complaint: {
    complaintFeedbackType: 'abuse',
    timestamp: '2026-06-23T11:00:00.000Z',
    complainedRecipients: [{ emailAddress: 'angry@example.com' }],
  },
  mail: { messageId: 'msg-3' },
};

describe('parseSesNotification', () => {
  it('suppresses a PERMANENT bounce (lowercased + correlated to the SES messageId)', () => {
    expect(parseSesNotification(permanentBounce)).toEqual([
      {
        email: 'gone@example.com',
        reason: 'bounce',
        subType: 'Permanent',
        timestamp: '2026-06-23T10:00:00.000Z',
        sourceMessageId: 'msg-1',
      },
    ]);
  });

  it('does NOT suppress a TRANSIENT bounce (mailbox can recover)', () => {
    expect(parseSesNotification(transientBounce)).toEqual([]);
  });

  it('suppresses a complaint with its feedback sub-type', () => {
    expect(parseSesNotification(complaint)).toEqual([
      {
        email: 'angry@example.com',
        reason: 'complaint',
        subType: 'abuse',
        timestamp: '2026-06-23T11:00:00.000Z',
        sourceMessageId: 'msg-3',
      },
    ]);
  });

  it('unwraps an SNS-wrapped envelope (Type:Notification + stringified Message)', () => {
    const sns = { Type: 'Notification', Message: JSON.stringify(permanentBounce) };
    expect(parseSesNotification(sns)).toEqual([
      expect.objectContaining({ email: 'gone@example.com', reason: 'bounce' }),
    ]);
  });

  it('dedups a recipient SES listed twice', () => {
    const dup = {
      notificationType: 'Complaint',
      complaint: {
        complaintFeedbackType: 'abuse',
        complainedRecipients: [{ emailAddress: 'x@y.com' }, { emailAddress: 'x@y.com' }],
      },
      mail: { messageId: 'm' },
    };
    expect(parseSesNotification(dup)).toHaveLength(1);
  });

  it('returns [] for deliveries and unknown notification types', () => {
    expect(parseSesNotification({ notificationType: 'Delivery', mail: {} })).toEqual([]);
    expect(parseSesNotification({ notificationType: 'Send' })).toEqual([]);
  });

  it('never throws on malformed input', () => {
    expect(parseSesNotification(null)).toEqual([]);
    expect(parseSesNotification('not json')).toEqual([]);
    expect(parseSesNotification({ Type: 'Notification', Message: '{bad json' })).toEqual([]);
    expect(parseSesNotification({ notificationType: 'Bounce' })).toEqual([]);
    expect(
      parseSesNotification({
        notificationType: 'Bounce',
        bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'not-an-email' }] },
      }),
    ).toEqual([]);
  });
});
