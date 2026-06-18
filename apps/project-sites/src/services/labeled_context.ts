/**
 * @module services/labeled_context
 *
 * @description
 * AI context-quality axis (item #2, per `_ULTIMATE_LOOP.prompt.md`). Assembles the
 * retrieved/known context for a generation into clearly LABELED blocks —
 * `SYSTEM`, `RETRIEVED_FACTS`, `BRAND`, `CONSTRAINTS`, `EXAMPLES` — so the model
 * treats retrieved/third-party content as DATA inside a fenced section, never as
 * instructions to follow. This is a prompt-injection defense (`ai-agent-security`)
 * AND a quality lever (dense, ordered, scannable context beats a prose dump).
 *
 * @remarks
 * - PURE + TOTAL: no I/O, never throws. Missing/blank sections are omitted (no
 *   empty headers). `undefined`/`{}` input → `''`.
 * - Block ORDER is fixed + deterministic so the cacheable prefix is stable
 *   (`prompt-cache`): SYSTEM → RETRIEVED_FACTS → BRAND → CONSTRAINTS → EXAMPLES.
 *
 * @example
 * ```ts
 * const ctx = assembleLabeledContext({
 *   system: 'You build gorgeous SMB websites.',
 *   retrievedFacts: ['Open 9-5 Mon-Fri', 'Located in Newark, NJ'],
 *   brand: 'cyan/black, JetBrains Mono',
 *   constraints: ['No banned slop words', 'WCAG 2.2 AA'],
 * });
 * // → "=== SYSTEM ===\n...\n\n=== RETRIEVED_FACTS ===\n- Open 9-5 Mon-Fri\n..."
 * ```
 */

/** The sections of an assembled generation context. */
export interface LabeledContextSections {
  /** System instruction prose (the only block that IS an instruction). */
  system?: string;
  /** Retrieved facts — rendered as a bulleted DATA block, never instructions. */
  retrievedFacts?: string[];
  /** Brand tokens / voice prose. */
  brand?: string;
  /** Hard constraints the output must satisfy. */
  constraints?: string[];
  /** Few-shot exemplars. */
  examples?: string[];
}

/** Trim + drop blank entries from a string list. */
function cleanList(items: string[] | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((s) => (typeof s === 'string' ? s.trim() : '')).filter((s) => s.length > 0);
}

/** Render a prose block, or null when empty. */
function proseBlock(header: string, value: string | undefined): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  return v.length === 0 ? null : `=== ${header} ===\n${v}`;
}

/** Render a bulleted block, or null when empty. */
function listBlock(header: string, items: string[] | undefined): string | null {
  const cleaned = cleanList(items);
  return cleaned.length === 0
    ? null
    : `=== ${header} ===\n${cleaned.map((i) => `- ${i}`).join('\n')}`;
}

/**
 * Assemble context sections into ordered, labeled blocks.
 *
 * @param sections - The available context pieces (any subset).
 * @returns The labeled context string; `''` when nothing is provided.
 */
export function assembleLabeledContext(sections: LabeledContextSections): string {
  const s = sections ?? {};
  const blocks = [
    proseBlock('SYSTEM', s.system),
    listBlock('RETRIEVED_FACTS', s.retrievedFacts),
    proseBlock('BRAND', s.brand),
    listBlock('CONSTRAINTS', s.constraints),
    listBlock('EXAMPLES', s.examples),
  ].filter((b): b is string => b !== null);

  return blocks.join('\n\n');
}
