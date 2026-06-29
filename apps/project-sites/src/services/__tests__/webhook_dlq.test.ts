import {
  DEAD_LETTER_REASONS,
  DEAD_REASONS,
  REPLAYABLE_REASONS,
  deadLetter,
  replayDead,
  dlqStats,
  type DeadLetterEntry,
  type DeadLetterReason,
} from '../webhook_dlq';

const NOW = '2026-06-29T12:00:00.000Z';

function makeEntry(overrides?: Partial<DeadLetterEntry>): DeadLetterEntry {
  return {
    webhookId: 'ep_abc',
    url: 'https://hooks.example.com/notify',
    eventType: 'site.published',
    attempts: 6,
    lastStatusCode: 503,
    lastError: 'upstream timeout',
    deadLetterTs: NOW,
    deadLetterReason: 'exhausted_retries',
    ...overrides,
  };
}

describe('deadLetter', () => {
  it('creates a DeadLetterEntry with the given fields', () => {
    const entry = deadLetter(
      'ep_abc',
      'https://hooks.example.com/notify',
      'site.published',
      6,
      503,
      'upstream timeout',
      'exhausted_retries',
      NOW,
    );
    expect(entry.webhookId).toBe('ep_abc');
    expect(entry.url).toBe('https://hooks.example.com/notify');
    expect(entry.eventType).toBe('site.published');
    expect(entry.attempts).toBe(6);
    expect(entry.lastStatusCode).toBe(503);
    expect(entry.lastError).toBe('upstream timeout');
    expect(entry.deadLetterTs).toBe(NOW);
    expect(entry.deadLetterReason).toBe('exhausted_retries');
  });

  it('returns a frozen-like readonly shape (plain object)', () => {
    const entry = deadLetter(
      'ep_abc',
      'https://ex.com/hook',
      'site.published',
      6,
      503,
      'timeout',
      'permanent_4xx',
      NOW,
    );
    expect(Object.isFrozen(entry)).toBe(false);
    // The fields are declared readonly at the type level — runtime mutation
    // has no effect on the caller if spread is used.  Verify the value.
    expect(entry.deadLetterReason).toBe('permanent_4xx');
  });

  it.each([
    { reason: 'exhausted_retries' as DeadLetterReason, attempts: 6, status: 503, error: 'timeout' },
    { reason: 'permanent_4xx' as DeadLetterReason, attempts: 1, status: 404, error: 'Not Found' },
    { reason: 'unsafe_url' as DeadLetterReason, attempts: 1, status: 0, error: null },
    { reason: 'sign_error' as DeadLetterReason, attempts: 3, status: 0, error: 'decrypt failed' },
    { reason: 'manual' as DeadLetterReason, attempts: 2, status: 502, error: 'bad gateway' },
  ])(
    'accepts reason "$reason" and preserves lastStatusCode/error',
    ({ reason, attempts, status, error }) => {
      const entry = deadLetter(
        'ep_x',
        'https://ex.com/hook',
        'form.submitted',
        attempts,
        status,
        error,
        reason,
        NOW,
      );
      expect(entry.deadLetterReason).toBe(reason);
      expect(entry.attempts).toBe(attempts);
      expect(entry.lastStatusCode).toBe(status);
      expect(entry.lastError).toBe(error);
    },
  );

  it('defaults deadLetterTs to now-ish when omitted', () => {
    const before = Date.now();
    const entry = deadLetter(
      'ep_abc',
      'https://ex.com/hook',
      'site.published',
      1,
      0,
      null,
      'manual',
    );
    const after = Date.now();
    const entryTs = new Date(entry.deadLetterTs).getTime();
    expect(entryTs).toBeGreaterThanOrEqual(before - 1);
    expect(entryTs).toBeLessThanOrEqual(after + 1);
  });

  it('uses the provided nowIso when given', () => {
    const customTs = '2026-01-01T00:00:00.000Z';
    const entry = deadLetter(
      'ep_abc',
      'https://ex.com/hook',
      'site.published',
      1,
      0,
      null,
      'manual',
      customTs,
    );
    expect(entry.deadLetterTs).toBe(customTs);
  });
});

