/**
 * @module services/edit_intent_extractor
 * @description Maps a natural-language site-edit request to a structured,
 * validated {@link EditIntent} via Workers AI (Llama 3.3 70B FP8 Fast).
 *
 * Part of the **conversational_editing** feature module. The extractor produces
 * a *preview* of what an edit would do (which files, which operations) BEFORE
 * any changeset is applied — so the UI can show the user a plan and confidence
 * score first.
 *
 * @remarks
 * The model is asked to return strict JSON. We defensively parse + Zod-validate,
 * clamp `confidence` into [0, 1], and drop any operation whose target file is
 * not in the supplied file list (the model occasionally hallucinates paths).
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import {
  EditIntentSchema,
  type EditIntent,
  type EditOperationKind,
} from '../../libs/features/conversational_editing/feature.schemas.js';

/**
 * Workers AI model used for intent extraction. Llama 3.3 70B FP8 Fast —
 * 2-3× faster + free on Workers AI. NEVER the bare retired alias
 * `@cf/meta/llama-3.3-70b-instruct`.
 */
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const VALID_KINDS: readonly EditOperationKind[] = ['replace', 'insert', 'delete'];

/** Options for {@link extractEditIntent}. */
export interface ExtractEditIntentOptions {
  /** Natural-language edit request (e.g. "make hero darker, add pricing table"). */
  prompt: string;
  /** File paths available to the editor. */
  fileList: string[];
}

interface AiTextResult {
  response?: string;
}

/**
 * Clamp a possibly-out-of-range number into [0, 1]. Non-finite values fall
 * back to `0.5` (medium confidence) so a malformed model response never blocks
 * the preview.
 */
function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Best-effort extraction of the first JSON object from a model response that
 * may be wrapped in prose or markdown fences.
 */
function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Extract a structured edit intent from a natural-language request.
 *
 * @param env - Worker environment (provides the Workers AI binding).
 * @param opts - The prompt + available file list.
 * @returns A Zod-validated {@link EditIntent} with `confidence` clamped to [0, 1]
 *   and `targetFiles`/`operations` filtered to the supplied file list.
 *
 * @throws {Error} If the model response cannot be parsed into a valid intent.
 *
 * @example
 * ```ts
 * const intent = await extractEditIntent(env, {
 *   prompt: 'make the hero darker and add a pricing table',
 *   fileList: ['index.html', 'src/App.tsx'],
 * });
 * console.warn(intent.operations.length, intent.confidence);
 * ```
 */
export async function extractEditIntent(
  env: Env,
  opts: ExtractEditIntentOptions,
): Promise<EditIntent> {
  const fileList = opts.fileList ?? [];
  const fileSet = new Set(fileList);

  const system =
    'You are a precise web-editing planner. Given a natural-language site-edit ' +
    'request and a list of editable files, respond with STRICT JSON only ' +
    '(no prose, no markdown fences) matching this exact shape: ' +
    '{"rationale": string, "targetFiles": string[], "operations": ' +
    '[{"file": string, "kind": "replace"|"insert"|"delete", "description": string}], ' +
    '"confidence": number between 0 and 1}. ' +
    'Only reference files from the provided list. confidence reflects how ' +
    'unambiguously the request maps to concrete file operations.';

  const user =
    `EDIT REQUEST:\n${opts.prompt}\n\n` +
    `EDITABLE FILES:\n${fileList.length ? fileList.map((f) => `- ${f}`).join('\n') : '(none provided)'}`;

  const result = (await env.AI.run(MODEL as Parameters<typeof env.AI.run>[0], {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 1024,
  } as Parameters<typeof env.AI.run>[1])) as AiTextResult;

  const text = (result?.response ?? '').trim();
  if (!text) {
    throw new Error('Workers AI returned an empty response for edit-intent extraction');
  }

  const parsed = extractJsonObject(text) as Record<string, unknown>;

  // Normalise + clamp before Zod validation so a slightly-off model response
  // (e.g. confidence=1.4, an unknown op kind, a hallucinated path) still yields
  // a usable, schema-valid intent.
  const rawOps = Array.isArray(parsed.operations) ? parsed.operations : [];
  const operations = rawOps
    .map((op) => op as Record<string, unknown>)
    .filter((op) => typeof op.file === 'string' && (fileSet.size === 0 || fileSet.has(op.file as string)))
    .map((op) => ({
      file: op.file as string,
      kind: (VALID_KINDS.includes(op.kind as EditOperationKind) ? op.kind : 'replace') as EditOperationKind,
      description:
        typeof op.description === 'string' && op.description.length > 0
          ? (op.description as string)
          : 'Apply requested change',
    }));

  const rawTargets = Array.isArray(parsed.targetFiles) ? parsed.targetFiles : [];
  const targetFiles = rawTargets
    .filter((f): f is string => typeof f === 'string')
    .filter((f) => fileSet.size === 0 || fileSet.has(f));

  const candidate = {
    rationale:
      typeof parsed.rationale === 'string' && parsed.rationale.length > 0
        ? (parsed.rationale as string)
        : 'Mapped the request to file operations.',
    targetFiles,
    operations,
    confidence: clampConfidence(parsed.confidence),
  };

  return EditIntentSchema.parse(candidate);
}
