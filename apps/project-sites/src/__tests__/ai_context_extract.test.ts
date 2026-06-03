/**
 * ai_context_extract — text/vision extraction for AI chat context files.
 *
 * The service wraps OpenAI gpt-4o-mini Vision (via global `fetch`) for PDFs +
 * images, and a plain UTF-8 decode for text/JSON. This suite locks the contract
 * directly by mocking the global `fetch` (never a real OpenAI call) and exercises:
 *   1. toDataUrl       — base64 data-URL shape, chunked btoa over the 0x8000
 *      boundary (>32KB inputs), MIME interpolation,
 *   2. visionExtract   — no-API-key short-circuit (''), happy-path content trim,
 *      non-ok response → '', thrown fetch → '' (resilience), missing-choices → '',
 *      correct request URL + model + auth header,
 *   3. extractPdf      — single Vision call, pages_processed 1 when text / 0 when
 *      empty, truncated:false, application/pdf data URL,
 *   4. extractImage    — Vision call, MIME pass-through + image/png default,
 *      pages_processed math,
 *   5. extractContext  — MIME dispatch: pdf / *​/pdf suffix, image/*, text/* +
 *      application/json UTF-8 decode + 200_000 truncation cap + truncated flag,
 *      unrecognized binary → empty result, empty/missing MIME default branch,
 *   6. constants       — MAX_VISION_CALLS_PER_FILE + MAX_CONTEXT_FILE_BYTES.
 *
 * ts-jest: GLOBAL `jest` (no @jest/globals import). All AI/fetch I/O mocked; no real APIs.
 */
import {
  toDataUrl,
  visionExtract,
  extractPdf,
  extractImage,
  extractContext,
  MAX_VISION_CALLS_PER_FILE,
  MAX_CONTEXT_FILE_BYTES,
  type ExtractResult,
} from '../services/ai_context_extract.js';
import type { Env } from '../types/env.js';

const makeEnv = (key?: string): Env => ({ OPENAI_API_KEY: key } as unknown as Env);

/** Build a Vision chat-completions OK response with the given content. */
const okVision = (content: string | null): Response =>
  ({
    ok: true,
    json: async () => ({ choices: content === null ? [] : [{ message: { content } }] }),
  }) as unknown as Response;

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

// ─── toDataUrl ───────────────────────────────────────────────────
describe('toDataUrl', () => {
  it('encodes bytes as a base64 data URL with the given MIME', () => {
    const bytes = new Uint8Array([72, 105]); // "Hi"
    const url = toDataUrl(bytes, 'image/png');
    expect(url).toBe(`data:image/png;base64,${btoa('Hi')}`);
  });

  it('chunks over the 0x8000 boundary without corrupting large inputs', () => {
    const len = 0x8000 + 10; // forces a second subarray chunk
    const bytes = new Uint8Array(len).fill(65); // 'A' repeated
    const url = toDataUrl(bytes, 'application/octet-stream');
    expect(url.startsWith('data:application/octet-stream;base64,')).toBe(true);
    const b64 = url.split(',')[1];
    // round-trip back to verify integrity
    const decoded = atob(b64);
    expect(decoded.length).toBe(len);
    expect(decoded).toBe('A'.repeat(len));
  });
});

// ─── visionExtract ───────────────────────────────────────────────
describe('visionExtract', () => {
  it('returns "" immediately when OPENAI_API_KEY is missing (no fetch)', async () => {
    const out = await visionExtract(makeEnv(undefined), 'data:image/png;base64,xx', 'go');
    expect(out).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns trimmed model content on a successful call', async () => {
    fetchMock.mockResolvedValue(okVision('  extracted text  '));
    const out = await visionExtract(makeEnv('sk-test'), 'data:image/png;base64,xx', 'go');
    expect(out).toBe('extracted text');
  });

  it('sends the correct URL, model, and auth header', async () => {
    fetchMock.mockResolvedValue(okVision('ok'));
    await visionExtract(makeEnv('sk-secret'), 'data:image/png;base64,xx', 'transcribe');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-secret');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0].content[0].text).toBe('transcribe');
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/png;base64,xx');
  });

  it('returns "" when the response is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response);
    const out = await visionExtract(makeEnv('sk-test'), 'data:image/png;base64,xx', 'go');
    expect(out).toBe('');
  });

  it('returns "" when the fetch throws (resilient, never propagates)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const out = await visionExtract(makeEnv('sk-test'), 'data:image/png;base64,xx', 'go');
    expect(out).toBe('');
  });

  it('returns "" when choices are empty / content missing', async () => {
    fetchMock.mockResolvedValue(okVision(null));
    const out = await visionExtract(makeEnv('sk-test'), 'data:image/png;base64,xx', 'go');
    expect(out).toBe('');
  });
});

