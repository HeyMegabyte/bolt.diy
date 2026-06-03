/**
 * AI Endpoint IDE service — slug normalisation, JSON column round-trip,
 * per-language entrypoint selection, and the multi-language deploy dispatch.
 *
 * Mocks `services/wfp_dispatch.js` so `deployEndpointFromFiles` is exercised
 * across every branch (ai-prompt short-circuit, python/rust defer,
 * WFP-not-configured defer, empty-entrypoint reject, TS→JS coercion,
 * upstream-upload failure, happy-path upload) without any real CF API calls.
 */

jest.mock('../services/wfp_dispatch.js', () => ({
  isWfpConfigured: jest.fn(),
  uploadUserWorker: jest.fn(),
}));

import { isWfpConfigured, uploadUserWorker } from '../services/wfp_dispatch.js';
import {
  normaliseSlug,
  safeParseJson,
  pickEntrypoint,
  deployEndpointFromFiles,
  LANGUAGE_ENTRYPOINTS,
  LANGUAGE_STARTERS,
  type IdeLanguage,
} from '../services/ai_endpoints_ide.js';
import type { Env } from '../types/env.js';

const mockIsConfigured = isWfpConfigured as unknown as jest.Mock;
const mockUpload = uploadUserWorker as unknown as jest.Mock;

