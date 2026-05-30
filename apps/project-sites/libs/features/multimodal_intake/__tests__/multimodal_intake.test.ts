/**
 * Unit tests for Multimodal Intake (idea #18).
 *
 * Covers: photo-only, voice-only, both, urgency scoring, and the flag-off 404.
 * External deps (vision LLM, Whisper transcription, flag resolver) are mocked;
 * D1 + R2 are tiny in-memory doubles. The optional `build_budget` import is
 * left to no-op (dynamic import resolves the real module; recordSpend just
 * writes to the mocked DB and is non-blocking).
 */

// ── Mocks (inline factories — swc/jest hoists these above imports) ───────────
jest.mock('../../../../src/services/voice_agent.js', () => ({
  transcribeAudioChunk: jest.fn(),
}));
jest.mock('../../../../src/services/external_llm.js', () => ({
  callExternalLLMWithVision: jest.fn(),
}));
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));
jest.mock('../../../../src/services/media.js', () => ({
  uploadAsset: jest.fn(),
}));
// build_budget is dynamically imported by service.recordSpendIfMetered; stub it
// so the optional-spend path is a no-op in tests.
jest.mock('../../../../src/services/build_budget.js', () => ({
  recordSpend: jest.fn().mockResolvedValue(undefined),
}));

import { transcribeAudioChunk } from '../../../../src/services/voice_agent.js';
import { callExternalLLMWithVision } from '../../../../src/services/external_llm.js';
import { isFlagOn } from '../../../../src/modules/feature_flags/services.js';
import { processIntake, extractIntent, FLAG_KEY } from '../service.js';
import { multimodalIntake } from '../handlers.js';
import { IntakeSubmissionSchema } from '../schemas.js';

const mockTranscribe = transcribeAudioChunk as jest.MockedFunction<typeof transcribeAudioChunk>;
const mockVision = callExternalLLMWithVision as jest.MockedFunction<typeof callExternalLLMWithVision>;
const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;

// ── Doubles ─────────────────────────────────────────────────
interface IntakeRow {
  id: string;
  site_id: string;
  photo_url: string | null;
  voice_transcript: string | null;
  extracted_intent: string;
  urgency: number;
  booking_id: string | null;
}

