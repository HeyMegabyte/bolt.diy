/**
 * social_auto_pilot — Pulse Social Auto-Pilot composer service (convergence r34).
 *
 * Locks the autonomous-composer state store + generator against its contracts:
 * rowToConfig defaults + JSON parse/filter resilience, loadAutoPilotConfig
 * read path, upsertAutoPilotConfig next_run_at recompute math (enable-flip,
 * cadence change, disable-clears, insert-vs-update branch), business-context
 * resolution with site fallback, prompt templating, per-network draft
 * generation (char-limit clamp, JSON-vs-raw parse, mediaSuggestion), and the
 * cron sweep runAutoPilotIfDue (due selection, empty-network skip, default
 * prompt fallback, per-account failure isolation, last/next_run bump).
 *
 * db.js + external_llm.js are mocked so both the static and dynamic
 * (`await import('./db.js')`) import paths resolve to the same jest stubs.
 * No real I/O. ts-jest global `jest`; casts via `as unknown as jest.Mock`.
 */
import type { Env } from '../types/env.js';

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn(),
  dbUpdate: jest.fn(),
}));
jest.mock('../services/external_llm.js', () => ({
  callExternalLLM: jest.fn(),
}));

import {
  loadAutoPilotConfig,
  upsertAutoPilotConfig,
  generateAutoPilotPostForNetwork,
  runAutoPilotIfDue,
  DEFAULT_AUTO_PILOT_PROMPT,
} from '../services/social_auto_pilot.js';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import { callExternalLLM } from '../services/external_llm.js';

const mDbQuery = dbQuery as unknown as jest.Mock;
const mDbQueryOne = dbQueryOne as unknown as jest.Mock;
const mDbInsert = dbInsert as unknown as jest.Mock;
const mDbUpdate = dbUpdate as unknown as jest.Mock;
const mLLM = callExternalLLM as unknown as jest.Mock;

const HOUR = 3_600_000;
const FIXED_NOW = 1_700_000_000_000;

const db = {} as unknown as D1Database;
function makeEnv(): Env {
  return { DB: db } as unknown as Env;
}

/** Build an LLM result envelope with the given raw output string. */
function llmResult(output: string) {
  return { output, model_used: 'claude-sonnet-4-6', provider: 'anthropic', latency_ms: 1, token_count: 1, cost_estimate: 0 };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
});

afterEach(() => {
  (Date.now as unknown as jest.Mock).mockRestore?.();
});

