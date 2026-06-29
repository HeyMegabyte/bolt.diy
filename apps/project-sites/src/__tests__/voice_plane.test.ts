/**
 * Tests for voice_plane — PL15 voice → Plane work item mapper.
 */
import {
  classifyIntent,
  voiceCallToIssue,
  extractCaller,
  type VoiceCall,
} from '../services/voice_plane.js';

/* ── Helpers ────────────────────────────────────────────────────────── */

function makeCall(overrides: Partial<VoiceCall> = {}): VoiceCall {
  return {
    id: overrides.id ?? 'test-call-1',
    transcript: overrides.transcript ?? '',
    durationMs: overrides.durationMs ?? 60_000,
    ...('caller' in overrides ? { caller: overrides.caller } : {}),
  } satisfies VoiceCall;
}

/* ── classifyIntent ─────────────────────────────────────────────────── */

describe('classifyIntent', () => {
  it('classifies a bug report as create_issue', () => {
    const call = makeCall({ transcript: 'I need to report a bug with the login page' });
    expect(classifyIntent(call).intent).toBe('create_issue');
  });

  it('classifies a problem report as create_issue', () => {
    const call = makeCall({ transcript: 'There is a problem with the checkout flow' });
    expect(classifyIntent(call).intent).toBe('create_issue');
  });

  it('classifies broken-feature call as create_issue', () => {
    const call = makeCall({
      transcript: 'Something is broken on the dashboard. It shows wrong data.',
    });
    expect(classifyIntent(call).intent).toBe('create_issue');
  });

  it('classifies a task request as create_task', () => {
    const call = makeCall({ transcript: 'Can you create a task to update the pricing page?' });
    expect(classifyIntent(call).intent).toBe('create_task');
  });

  it('classifies "i need someone to" as create_task', () => {
    const call = makeCall({ transcript: 'I need someone to review the Q3 report' });
    expect(classifyIntent(call).intent).toBe('create_task');
  });

  it('classifies a log-note call as log_note', () => {
    const call = makeCall({ transcript: 'I wanted to note that the client approved the design' });
    expect(classifyIntent(call).intent).toBe('log_note');
  });

  it('classifies "for the record" as log_note', () => {
    const call = makeCall({
      transcript: 'For the record, we agreed to extend the deadline by two weeks',
    });
    expect(classifyIntent(call).intent).toBe('log_note');
  });

  it('returns unknown for empty transcript', () => {
    const call = makeCall({ transcript: '' });
    expect(classifyIntent(call)).toEqual({ intent: 'unknown', confidence: 0 });
  });

  it('returns unknown for unrelated conversation with low confidence', () => {
    const call = makeCall({ transcript: 'Hi, how is the weather today? I had a good lunch.' });
    expect(classifyIntent(call)).toEqual({ intent: 'unknown', confidence: 0 });
  });

  it('returns confidence 0 for non-matching transcript', () => {
    const call = makeCall({ transcript: 'Let us schedule a meeting for next Tuesday at 3pm.' });
    const result = classifyIntent(call);
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('picks create_issue over create_task when both match', () => {
    // "file a bug" (create_issue, 2/4 matches = 0.5) vs "create a task" (create_task, 1/4 = 0.25)
    const call = makeCall({ transcript: 'I need to file a bug and create a task for the fix' });
    expect(classifyIntent(call).intent).toBe('create_issue');
  });

  it('returns confidence 1 when all patterns match', () => {
    const call = makeCall({
      transcript:
        'I need to file a bug. There is a problem with the system. Something is broken. I need to report an error.',
    });
    const result = classifyIntent(call);
    expect(result.intent).toBe('create_issue');
    expect(result.confidence).toBe(1);
  });
});

/* ── voiceCallToIssue ───────────────────────────────────────────────── */

describe('voiceCallToIssue', () => {
  it('creates an issue with title from first sentence', () => {
    const call = makeCall({
      transcript:
        'The login page shows an unexpected error when I click submit. This happens every time.',
      caller: '+15551234567',
      durationMs: 120_000,
    });
    const issue = voiceCallToIssue(call);
    expect(issue.title).toBe('The login page shows an unexpected error when I click submit.');
    expect(issue.description).toContain(call.transcript);
    expect(issue.description).toContain('**Caller:** +15551234567');
    expect(issue.description).toContain('**Duration:** 2m 0s');
    expect(issue.description).toContain('**Source:** LiveKit voice agent');
    expect(issue.priority).toBe('high');
    expect(issue.labels).toEqual(['voice']);
  });

  it('falls back to call-id-based title when transcript has no sentence', () => {
    const call = makeCall({ id: 'call-xyz', transcript: 'short', durationMs: 30_000 });
    const issue = voiceCallToIssue(call);
    expect(issue.title).toBe('Voice call call-xyz');
  });

  it('extracts caller info and includes in description', () => {
    const call = makeCall({
      transcript: 'Hi, my name is Alice Cooper from Big Corp. The server is down.',
      durationMs: 90_000,
    });
    const issue = voiceCallToIssue(call);
    expect(issue.description).toContain('**Caller Name:** Alice Cooper');
    expect(issue.description).toContain('**Company:** Big Corp');
  });

  it('uses urgent priority when transcript has urgency keywords', () => {
    const call = makeCall({ transcript: 'The production server is down. This is critical.' });
    expect(voiceCallToIssue(call).priority).toBe('urgent');
  });

  it('uses high priority for error/failure keywords', () => {
    const call = makeCall({ transcript: 'The deployment failed with an error.' });
    expect(voiceCallToIssue(call).priority).toBe('high');
  });

  it('defaults to medium priority for neutral transcripts', () => {
    const call = makeCall({ transcript: 'I wanted to note that the client approved the design.' });
    expect(voiceCallToIssue(call).priority).toBe('medium');
  });

  it('formats short duration correctly', () => {
    const call = makeCall({ transcript: 'Test call.', durationMs: 5_000 });
    const issue = voiceCallToIssue(call);
    expect(issue.description).toContain('**Duration:** 5s');
  });

  it('formats long duration correctly', () => {
    const call = makeCall({ transcript: 'Test call.', durationMs: 185_000 });
    const issue = voiceCallToIssue(call);
    expect(issue.description).toContain('**Duration:** 3m 5s');
  });

  it('omits caller line when no caller provided', () => {
    const call = makeCall({ transcript: 'A bug report without caller metadata.' });
    const issue = voiceCallToIssue(call);
    expect(issue.description).not.toContain('**Caller:**');
  });
});

/* ── extractCaller ──────────────────────────────────────────────────── */

describe('extractCaller', () => {
  it('extracts name from "my name is X" pattern', () => {
    expect(extractCaller('Hi, my name is Jane Smith.')).toEqual({
      name: 'Jane Smith',
      company: null,
    });
  });

  it('extracts name and company from "this is X from Y"', () => {
    expect(extractCaller('Hello, this is Bob Jones from Acme Corp.')).toEqual({
      name: 'Bob Jones',
      company: 'Acme Corp',
    });
  });

  it('extracts name from "I\'m X" pattern', () => {
    expect(extractCaller("Hi, I'm Sarah and I'm calling about an issue.")).toEqual({
      name: 'Sarah',
      company: null,
    });
  });

  it('extracts name from "calling as X" pattern', () => {
    expect(extractCaller('calling as Tom Wilson from Mega Ltd.')).toEqual({
      name: 'Tom Wilson',
      company: 'Mega Ltd',
    });
  });

  it('extracts company from "at Y" pattern', () => {
    expect(extractCaller('Hi, my name is Dana at Widgets Inc.')).toEqual({
      name: 'Dana',
      company: 'Widgets Inc',
    });
  });

  it('filters out false-positive company words', () => {
    expect(extractCaller("Hi, I'm Alex from the office.")).toEqual({
      name: 'Alex',
      company: null,
    });
  });

  it('returns null name/company for unrecognised opening', () => {
    expect(extractCaller('1234')).toEqual({ name: null, company: null });
  });

  it('only scans first 300 characters', () => {
    const transcript = 'X'.repeat(290) + ' my name is Eve from Hidden Corp.';
    // The name/company appears past char 300
    expect(extractCaller(transcript)).toEqual({ name: null, company: null });
  });
});