// ─── extractPdf ──────────────────────────────────────────────────
describe('extractPdf', () => {
  it('extracts text via one Vision call and reports 1 page', async () => {
    fetchMock.mockResolvedValue(okVision('## Heading\nbody'));
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const res = await extractPdf(makeEnv('sk-test'), buf);
    expect(res.text).toBe('## Heading\nbody');
    expect(res.pages_processed).toBe(1);
    expect(res.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content[1].image_url.url.startsWith('data:application/pdf;base64,')).toBe(
      true,
    );
  });

  it('reports 0 pages when extraction yields no text', async () => {
    fetchMock.mockResolvedValue(okVision(''));
    const res = await extractPdf(makeEnv('sk-test'), new Uint8Array([1]).buffer);
    expect(res.text).toBe('');
    expect(res.pages_processed).toBe(0);
  });

  it('reports 0 pages when the API key is absent (no call made)', async () => {
    const res = await extractPdf(makeEnv(undefined), new Uint8Array([1]).buffer);
    expect(res.pages_processed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── extractImage ────────────────────────────────────────────────
describe('extractImage', () => {
  it('extracts text and passes the supplied MIME through', async () => {
    fetchMock.mockResolvedValue(okVision('image text'));
    const res = await extractImage(makeEnv('sk-test'), new Uint8Array([9]).buffer, 'image/jpeg');
    expect(res.text).toBe('image text');
    expect(res.pages_processed).toBe(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,')).toBe(
      true,
    );
  });

  it('defaults to image/png when MIME is empty', async () => {
    fetchMock.mockResolvedValue(okVision('x'));
    await extractImage(makeEnv('sk-test'), new Uint8Array([9]).buffer, '');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,')).toBe(
      true,
    );
  });

  it('reports 0 pages when no text is returned', async () => {
    fetchMock.mockResolvedValue(okVision(''));
    const res = await extractImage(makeEnv('sk-test'), new Uint8Array([9]).buffer, 'image/png');
    expect(res.pages_processed).toBe(0);
  });
});

// ─── extractContext (MIME dispatch) ──────────────────────────────
describe('extractContext', () => {
  it('routes application/pdf to the PDF extractor', async () => {
    fetchMock.mockResolvedValue(okVision('pdf text'));
    const res = await extractContext(makeEnv('sk-test'), new Uint8Array([1]).buffer, 'application/pdf');
    expect(res.text).toBe('pdf text');
    expect(res.pages_processed).toBe(1);
  });

  it('routes a "/pdf"-suffixed MIME (e.g. uppercase) to the PDF extractor', async () => {
    fetchMock.mockResolvedValue(okVision('pdf2'));
    const res = await extractContext(makeEnv('sk-test'), new Uint8Array([1]).buffer, 'X/PDF');
    expect(res.text).toBe('pdf2');
  });

  it('routes image/* to the image extractor', async () => {
    fetchMock.mockResolvedValue(okVision('img'));
    const res = await extractContext(makeEnv('sk-test'), new Uint8Array([1]).buffer, 'image/webp');
    expect(res.text).toBe('img');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content[1].image_url.url.startsWith('data:image/webp;base64,')).toBe(
      true,
    );
  });

  it('decodes text/* as UTF-8 without any Vision call', async () => {
    const buf = new TextEncoder().encode('plain body').buffer;
    const res = await extractContext(makeEnv('sk-test'), buf, 'text/plain');
    expect(res.text).toBe('plain body');
    expect(res.pages_processed).toBe(1);
    expect(res.truncated).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('decodes application/json as UTF-8', async () => {
    const buf = new TextEncoder().encode('{"a":1}').buffer;
    const res = await extractContext(makeEnv('sk-test'), buf, 'application/json');
    expect(res.text).toBe('{"a":1}');
    expect(res.pages_processed).toBe(1);
  });

  it('truncates text bodies over 200_000 chars and sets truncated:true', async () => {
    const big = 'a'.repeat(200_050);
    const buf = new TextEncoder().encode(big).buffer;
    const res = await extractContext(makeEnv('sk-test'), buf, 'text/markdown');
    expect(res.text.length).toBe(200_000);
    expect(res.truncated).toBe(true);
  });

  it('returns an empty result for unrecognized binary MIME types', async () => {
    const res = await extractContext(
      makeEnv('sk-test'),
      new Uint8Array([1, 2]).buffer,
      'application/octet-stream',
    );
    const expected: ExtractResult = { text: '', pages_processed: 0, truncated: false };
    expect(res).toEqual(expected);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats empty/missing MIME as unrecognized binary (default branch)', async () => {
    const res = await extractContext(makeEnv('sk-test'), new Uint8Array([1]).buffer, '');
    expect(res).toEqual({ text: '', pages_processed: 0, truncated: false });
  });
});

// ─── constants ───────────────────────────────────────────────────
describe('budget constants', () => {
  it('caps Vision calls per file at 4', () => {
    expect(MAX_VISION_CALLS_PER_FILE).toBe(4);
  });

  it('caps file size at 10 MB', () => {
    expect(MAX_CONTEXT_FILE_BYTES).toBe(10 * 1024 * 1024);
  });
});