// ────────────────────────────────────────────────────────────
// loadAutoPilotConfig — read path + rowToConfig mapping
// ────────────────────────────────────────────────────────────
describe('loadAutoPilotConfig', () => {
  it('returns a safe default config when no row exists', async () => {
    mDbQueryOne.mockResolvedValueOnce(null);
    const cfg = await loadAutoPilotConfig(db, 'org-1');
    expect(cfg).toEqual({
      enabled: false,
      prompt: '',
      cadence_hours: 24,
      target_networks: [],
      last_run_at: null,
      next_run_at: null,
    });
    expect(mDbQueryOne).toHaveBeenCalledWith(
      db,
      expect.stringContaining('FROM social_auto_pilot WHERE org_id = ?'),
      ['org-1'],
    );
  });

  it('maps a populated row, parsing + filtering target_networks JSON', async () => {
    mDbQueryOne.mockResolvedValueOnce({
      enabled: 1,
      prompt: 'custom',
      cadence_hours: 12,
      // bogus entry must be filtered out by the PLATFORMS allowlist
      target_networks_json: JSON.stringify(['twitter', 'linkedin', 'not-a-network']),
      last_run_at: 100,
      next_run_at: 200,
    });
    const cfg = await loadAutoPilotConfig(db, 'org-2');
    expect(cfg.enabled).toBe(true);
    expect(cfg.prompt).toBe('custom');
    expect(cfg.cadence_hours).toBe(12);
    expect(cfg.target_networks).toEqual(['twitter', 'linkedin']);
    expect(cfg.last_run_at).toBe(100);
    expect(cfg.next_run_at).toBe(200);
  });

  it('falls back to empty networks on malformed JSON or non-array', async () => {
    mDbQueryOne.mockResolvedValueOnce({
      enabled: 0,
      prompt: '',
      cadence_hours: 24,
      target_networks_json: '{not json',
      last_run_at: null,
      next_run_at: null,
    });
    const a = await loadAutoPilotConfig(db, 'org-3');
    expect(a.target_networks).toEqual([]);
    expect(a.enabled).toBe(false);

    mDbQueryOne.mockResolvedValueOnce({
      enabled: 1,
      prompt: 'p',
      cadence_hours: 6,
      target_networks_json: JSON.stringify({ not: 'array' }),
      last_run_at: null,
      next_run_at: null,
    });
    const b = await loadAutoPilotConfig(db, 'org-4');
    expect(b.target_networks).toEqual([]);
  });

  it('treats a null target_networks_json as empty networks', async () => {
    mDbQueryOne.mockResolvedValueOnce({
      enabled: 1,
      prompt: 'p',
      cadence_hours: 24,
      target_networks_json: null,
      last_run_at: null,
      next_run_at: null,
    });
    const cfg = await loadAutoPilotConfig(db, 'org-5');
    expect(cfg.target_networks).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// upsertAutoPilotConfig — next_run_at recompute math + insert/update branch
// ────────────────────────────────────────────────────────────
describe('upsertAutoPilotConfig', () => {
  it('inserts a new row and schedules next_run_at when enabling for the first time', async () => {
    mDbQueryOne.mockResolvedValueOnce(null); // no existing row
    const out = await upsertAutoPilotConfig(db, 'org-1', {
      enabled: true,
      prompt: 'hello',
      cadence_hours: 6,
      target_networks: ['twitter', 'bluesky'],
    });
    expect(mDbInsert).toHaveBeenCalledTimes(1);
    expect(mDbUpdate).not.toHaveBeenCalled();
    const [, table, record] = mDbInsert.mock.calls[0];
    expect(table).toBe('social_auto_pilot');
    expect(record.org_id).toBe('org-1');
    expect(record.enabled).toBe(1);
    expect(record.target_networks_json).toBe(JSON.stringify(['twitter', 'bluesky']));
    expect(record.next_run_at).toBe(FIXED_NOW + 6 * HOUR);
    expect(out.next_run_at).toBe(FIXED_NOW + 6 * HOUR);
    expect(out.enabled).toBe(true);
  });

  it('updates an existing row when one is present (no insert)', async () => {
    mDbQueryOne.mockResolvedValueOnce({
      enabled: 1,
      prompt: 'old',
      cadence_hours: 24,
      target_networks_json: JSON.stringify(['twitter']),
      last_run_at: 5,
      next_run_at: FIXED_NOW + 24 * HOUR,
    });
    const out = await upsertAutoPilotConfig(db, 'org-1', { prompt: 'new copy' });
    expect(mDbInsert).not.toHaveBeenCalled();
    expect(mDbUpdate).toHaveBeenCalledTimes(1);
    const [, table, updates, where, params] = mDbUpdate.mock.calls[0];
    expect(table).toBe('social_auto_pilot');
    expect(updates.prompt).toBe('new copy');
    expect(where).toBe('org_id = ?');
    expect(params).toEqual(['org-1']);
    // no cadence change + already-enabled + next_run_at set → unchanged
    expect(out.next_run_at).toBe(FIXED_NOW + 24 * HOUR);
    expect(out.last_run_at).toBe(5); // preserved from prev
  });

  it('recomputes next_run_at when cadence_hours changes on an enabled row', async () => {
    mDbQueryOne.mockResolvedValueOnce({
      enabled: 1,
      prompt: 'p',
      cadence_hours: 24,
      target_networks_json: JSON.stringify(['twitter']),
      last_run_at: null,
      next_run_at: FIXED_NOW + 999 * HOUR,
    });
    const out = await upsertAutoPilotConfig(db, 'org-1', { cadence_hours: 3 });
    expect(out.cadence_hours).toBe(3);
    expect(out.next_run_at).toBe(FIXED_NOW + 3 * HOUR);
  });

  it('clears next_run_at when enabled flips off (cron skips the row)', async () => {
    mDbQueryOne.mockResolvedValueOnce({
      enabled: 1,
      prompt: 'p',
      cadence_hours: 24,
      target_networks_json: JSON.stringify(['twitter']),
      last_run_at: null,
      next_run_at: FIXED_NOW + 24 * HOUR,
    });
    const out = await upsertAutoPilotConfig(db, 'org-1', { enabled: false });
    expect(out.enabled).toBe(false);
    expect(out.next_run_at).toBeNull();
    const [, , updates] = mDbUpdate.mock.calls[0];
    expect(updates.enabled).toBe(0);
    expect(updates.next_run_at).toBeNull();
  });

  it('schedules next_run_at when an already-enabled row has a null next_run_at', async () => {
    mDbQueryOne.mockResolvedValueOnce({
      enabled: 1,
      prompt: 'p',
      cadence_hours: 8,
      target_networks_json: JSON.stringify(['linkedin']),
      last_run_at: null,
      next_run_at: null, // somehow missing → must be re-scheduled
    });
    const out = await upsertAutoPilotConfig(db, 'org-1', {});
    expect(out.next_run_at).toBe(FIXED_NOW + 8 * HOUR);
  });

  it('inherits prev values for fields not present in the patch', async () => {
    mDbQueryOne.mockResolvedValueOnce({
      enabled: 1,
      prompt: 'keep me',
      cadence_hours: 12,
      target_networks_json: JSON.stringify(['facebook']),
      last_run_at: 7,
      next_run_at: FIXED_NOW + 12 * HOUR,
    });
    const out = await upsertAutoPilotConfig(db, 'org-1', {});
    expect(out.prompt).toBe('keep me');
    expect(out.cadence_hours).toBe(12);
    expect(out.target_networks).toEqual(['facebook']);
  });
});

// ────────────────────────────────────────────────────────────
// generateAutoPilotPostForNetwork — context, templating, parse, clamp
// ────────────────────────────────────────────────────────────
describe('generateAutoPilotPostForNetwork', () => {
  function siteRow(over: Record<string, unknown> = {}) {
    return { business_name: 'Acme Co', business_address: '123 Main St', ...over };
  }

  it('renders the prompt template with site context and parses JSON output', async () => {
    mDbQueryOne.mockResolvedValueOnce(siteRow());
    mLLM.mockResolvedValueOnce(llmResult(JSON.stringify({ text: '  Hook line here  ', mediaSuggestion: 'a photo' })));

    const out = await generateAutoPilotPostForNetwork(
      makeEnv(),
      'org-1',
      'linkedin',
      'Brand: {{business_name}} ({{business_type}}). Voice: {{brand_voice}}. News: {{recent_news}}. Nets: {{target_networks}}.',
    );

    expect(out.text).toBe('Hook line here'); // trimmed
    expect(out.mediaSuggestion).toBe('a photo');

    const opts = mLLM.mock.calls[0][1] as { system: string; jsonMode: boolean; model: string; provider: string };
    expect(opts.system).toContain('Acme Co');
    expect(opts.system).toContain('small business');
    expect(opts.system).toContain('Based in 123 Main St.');
    expect(opts.system).toContain('linkedin'); // target_networks substituted
    expect(opts.jsonMode).toBe(true);
    expect(opts.model).toBe('claude-sonnet-4-6');
    expect(opts.provider).toBe('anthropic');
  });

  it('clamps text beyond the per-network char limit and appends an ellipsis', async () => {
    mDbQueryOne.mockResolvedValueOnce(siteRow());
    const long = 'x'.repeat(500);
    mLLM.mockResolvedValueOnce(llmResult(JSON.stringify({ text: long })));

    const out = await generateAutoPilotPostForNetwork(makeEnv(), 'org-1', 'twitter', 'p');
    // twitter limit = 280; clamp to 279 chars + '…'
    expect(out.text.length).toBe(280);
    expect(out.text.endsWith('…')).toBe(true);
  });

  it('falls back to raw output when the LLM returns non-JSON', async () => {
    mDbQueryOne.mockResolvedValueOnce(siteRow());
    mLLM.mockResolvedValueOnce(llmResult('just a plain sentence, no json'));

    const out = await generateAutoPilotPostForNetwork(makeEnv(), 'org-1', 'facebook', 'p');
    expect(out.text).toBe('just a plain sentence, no json');
    expect(out.mediaSuggestion).toBeUndefined();
  });

  it('uses neutral business defaults when the org has no published site', async () => {
    mDbQueryOne.mockResolvedValueOnce(null); // no site
    mLLM.mockResolvedValueOnce(llmResult(JSON.stringify({ text: 'ok' })));

    await generateAutoPilotPostForNetwork(makeEnv(), 'org-1', 'bluesky', '{{business_name}} / {{recent_news}}');
    const opts = mLLM.mock.calls[0][1] as { system: string };
    expect(opts.system).toContain('our brand');
    expect(opts.system).toContain('No recent updates available.');
  });

  it('drops a non-string mediaSuggestion to undefined', async () => {
    mDbQueryOne.mockResolvedValueOnce(siteRow());
    mLLM.mockResolvedValueOnce(llmResult(JSON.stringify({ text: 'hi', mediaSuggestion: 42 })));
    const out = await generateAutoPilotPostForNetwork(makeEnv(), 'org-1', 'threads', 'p');
    expect(out.text).toBe('hi');
    expect(out.mediaSuggestion).toBeUndefined();
  });

  it('coerces a non-string parsed text to the raw output string', async () => {
    mDbQueryOne.mockResolvedValueOnce(siteRow());
    // valid JSON, but text is not a string → fall back to String(result.output)
    mLLM.mockResolvedValueOnce(llmResult(JSON.stringify({ text: 99 })));
    const out = await generateAutoPilotPostForNetwork(makeEnv(), 'org-1', 'mastodon', 'p');
    expect(out.text).toBe(JSON.stringify({ text: 99 }));
  });

  it('propagates an LLM provider failure (does not swallow)', async () => {
    mDbQueryOne.mockResolvedValueOnce(siteRow());
    mLLM.mockRejectedValueOnce(new Error('no provider configured'));
    await expect(
      generateAutoPilotPostForNetwork(makeEnv(), 'org-1', 'twitter', 'p'),
    ).rejects.toThrow('no provider configured');
  });
});

// ────────────────────────────────────────────────────────────
// runAutoPilotIfDue — cron sweep: selection, skip, default prompt,
// per-account failure isolation, run bump
// ────────────────────────────────────────────────────────────
describe('runAutoPilotIfDue', () => {
  it('returns a zero summary and bumps nothing when no orgs are due', async () => {
    mDbQuery.mockResolvedValueOnce({ data: [] });
    const out = await runAutoPilotIfDue(makeEnv());
    expect(out).toEqual({ orgs_scanned: 0, drafts_created: 0 });
    expect(mDbInsert).not.toHaveBeenCalled();
    expect(mDbUpdate).not.toHaveBeenCalled();
    // due query is parameterized with now + the default limit (10)
    expect(mDbQuery).toHaveBeenCalledWith(db, expect.stringContaining('WHERE enabled = 1'), [FIXED_NOW, 10]);
  });

  it('passes a custom limit through to the due query', async () => {
    mDbQuery.mockResolvedValueOnce({ data: [] });
    await runAutoPilotIfDue(makeEnv(), 3);
    expect(mDbQuery).toHaveBeenCalledWith(db, expect.any(String), [FIXED_NOW, 3]);
  });

  it('generates one draft per target network and bumps last/next_run_at', async () => {
    mDbQuery.mockResolvedValueOnce({
      data: [
        {
          org_id: 'org-A',
          prompt: 'custom prompt',
          cadence_hours: 6,
          target_networks_json: JSON.stringify(['twitter', 'linkedin']),
        },
      ],
    });
    // loadBusinessContext (dbQueryOne) called once per generation; then LLM
    mDbQueryOne.mockResolvedValue({ business_name: 'B', business_address: null });
    mLLM.mockResolvedValue(llmResult(JSON.stringify({ text: 'post' })));

    const out = await runAutoPilotIfDue(makeEnv());

    expect(out.orgs_scanned).toBe(1);
    expect(out.drafts_created).toBe(2);
    // two pulse_posts inserts, all status=draft, created_by=auto-pilot
    const inserts = mDbInsert.mock.calls.filter((c) => c[1] === 'pulse_posts');
    expect(inserts.length).toBe(2);
    for (const [, , rec] of inserts) {
      expect(rec.status).toBe('draft');
      expect(rec.created_by).toBe('auto-pilot');
      expect(rec.content).toBe('post');
      expect(rec.org_id).toBe('org-A');
    }
    // run bump
    const update = mDbUpdate.mock.calls.find((c) => c[1] === 'social_auto_pilot');
    expect(update).toBeTruthy();
    const [, , updates, where, params] = update!;
    expect(updates.last_run_at).toBe(FIXED_NOW);
    expect(updates.next_run_at).toBe(FIXED_NOW + 6 * HOUR);
    expect(where).toBe('org_id = ?');
    expect(params).toEqual(['org-A']);
  });

  it('skips an org with empty/invalid target networks without bumping it', async () => {
    mDbQuery.mockResolvedValueOnce({
      data: [
        { org_id: 'org-empty', prompt: 'p', cadence_hours: 24, target_networks_json: JSON.stringify([]) },
        { org_id: 'org-bad', prompt: 'p', cadence_hours: 24, target_networks_json: '{broken' },
      ],
    });
    const out = await runAutoPilotIfDue(makeEnv());
    expect(out.orgs_scanned).toBe(2);
    expect(out.drafts_created).toBe(0);
    expect(mDbInsert).not.toHaveBeenCalled();
    // skipped orgs never reach the run-bump update
    expect(mDbUpdate).not.toHaveBeenCalled();
    expect(mLLM).not.toHaveBeenCalled();
  });

  it('falls back to DEFAULT_AUTO_PILOT_PROMPT when the row prompt is empty', async () => {
    mDbQuery.mockResolvedValueOnce({
      data: [{ org_id: 'org-D', prompt: '', cadence_hours: 24, target_networks_json: JSON.stringify(['twitter']) }],
    });
    mDbQueryOne.mockResolvedValue({ business_name: 'X', business_address: null });
    mLLM.mockResolvedValue(llmResult(JSON.stringify({ text: 'p' })));

    await runAutoPilotIfDue(makeEnv());
    const opts = mLLM.mock.calls[0][1] as { system: string };
    // DEFAULT prompt mentions "autonomous social media composer"
    expect(opts.system).toContain('autonomous social media composer');
    expect(DEFAULT_AUTO_PILOT_PROMPT).toContain('{{business_name}}');
  });

  it('isolates a per-network generation failure and still drafts the others', async () => {
    mDbQuery.mockResolvedValueOnce({
      data: [
        {
          org_id: 'org-E',
          prompt: 'p',
          cadence_hours: 12,
          target_networks_json: JSON.stringify(['twitter', 'linkedin']),
        },
      ],
    });
    mDbQueryOne.mockResolvedValue({ business_name: 'X', business_address: null });
    // first network throws, second succeeds
    mLLM.mockRejectedValueOnce(new Error('LLM down')).mockResolvedValueOnce(llmResult(JSON.stringify({ text: 'ok' })));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const out = await runAutoPilotIfDue(makeEnv());

    expect(out.drafts_created).toBe(1); // one survived
    const inserts = mDbInsert.mock.calls.filter((c) => c[1] === 'pulse_posts');
    expect(inserts.length).toBe(1);
    // failure was logged, not thrown
    expect(warn).toHaveBeenCalled();
    const logged = JSON.parse(warn.mock.calls[0][0] as string);
    expect(logged.service).toBe('social_auto_pilot');
    expect(logged.message).toBe('cron_generation_failed');
    expect(logged.org_id).toBe('org-E');
    // the org is still bumped despite the partial failure
    expect(mDbUpdate.mock.calls.some((c) => c[1] === 'social_auto_pilot')).toBe(true);
    warn.mockRestore();
  });
});
