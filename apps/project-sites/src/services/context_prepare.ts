import { buildContextManifest, type ContextManifest } from './context_manifest.js';
/**
 * @module services/context_prepare
 *
 * @description
 * The AI context-quality axis CAPSTONE (per `_ULTIMATE_LOOP.prompt.md` § AI
 * context-quality axis). Composes the four pure primitives into the single call
 * the generation pipeline makes before invoking a model:
 *
 *  1. {@link assembleLabeledContext} → the labeled context string to send.
 *  2. {@link buildContextManifest} → the per-section fingerprint for the trace.
 *  3. {@link computeContextReadiness} → the slots/retrieval/confidence verdict.
 *
 * Returns the context, its manifest, the readiness result, and a single `ready`
 * go/no-go flag — so a caller does: `const c = prepareContext(...); if (!c.ready)
 * fetchMissing(c.readiness.missingSlots); else generate(c.context)`. The reranker
 * (`packByBudget` consumes its scores) is an upstream pre-step the caller applies
 * to `sections.retrievedFacts`; this composer is assemble + fingerprint + gate.
 *
 * @remarks PURE + TOTAL + DETERMINISTIC: no I/O, never throws.
 */
import {
  computeContextReadiness,
  type ContextReadinessInput,
  type ContextReadinessResult,
} from './context_readiness.js';
import { assembleLabeledContext, type LabeledContextSections } from './labeled_context.js';

export interface PrepareContextInput {
  /** The context sections to assemble (any subset). */
  sections: LabeledContextSections;
  /** The slots/retrieval/confidence snapshot for the readiness gate. */
  readiness: ContextReadinessInput;
  /** Optional readiness threshold override (default 70). */
  threshold?: number;
}

export interface PreparedContext {
  /** The assembled labeled context string to send to the model. */
  context: string;
  /** Per-section fingerprint + sizes for the generation trace. */
  manifest: ContextManifest;
  /** The full readiness verdict (score, missing slots, reasons). */
  readiness: ContextReadinessResult;
  /** Go/no-go: true only when readiness passed. Mirror of `readiness.ready`. */
  ready: boolean;
}

/** Flatten labeled sections into a name→string map for the manifest. */
function toManifestMap(sections: LabeledContextSections): Record<string, string> {
  const s = sections ?? {};
  const map: Record<string, string> = {};
  if (typeof s.system === 'string' && s.system.trim()) map.system = s.system;
  if (Array.isArray(s.retrievedFacts) && s.retrievedFacts.length)
    map.retrievedFacts = s.retrievedFacts.join('\n');
  if (typeof s.brand === 'string' && s.brand.trim()) map.brand = s.brand;
  if (Array.isArray(s.constraints) && s.constraints.length)
    map.constraints = s.constraints.join('\n');
  if (Array.isArray(s.examples) && s.examples.length) map.examples = s.examples.join('\n');
  return map;
}

/**
 * Assemble, fingerprint, and gate a generation context in one call.
 *
 * @param input - Sections + readiness snapshot (+ optional threshold).
 * @returns The context to send, its trace manifest, and the go/no-go verdict.
 */
export function prepareContext(input: PrepareContextInput): PreparedContext {
  const sections = input?.sections ?? {};
  const context = assembleLabeledContext(sections);
  const manifest = buildContextManifest(toManifestMap(sections));
  const readiness = computeContextReadiness(
    input?.readiness,
    input?.threshold === undefined ? {} : { threshold: input.threshold },
  );
  return { context, manifest, readiness, ready: readiness.ready };
}
