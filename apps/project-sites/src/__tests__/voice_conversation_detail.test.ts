/**
 * GET /api/voice/conversations/:id — conversation detail (call transcript OR sms).
 *
 * Regression coverage for a live user-facing bug (iter 26): the FE conversations
 * detail pane fetches this route to load a call's transcript, but the route did
 * NOT exist → the FE 404'd + fell back to the transcript-less list row, so opening
 * a conversation never showed the transcript. This locks: (1) a call returns the
 * parsed transcript mapped to the UI's {speaker,text,t_ms} shape; (2) an SMS falls
 * through; (3) neither → 404 (org-scoped, no existence leak); (4) malformed
 * transcript JSON degrades to [] instead of 500.
 */

jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
  dbQuery: jest.fn().mockResolvedValue({ data: [] }),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { Hono } from 'hono';
import { voiceRoutes } from '../routes/voice.js';
import { errorHandler } from '../middleware/error_handler.js';
import { dbQueryOne } from '../services/db.js';

const mockQueryOne = dbQueryOne as jest.Mock;
const ENV = { DB: {} } as unknown as Record<string, unknown>;

function makeApp(vars: { orgId?: string; userId?: string } = { orgId: 'org-1', userId: 'user-1' }) {
  const app = new Hono();
  app.onError(errorHandler as never);
  app.use('*', async (c, next) => {
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.userId) c.set('userId', vars.userId);
    await next();
  });
  app.route('/', voiceRoutes as never);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/voice/conversations/:id', () => {
  it('returns a call detail with the transcript mapped (role→speaker, ts_ms→t_ms; empty turns dropped)', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'call-1',
      from_number: '+1a',
      to_number: '+1b',
      started_at: '2026-08-01T00:00:00Z',
      duration_seconds: 42,
      status: 'completed',
      sentiment: 'positive',
      summary: 'sum',
      transcript_json: JSON.stringify([
        { role: 'user', text: 'hi', ts_ms: 100 },
        { role: 'assistant', text: 'hello', ts_ms: 200 },
        { role: 'system', text: '', ts_ms: 0 },
      ]),
    });

    const res = await makeApp().request('/api/voice/conversations/call-1', {}, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { channel: string; transcript: Array<{ speaker: string; text: string; t_ms: number }> };
    };
    expect(body.data.channel).toBe('call');
    expect(body.data.transcript).toEqual([
      { speaker: 'caller', text: 'hi', t_ms: 100 },
      { speaker: 'agent', text: 'hello', t_ms: 200 },
    ]);
    // Org-scoped, non-deleted query (no cross-org / soft-deleted leak).
    const sql = String(mockQueryOne.mock.calls[0][1]);
    expect(sql).toContain('org_id = ?');
    expect(sql).toContain('deleted_at IS NULL');
    expect(mockQueryOne.mock.calls[0][2]).toEqual(['call-1', 'org-1']);
  });

  it('falls through to an SMS when no call matches', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // call lookup → none
      .mockResolvedValueOnce({
        id: 'sms-1',
        from_number: '+1a',
        to_number: '+1b',
        sent_at: '2026-08-01T00:00:00Z',
        status: 'completed',
        body: 'text msg',
      });

    const res = await makeApp().request('/api/voice/conversations/sms-1', {}, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { channel: string; message_preview?: string; transcript?: unknown };
    };
    expect(body.data.channel).toBe('sms');
    expect(body.data.message_preview).toBe('text msg');
    expect(body.data.transcript).toBeUndefined();
  });

  it('404s (non-leak) when neither a call nor an sms matches', async () => {
    mockQueryOne.mockResolvedValue(null);
    const res = await makeApp().request('/api/voice/conversations/missing', {}, ENV);
    expect(res.status).toBe(404);
  });

  it('degrades malformed transcript_json to [] (never 500s)', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'call-2',
      from_number: '',
      to_number: '',
      started_at: '',
      duration_seconds: null,
      status: null,
      sentiment: null,
      summary: null,
      transcript_json: 'not-json{',
    });
    const res = await makeApp().request('/api/voice/conversations/call-2', {}, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { transcript: unknown[] } };
    expect(body.data.transcript).toEqual([]);
  });
});

