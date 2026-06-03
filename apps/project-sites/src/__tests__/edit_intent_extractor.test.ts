/**
 * Additive unit tests for `services/edit_intent_extractor.extractEditIntent`.
 *
 * The fp8-fast alias / confidence-clamp (>1, <0) / hallucinated-path drop /
 * markdown-fence parse / unknown-kind coercion / empty-response / no-JSON
 * branches are already exercised in `conversational_editing.test.ts`. This
 * spec covers the REMAINING branches without duplicating those:
 *  - non-finite confidence falls back to 0.5
 *  - empty/whitespace rationale gets the default rationale string
 *  - empty op description gets the default "Apply requested change" string
 *  - non-string targetFiles entries are filtered out
 *  - empty fileList disables the file-allowlist (any op file passes)
 *  - undefined opts.fileList defaults to []
 *  - non-array operations/targetFiles normalise to []
 *  - env.AI.run rejection propagates (no swallow)
 *  - confidence supplied as a numeric string is coerced
 *
 * ts-jest: `jest` is GLOBAL (do NOT import from '@jest/globals').
 */

import { extractEditIntent } from '../services/edit_intent_extractor.js';
import type { Env } from '../types/env.js';

/**
 * Build a minimal Env whose Workers AI binding returns the given response
 * string (or rejects, when `reject` is passed).
 */
function makeEnv(aiResponse?: string, reject?: Error): Env {
  const run = reject
    ? (jest.fn().mockRejectedValue(reject) as unknown as jest.Mock)
    : (jest.fn().mockResolvedValue({ response: aiResponse ?? '{}' }) as unknown as jest.Mock);
  return { AI: { run } } as unknown as Env;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('extractEditIntent — additive branch coverage', () => {
  it('falls back to confidence 0.5 when the model returns a non-finite value', async () => {
    const env = makeEnv(
      JSON.stringify({ rationale: 'x', targetFiles: [], operations: [], confidence: 'not-a-number' }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: [] });
    expect(intent.confidence).toBe(0.5);
  });

  it('coerces a numeric-string confidence into a number', async () => {
    const env = makeEnv(
      JSON.stringify({ rationale: 'x', targetFiles: [], operations: [], confidence: '0.42' }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: [] });
    expect(intent.confidence).toBeCloseTo(0.42, 5);
  });

  it('supplies a default rationale when the model omits / empties it', async () => {
    const env = makeEnv(
      JSON.stringify({ rationale: '', targetFiles: [], operations: [], confidence: 0.5 }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: [] });
    expect(intent.rationale).toBe('Mapped the request to file operations.');
  });

  it('supplies a default rationale when rationale is entirely missing', async () => {
    const env = makeEnv(JSON.stringify({ targetFiles: [], operations: [], confidence: 0.3 }));
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: [] });
    expect(intent.rationale).toBe('Mapped the request to file operations.');
  });

  it('supplies a default operation description when the model omits it', async () => {
    const env = makeEnv(
      JSON.stringify({
        rationale: 'x',
        targetFiles: ['a.txt'],
        operations: [{ file: 'a.txt', kind: 'insert', description: '' }],
        confidence: 0.5,
      }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: ['a.txt'] });
    expect(intent.operations).toHaveLength(1);
    expect(intent.operations[0].description).toBe('Apply requested change');
  });

  it('filters out non-string entries from targetFiles', async () => {
    const env = makeEnv(
      JSON.stringify({
        rationale: 'x',
        targetFiles: ['a.txt', 42, null, 'b.txt'],
        operations: [],
        confidence: 0.5,
      }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: ['a.txt', 'b.txt'] });
    expect(intent.targetFiles).toEqual(['a.txt', 'b.txt']);
  });

  it('keeps every op file when the file list is empty (allowlist disabled)', async () => {
    const env = makeEnv(
      JSON.stringify({
        rationale: 'x',
        targetFiles: ['anything.tsx'],
        operations: [
          { file: 'anything.tsx', kind: 'replace', description: 'd' },
          { file: 'whatever.css', kind: 'insert', description: 'e' },
        ],
        confidence: 0.5,
      }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: [] });
    expect(intent.operations).toHaveLength(2);
    expect(intent.targetFiles).toEqual(['anything.tsx']);
  });

  it('defaults a missing fileList to [] (no throw, allowlist disabled)', async () => {
    const env = makeEnv(
      JSON.stringify({
        rationale: 'x',
        targetFiles: ['z.html'],
        operations: [{ file: 'z.html', kind: 'replace', description: 'd' }],
        confidence: 0.5,
      }),
    );
    // fileList intentionally omitted — exercises `opts.fileList ?? []`.
    const intent = await extractEditIntent(env, { prompt: 'p' } as unknown as {
      prompt: string;
      fileList: string[];
    });
    expect(intent.operations).toHaveLength(1);
  });

  it('normalises a non-array operations field to an empty list', async () => {
    const env = makeEnv(
      JSON.stringify({ rationale: 'x', targetFiles: [], operations: 'oops', confidence: 0.5 }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: [] });
    expect(intent.operations).toEqual([]);
  });

  it('normalises a non-array targetFiles field to an empty list', async () => {
    const env = makeEnv(
      JSON.stringify({ rationale: 'x', targetFiles: 'oops', operations: [], confidence: 0.5 }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: [] });
    expect(intent.targetFiles).toEqual([]);
  });

  it('drops operations whose file field is not a string', async () => {
    const env = makeEnv(
      JSON.stringify({
        rationale: 'x',
        targetFiles: [],
        operations: [
          { file: 123, kind: 'replace', description: 'd' },
          { file: 'ok.txt', kind: 'replace', description: 'd' },
        ],
        confidence: 0.5,
      }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: ['ok.txt'] });
    expect(intent.operations).toHaveLength(1);
    expect(intent.operations[0].file).toBe('ok.txt');
  });

  it('propagates an env.AI.run rejection (does not swallow infra failure)', async () => {
    const env = makeEnv(undefined, new Error('Workers AI unavailable'));
    await expect(
      extractEditIntent(env, { prompt: 'p', fileList: [] }),
    ).rejects.toThrow('Workers AI unavailable');
  });

  it('trims surrounding whitespace before JSON extraction', async () => {
    const env = makeEnv(
      `\n\n   {"rationale":"trimmed","targetFiles":[],"operations":[],"confidence":0.6}   \n`,
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: [] });
    expect(intent.rationale).toBe('trimmed');
    expect(intent.confidence).toBeCloseTo(0.6, 5);
  });

  it('throws when the result object has no response field', async () => {
    const run = jest.fn().mockResolvedValue({}) as unknown as jest.Mock;
    const env = { AI: { run } } as unknown as Env;
    await expect(
      extractEditIntent(env, { prompt: 'p', fileList: [] }),
    ).rejects.toThrow('empty response');
  });
});