/** Minimal Env stub — the service only forwards it to the (mocked) dispatcher. */
function makeEnv(): Env {
  return {} as unknown as Env;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ────────────────────────────────────────────────────────────
// normaliseSlug
// ────────────────────────────────────────────────────────────
describe('normaliseSlug', () => {
  it('lowercases + trims a valid slug', () => {
    expect(normaliseSlug('  Invoice-Webhook  ')).toBe('invoice-webhook');
  });

  it('accepts digits and multi-segment hyphenation', () => {
    expect(normaliseSlug('v2-route-99')).toBe('v2-route-99');
  });

  it('accepts the minimum 2-char length', () => {
    expect(normaliseSlug('ab')).toBe('ab');
  });

  it('accepts the maximum 64-char length', () => {
    const slug = 'a'.repeat(64);
    expect(normaliseSlug(slug)).toBe(slug);
  });

  it('rejects too-short input (1 char)', () => {
    expect(normaliseSlug('a')).toBeNull();
  });

  it('rejects too-long input (65 chars)', () => {
    expect(normaliseSlug('a'.repeat(65))).toBeNull();
  });

  it('rejects leading/trailing hyphens', () => {
    expect(normaliseSlug('-abc')).toBeNull();
    expect(normaliseSlug('abc-')).toBeNull();
  });

  it('rejects double hyphens', () => {
    expect(normaliseSlug('a--b')).toBeNull();
  });

  it('rejects illegal characters (underscore, space, slash)', () => {
    expect(normaliseSlug('a_b')).toBeNull();
    expect(normaliseSlug('a b')).toBeNull();
    expect(normaliseSlug('a/b')).toBeNull();
  });

  it('returns null for null / undefined / empty', () => {
    expect(normaliseSlug(null)).toBeNull();
    expect(normaliseSlug(undefined)).toBeNull();
    expect(normaliseSlug('')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// safeParseJson
// ────────────────────────────────────────────────────────────
describe('safeParseJson', () => {
  it('parses valid JSON', () => {
    expect(safeParseJson<{ a: number }>('{"a":1}', { a: 0 })).toEqual({ a: 1 });
  });

  it('parses a JSON array', () => {
    expect(safeParseJson<number[]>('[1,2,3]', [])).toEqual([1, 2, 3]);
  });

  it('returns fallback on malformed JSON', () => {
    expect(safeParseJson<number[]>('{not json', [9])).toEqual([9]);
  });

  it('returns fallback for null input', () => {
    expect(safeParseJson<string[]>(null, ['x'])).toEqual(['x']);
  });

  it('returns fallback for undefined input', () => {
    expect(safeParseJson<string[]>(undefined, [])).toEqual([]);
  });

  it('returns fallback for empty string', () => {
    expect(safeParseJson<Record<string, unknown>>('', { z: 1 })).toEqual({ z: 1 });
  });
});

// ────────────────────────────────────────────────────────────
// LANGUAGE_ENTRYPOINTS / LANGUAGE_STARTERS contract
// ────────────────────────────────────────────────────────────
describe('language tables', () => {
  const langs: IdeLanguage[] = ['ai-prompt', 'javascript', 'typescript', 'python', 'rust-wasm'];

  it('has an entrypoint for every language', () => {
    for (const l of langs) expect(LANGUAGE_ENTRYPOINTS[l]).toBeTruthy();
  });

  it('every starter declares its own entrypoint file', () => {
    for (const l of langs) {
      const entry = LANGUAGE_ENTRYPOINTS[l];
      expect(LANGUAGE_STARTERS[l][entry]).toBeTruthy();
    }
  });

  it('the language tables are frozen (immutable)', () => {
    expect(Object.isFrozen(LANGUAGE_ENTRYPOINTS)).toBe(true);
    expect(Object.isFrozen(LANGUAGE_STARTERS)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// pickEntrypoint
// ────────────────────────────────────────────────────────────
describe('pickEntrypoint', () => {
  it('returns the explicit entrypoint file when present', () => {
    const files = { 'src/index.js': 'JS_BODY', 'package.json': '{}' };
    expect(pickEntrypoint('javascript', files)).toBe('JS_BODY');
  });

  it('falls back to the first extension match for JS', () => {
    const files = { 'lib/foo.mjs': 'MJS_BODY' };
    expect(pickEntrypoint('javascript', files)).toBe('MJS_BODY');
  });

  it('falls back to a .py file for python', () => {
    const files = { 'app/main.py': 'PY_BODY' };
    expect(pickEntrypoint('python', files)).toBe('PY_BODY');
  });

  it('falls back to a .ts file for typescript', () => {
    const files = { 'handler.ts': 'TS_BODY' };
    expect(pickEntrypoint('typescript', files)).toBe('TS_BODY');
  });

  it('falls back to a .rs file for rust-wasm', () => {
    const files = { 'lib/thing.rs': 'RS_BODY' };
    expect(pickEntrypoint('rust-wasm', files)).toBe('RS_BODY');
  });

  it('falls back to a .md file for ai-prompt', () => {
    const files = { 'notes.md': 'PROMPT_BODY' };
    expect(pickEntrypoint('ai-prompt', files)).toBe('PROMPT_BODY');
  });

  it('returns empty string when no file matches the language', () => {
    const files = { 'README.txt': 'nope' };
    expect(pickEntrypoint('javascript', files)).toBe('');
  });

  it('returns empty string for an empty files object', () => {
    expect(pickEntrypoint('typescript', {})).toBe('');
  });

  it('prefers the explicit entrypoint over an extension match', () => {
    const files = { 'src/index.ts': 'EXPLICIT', 'other.ts': 'OTHER' };
    expect(pickEntrypoint('typescript', files)).toBe('EXPLICIT');
  });
});

// ────────────────────────────────────────────────────────────
// deployEndpointFromFiles
// ────────────────────────────────────────────────────────────
describe('deployEndpointFromFiles', () => {
  const base = { siteId: 'site-12345678', endpointSlug: 'invoice-webhook' };

  it('short-circuits ai-prompt with no upload', async () => {
    const res = await deployEndpointFromFiles(makeEnv(), {
      ...base,
      language: 'ai-prompt',
      files: { 'prompt.md': '# hi' },
    });
    expect(res).toEqual({ ok: true, scriptName: null, runtimePending: false, language: 'ai-prompt' });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockIsConfigured).not.toHaveBeenCalled();
  });

  it('defers python with runtimePending', async () => {
    const res = await deployEndpointFromFiles(makeEnv(), {
      ...base,
      language: 'python',
      files: { 'worker.py': 'pass' },
    });
    expect(res).toEqual({ ok: true, scriptName: null, runtimePending: true, language: 'python' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('defers rust-wasm with runtimePending', async () => {
    const res = await deployEndpointFromFiles(makeEnv(), {
      ...base,
      language: 'rust-wasm',
      files: { 'src/lib.rs': 'fn main(){}' },
    });
    expect(res).toEqual({ ok: true, scriptName: null, runtimePending: true, language: 'rust-wasm' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('defers JS with runtimePending when WFP is not configured', async () => {
    mockIsConfigured.mockReturnValue(false);
    const res = await deployEndpointFromFiles(makeEnv(), {
      ...base,
      language: 'javascript',
      files: { 'src/index.js': 'export default {}' },
    });
    expect(res).toEqual({ ok: true, scriptName: null, runtimePending: true, language: 'javascript' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('rejects an empty entrypoint with a 400', async () => {
    mockIsConfigured.mockReturnValue(true);
    const res = await deployEndpointFromFiles(makeEnv(), {
      ...base,
      language: 'javascript',
      files: { 'src/index.js': '   \n  ' },
    });
    expect(res).toEqual({ ok: false, error: 'Entrypoint file is empty', status: 400 });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('rejects when no entrypoint file resolves at all', async () => {
    mockIsConfigured.mockReturnValue(true);
    const res = await deployEndpointFromFiles(makeEnv(), {
      ...base,
      language: 'javascript',
      files: { 'README.txt': 'unrelated' },
    });
    expect(res).toEqual({ ok: false, error: 'Entrypoint file is empty', status: 400 });
  });

  it('uploads JS and returns the script name on success', async () => {
    mockIsConfigured.mockReturnValue(true);
    mockUpload.mockResolvedValue({ ok: true, scriptName: 'ai-site1234-invoice-webhook' });
    const res = await deployEndpointFromFiles(makeEnv(), {
      ...base,
      language: 'javascript',
      files: { 'src/index.js': 'export default { fetch() {} }' },
    });
    expect(res).toEqual({
      ok: true,
      scriptName: 'ai-site1234-invoice-webhook',
      runtimePending: false,
      language: 'javascript',
    });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][1]).toMatchObject({ language: 'javascript' });
  });

  it('coerces TypeScript to javascript for the WFP upload', async () => {
    mockIsConfigured.mockReturnValue(true);
    mockUpload.mockResolvedValue({ ok: true, scriptName: 'ai-site1234-invoice-webhook' });
    const res = await deployEndpointFromFiles(makeEnv(), {
      ...base,
      language: 'typescript',
      files: { 'src/index.ts': 'export default {} satisfies ExportedHandler;' },
    });
    expect(res).toMatchObject({ ok: true, language: 'typescript', runtimePending: false });
    // The uploader gets 'javascript', but the result preserves the source 'typescript'.
    expect(mockUpload.mock.calls[0][1].language).toBe('javascript');
  });

  it('surfaces an upstream upload failure as a 502', async () => {
    mockIsConfigured.mockReturnValue(true);
    mockUpload.mockResolvedValue({ ok: false, error: 'CF rejected the script', status: 400 });
    const res = await deployEndpointFromFiles(makeEnv(), {
      ...base,
      language: 'javascript',
      files: { 'src/index.js': 'export default {}' },
    });
    expect(res).toEqual({ ok: false, error: 'CF rejected the script', status: 502 });
  });
});