/**
 * GET /api/voice/conversations/:id/download.:kind — transcript + recording export.
 *
 * Regression coverage for the second half of the same live bug (iter 27): the
 * detail-pane download buttons hit this route, which did NOT exist → every
 * download 404'd. This locks: (1) txt renders the transcript as plain text with an
 * attachment disposition; (2) vtt renders valid WebVTT (WEBVTT header + timed cues);
 * (3) mp3/mp4 302-redirect to the R2 recording-stream route when a recording exists;
 * (4) mp3/mp4 404 when no recording exists (never fabricate bytes); (5) an unknown
 * kind + a foreign/missing call both 404 (org-scoped, no existence leak).
 */
const TRANSCRIPT = JSON.stringify([
  { role: 'user', text: 'hi there', ts_ms: 1500 },
  { role: 'assistant', text: 'hello, how can I help', ts_ms: 4200 },
]);

describe('GET /api/voice/conversations/:id/download.:kind', () => {
  it('txt → plain-text transcript with an attachment Content-Disposition', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'call-1', transcript_json: TRANSCRIPT });
    const res = await makeApp().request('/api/voice/conversations/call-1/download.txt', {}, ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="call-1.txt"');
    expect(await res.text()).toBe('Caller: hi there\nAI: hello, how can I help');
    // Org-scoped, non-deleted lookup (no cross-org / soft-deleted leak).
    const sql = String(mockQueryOne.mock.calls[0][1]);
    expect(sql).toContain('org_id = ?');
    expect(sql).toContain('deleted_at IS NULL');
    expect(mockQueryOne.mock.calls[0][2]).toEqual(['call-1', 'org-1']);
  });

  it('vtt → valid WebVTT (WEBVTT header + timed cues + speaker voice tags)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'call-1', transcript_json: TRANSCRIPT });
    const res = await makeApp().request('/api/voice/conversations/call-1/download.vtt', {}, ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/vtt');
    const body = await res.text();
    expect(body.startsWith('WEBVTT')).toBe(true);
    expect(body).toContain('00:00:01.500 --> 00:00:04.200');
    expect(body).toContain('<v Caller>hi there');
    expect(body).toContain('<v AI>hello, how can I help');
  });

  it('mp3 → 302 to the recording-stream route when an audio recording exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'call-1', transcript_json: null }) // call lookup
      .mockResolvedValueOnce({ id: 'rec-9' }); // audio recording lookup
    const res = await makeApp().request('/api/voice/conversations/call-1/download.mp3', {}, ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/api/voice/recordings/rec-9/stream');
    // The recording lookup filters to kind='audio'.
    expect(mockQueryOne.mock.calls[1][2]).toEqual(['call-1', 'audio']);
  });

  it('mp4 → 302 and looks up the video recording (kind=video)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'call-1', transcript_json: null })
      .mockResolvedValueOnce({ id: 'vid-2' });
    const res = await makeApp().request('/api/voice/conversations/call-1/download.mp4', {}, ENV);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/api/voice/recordings/vid-2/stream');
    expect(mockQueryOne.mock.calls[1][2]).toEqual(['call-1', 'video']);
  });

  it('mp3 → 404 when the conversation has no recording (never fabricate bytes)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'call-1', transcript_json: null })
      .mockResolvedValueOnce(null); // no recording
    const res = await makeApp().request('/api/voice/conversations/call-1/download.mp3', {}, ENV);
    expect(res.status).toBe(404);
  });

  it('an unknown kind 404s before any DB read (allow-listed extension)', async () => {
    const res = await makeApp().request('/api/voice/conversations/call-1/download.pdf', {}, ENV);
    expect(res.status).toBe(404);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('404s (non-leak) when the call is foreign or missing', async () => {
    mockQueryOne.mockResolvedValue(null);
    const res = await makeApp().request('/api/voice/conversations/missing/download.txt', {}, ENV);
    expect(res.status).toBe(404);
  });
});