function makeEnv(opts: { orgId?: string | null } = {}) {
  const rows: IntakeRow[] = [];
  const orgId = opts.orgId === undefined ? 'org_1' : opts.orgId;

  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const api = {
        bind: (...p: unknown[]) => {
          bound = p;
          return api;
        },
        first: async () => {
          if (sql.includes('FROM sites')) {
            return orgId === null ? null : { org_id: orgId };
          }
          return null;
        },
        run: async () => {
          if (sql.startsWith('UPDATE intake_submissions')) {
            const [bookingId, , id] = bound as [string, string, string];
            const r = rows.find((x) => x.id === id);
            if (r) r.booking_id = bookingId;
          }
          return { success: true };
        },
        all: async () => ({ results: [] }),
      };
      return api;
    },
    // dbInsert uses prepare→bind→run via dbExecute; route it here too.
    _rows: rows,
  } as unknown as D1Database & { _rows: IntakeRow[] };

  // dbInsert (services/db.ts) calls dbExecute → db.prepare(...).bind(...).run().
  // Intercept the INSERT through prepare above is hard (values are positional),
  // so override prepare to capture intake inserts by column order.
  const origPrepare = DB.prepare.bind(DB);
  (DB as unknown as { prepare: (s: string) => unknown }).prepare = (sql: string) => {
    if (sql.startsWith('INSERT INTO intake_submissions')) {
      let bound: unknown[] = [];
      const api = {
        bind: (...p: unknown[]) => {
          bound = p;
          return api;
        },
        run: async () => {
          // Column order from dbInsert: created_at, updated_at, then row keys.
          // Row keys: id, site_id, photo_url, voice_transcript, extracted_intent,
          //           urgency, booking_id, deleted_at.
          const [, , id, siteId, photoUrl, transcript, intent, urgency, bookingId] =
            bound as [string, string, string, string, string | null, string | null, string, number, string | null];
          rows.push({
            id,
            site_id: siteId,
            photo_url: photoUrl ?? null,
            voice_transcript: transcript ?? null,
            extracted_intent: intent,
            urgency,
            booking_id: bookingId ?? null,
          });
          return { success: true, meta: {} };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
      };
      return api;
    }
    return origPrepare(sql);
  };

  const R2_OBJECT = { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  const SITES_BUCKET = {
    get: jest.fn(async () => R2_OBJECT),
  };

  return { DB, SITES_BUCKET, AI: {} } as unknown as import('../../../../src/types/env.js').Env & {
    DB: D1Database & { _rows: IntakeRow[] };
  };
}

beforeEach(() => {
  mockTranscribe.mockReset();
  mockVision.mockReset();
  mockIsFlagOn.mockReset();
});

// ── extractIntent ───────────────────────────────────────────
describe('extractIntent', () => {
  it('returns empty intent when no inputs', async () => {
    const env = makeEnv();
    const out = await extractIntent(env, {});
    expect(out.extractedIntent).toBe('');
    expect(out.urgency).toBe(0);
    expect(mockVision).not.toHaveBeenCalled();
  });

  it('parses prose-wrapped JSON + clamps urgency', async () => {
    const env = makeEnv();
    mockVision.mockResolvedValue({
      output: 'Here you go: {"extractedIntent":"Burst pipe under sink","urgency":150,"suggestedService":"Emergency plumbing","suggestedFields":[{"name":"service","value":"Plumbing","confidence":0.9}]}',
    });
    const out = await extractIntent(env, { photoR2Key: 'media/o/a/p.jpg', voiceTranscript: 'water everywhere' });
    expect(out.extractedIntent).toMatch(/burst pipe/i);
    expect(out.urgency).toBe(100); // clamped from 150
    expect(out.suggestedFields[0].name).toBe('service');
  });

  it('degrades to empty on vision failure', async () => {
    const env = makeEnv();
    mockVision.mockRejectedValue(new Error('no key'));
    const out = await extractIntent(env, { note: 'leaky faucet' });
    expect(out.extractedIntent).toBe('');
  });
});

// ── processIntake ───────────────────────────────────────────
describe('processIntake', () => {
  it('photo-only: extracts intent + records lead (booking off)', async () => {
    const env = makeEnv();
    mockIsFlagOn.mockResolvedValue(false); // native_booking_engine off
    mockVision.mockResolvedValue({
      output: '{"extractedIntent":"Cracked screen","urgency":20,"suggestedService":"Repair","suggestedFields":[]}',
    });
    const res = await processIntake(env, { siteId: 's1', photoR2Key: 'media/o/a/p.jpg' });
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(res.submission.extractedIntent).toMatch(/cracked screen/i);
    expect(res.bookingId).toBeNull();
    expect(env.DB._rows).toHaveLength(1);
    expect(IntakeSubmissionSchema.safeParse(res.submission).success).toBe(true);
  });

  it('voice-only: transcribes then extracts', async () => {
    const env = makeEnv();
    mockIsFlagOn.mockResolvedValue(false);
    mockTranscribe.mockResolvedValue({ text: 'My heater is broken', provider: 'workers-ai-whisper' });
    mockVision.mockResolvedValue({
      output: '{"extractedIntent":"Broken heater","urgency":40,"suggestedFields":[]}',
    });
    const res = await processIntake(env, { siteId: 's1', audioR2Key: 'media/o/a/v.webm' });
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(res.submission.voiceTranscript).toBe('My heater is broken');
    expect(res.leadId).toBeTruthy();
  });

  it('both photo+voice: merges + proposes booking when native_booking_engine on', async () => {
    const env = makeEnv();
    mockIsFlagOn.mockResolvedValue(true); // booking engine on
    mockTranscribe.mockResolvedValue({ text: 'flooding fast', provider: 'deepgram' });
    mockVision.mockResolvedValue({
      output: '{"extractedIntent":"Major leak flooding the kitchen","urgency":95,"suggestedService":"Emergency","suggestedFields":[{"name":"service","value":"Plumbing"}]}',
    });
    const res = await processIntake(env, {
      siteId: 's1',
      photoR2Key: 'media/o/a/p.jpg',
      audioR2Key: 'media/o/a/v.webm',
      photoUrl: '/api/media/assets/x/raw',
    });
    expect(res.submission.urgency).toBe(95); // urgency scoring preserved
    expect(res.bookingId).toBeTruthy();
    expect(env.DB._rows[0].booking_id).toBe(res.bookingId);
  });

  it('falls back to transcript text when LLM gives no intent', async () => {
    const env = makeEnv();
    mockIsFlagOn.mockResolvedValue(false);
    mockTranscribe.mockResolvedValue({ text: 'pipe under the sink leaking', provider: 'workers-ai-whisper' });
    mockVision.mockRejectedValue(new Error('vision down'));
    const res = await processIntake(env, { siteId: 's1', audioR2Key: 'media/o/a/v.webm' });
    expect(res.submission.extractedIntent).toMatch(/pipe under the sink/i);
  });
});

// ── handler flag gate ───────────────────────────────────────
describe('POST /api/sites/:id/intake flag gate', () => {
  it('404s when multimodal_intake flag is off', async () => {
    const env = makeEnv();
    mockIsFlagOn.mockResolvedValue(false);
    const req = new Request('http://x/api/sites/s1/intake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await multimodalIntake.fetch(req, env);
    expect(res.status).toBe(404);
    // flag was checked with FLAG_KEY keyed on the site
    expect(mockIsFlagOn).toHaveBeenCalledWith(env, FLAG_KEY, { siteId: 's1' });
  });

  it('404s when the site has no owning org', async () => {
    const env = makeEnv({ orgId: null });
    mockIsFlagOn.mockResolvedValue(true);
    const req = new Request('http://x/api/sites/ghost/intake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await multimodalIntake.fetch(req, env);
    expect(res.status).toBe(404);
  });
});