describe('replayDead', () => {
  it('resets a replayable entry (exhausted_retries) to fresh state', () => {
    const entry = makeEntry({ deadLetterReason: 'exhausted_retries' });
    const replay = replayDead(entry, NOW);
    expect(replay).not.toBeNull();
    expect(replay!.webhookId).toBe('ep_abc');
    expect(replay!.url).toBe('https://hooks.example.com/notify');
    expect(replay!.eventType).toBe('site.published');
    expect(replay!.attempts).toBe(0);
    expect(replay!.lastStatusCode).toBe(0);
    expect(replay!.lastError).toBeNull();
    expect(replay!.deadLetterReason).toBe('manual');
    expect(replay!.deadLetterTs).toBe(NOW);
  });

  it('resets a sign_error entry to fresh state', () => {
    const entry = makeEntry({ deadLetterReason: 'sign_error' });
    const replay = replayDead(entry, NOW);
    expect(replay).not.toBeNull();
    expect(replay!.attempts).toBe(0);
    expect(replay!.deadLetterReason).toBe('manual');
  });

  it('resets a manual entry to fresh state', () => {
    const entry = makeEntry({ deadLetterReason: 'manual' });
    const replay = replayDead(entry, NOW);
    expect(replay).not.toBeNull();
    expect(replay!.attempts).toBe(0);
    expect(replay!.deadLetterReason).toBe('manual');
  });

  it('returns null for permanent_4xx entries', () => {
    const entry = makeEntry({ deadLetterReason: 'permanent_4xx' });
    expect(replayDead(entry)).toBeNull();
  });

  it('returns null for unsafe_url entries', () => {
    const entry = makeEntry({ deadLetterReason: 'unsafe_url' });
    expect(replayDead(entry)).toBeNull();
  });

  it('does not mutate the original entry', () => {
    const entry = makeEntry({ deadLetterReason: 'exhausted_retries', attempts: 6 });
    const originalAttempts = entry.attempts;
    replayDead(entry, NOW);
    expect(entry.attempts).toBe(originalAttempts);
    expect(entry.deadLetterReason).toBe('exhausted_retries');
  });

  it('defaults deadLetterTs to now-ish when omitted', () => {
    const entry = makeEntry({ deadLetterReason: 'exhausted_retries' });
    const before = Date.now();
    const replay = replayDead(entry);
    const after = Date.now();
    expect(replay).not.toBeNull();
    const replayTs = new Date(replay!.deadLetterTs).getTime();
    expect(replayTs).toBeGreaterThanOrEqual(before - 1);
    expect(replayTs).toBeLessThanOrEqual(after + 1);
  });
});

describe('dlqStats', () => {
  it('returns zeros for an empty array', () => {
    expect(dlqStats([])).toEqual({ total: 0, replayable: 0, dead: 0 });
  });

  it('counts a single replayable entry', () => {
    const entries = [makeEntry({ deadLetterReason: 'exhausted_retries' })];
    expect(dlqStats(entries)).toEqual({ total: 1, replayable: 1, dead: 0 });
  });

  it('counts a single dead entry', () => {
    const entries = [makeEntry({ deadLetterReason: 'permanent_4xx' })];
    expect(dlqStats(entries)).toEqual({ total: 1, replayable: 0, dead: 1 });
  });

  it('counts a single unsafe_url entry as dead', () => {
    const entries = [makeEntry({ deadLetterReason: 'unsafe_url' })];
    expect(dlqStats(entries)).toEqual({ total: 1, replayable: 0, dead: 1 });
  });

  it('treats sign_error as replayable', () => {
    const entries = [makeEntry({ deadLetterReason: 'sign_error' })];
    expect(dlqStats(entries)).toEqual({ total: 1, replayable: 1, dead: 0 });
  });

  it('treats manual as replayable', () => {
    const entries = [makeEntry({ deadLetterReason: 'manual' })];
    expect(dlqStats(entries)).toEqual({ total: 1, replayable: 1, dead: 0 });
  });

  it('correctly splits mixed entries', () => {
    const entries = [
      makeEntry({ webhookId: 'a', deadLetterReason: 'exhausted_retries' }),
      makeEntry({ webhookId: 'b', deadLetterReason: 'permanent_4xx' }),
      makeEntry({ webhookId: 'c', deadLetterReason: 'sign_error' }),
      makeEntry({ webhookId: 'd', deadLetterReason: 'unsafe_url' }),
      makeEntry({ webhookId: 'e', deadLetterReason: 'manual' }),
    ];
    expect(dlqStats(entries)).toEqual({ total: 5, replayable: 3, dead: 2 });
  });

  it('does not mutate the input array', () => {
    const entries = [
      makeEntry({ webhookId: 'a', deadLetterReason: 'exhausted_retries' }),
      makeEntry({ webhookId: 'b', deadLetterReason: 'permanent_4xx' }),
    ];
    const copy = [...entries];
    dlqStats(entries);
    expect(entries).toEqual(copy);
  });

  it('works with a frozen (readonly) input', () => {
    const entries = Object.freeze([makeEntry({ deadLetterReason: 'exhausted_retries' })]);
    expect(() => dlqStats(entries)).not.toThrow();
    expect(dlqStats(entries)).toEqual({ total: 1, replayable: 1, dead: 0 });
  });
});

describe('DEAD_LETTER_REASONS', () => {
  it('contains all 5 reasons', () => {
    expect(DEAD_LETTER_REASONS).toHaveLength(5);
    expect(DEAD_LETTER_REASONS).toContain('exhausted_retries');
    expect(DEAD_LETTER_REASONS).toContain('permanent_4xx');
    expect(DEAD_LETTER_REASONS).toContain('unsafe_url');
    expect(DEAD_LETTER_REASONS).toContain('sign_error');
    expect(DEAD_LETTER_REASONS).toContain('manual');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DEAD_LETTER_REASONS)).toBe(true);
  });
});

describe('REPLAYABLE_REASONS', () => {
  it('contains exhausted_retries, sign_error, manual', () => {
    expect(REPLAYABLE_REASONS.has('exhausted_retries')).toBe(true);
    expect(REPLAYABLE_REASONS.has('sign_error')).toBe(true);
    expect(REPLAYABLE_REASONS.has('manual')).toBe(true);
  });

  it('does NOT contain permanent_4xx or unsafe_url', () => {
    expect(REPLAYABLE_REASONS.has('permanent_4xx')).toBe(false);
    expect(REPLAYABLE_REASONS.has('unsafe_url')).toBe(false);
  });
});

describe('DEAD_REASONS', () => {
  it('contains permanent_4xx and unsafe_url', () => {
    expect(DEAD_REASONS.has('permanent_4xx')).toBe(true);
    expect(DEAD_REASONS.has('unsafe_url')).toBe(true);
  });

  it('does NOT contain exhausted_retries, sign_error, or manual', () => {
    expect(DEAD_REASONS.has('exhausted_retries')).toBe(false);
    expect(DEAD_REASONS.has('sign_error')).toBe(false);
    expect(DEAD_REASONS.has('manual')).toBe(false);
  });
});

describe('TypeScript type coverage', () => {
  it('DeadLetterReason is assignable from all known strings', () => {
    const r: DeadLetterReason = 'permanent_4xx';
    expect(r).toBe('permanent_4xx');
  });

  it('DeadLetterEntry shape is complete', () => {
    const entry: DeadLetterEntry = {
      webhookId: 'ep_x',
      url: 'https://ex.com/hook',
      eventType: 'build.failed',
      attempts: 3,
      lastStatusCode: 502,
      lastError: 'bad gateway',
      deadLetterTs: '2026-06-29T00:00:00.000Z',
      deadLetterReason: 'sign_error',
    };
    expect(entry.deadLetterReason).toBe('sign_error');
  });

  it('DlqStats shape is complete', () => {
    const s: ReturnType<typeof dlqStats> = { total: 1, replayable: 1, dead: 0 };
    expect(s.total).toBe(1);
  });

  it('deadLetter returns DeadLetterEntry', () => {
    const entry: DeadLetterEntry = deadLetter(
      'ep_x',
      'https://ex.com/hook',
      'site.published',
      1,
      0,
      null,
      'manual',
      NOW,
    );
    expect(entry.webhookId).toBe('ep_x');
  });

  it('replayDead returns null for permanent reasons', () => {
    const result: DeadLetterEntry | null = replayDead(
      makeEntry({ deadLetterReason: 'permanent_4xx' }),
    );
    expect(result).toBeNull();
  });

  it('replayDead returns DeadLetterEntry for replayable reasons', () => {
    const result: DeadLetterEntry | null = replayDead(
      makeEntry({ deadLetterReason: 'exhausted_retries' }),
      NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.deadLetterReason).toBe('manual');
  });

  it('DEAD_LETTER_REASONS satisfies readonly DeadLetterReason[]', () => {
    const check: readonly DeadLetterReason[] = DEAD_LETTER_REASONS;
    expect(check.length).toBeGreaterThan(0);
  });
});
