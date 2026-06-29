/**
 * FAQ-from-reviews — derive an HONEST FAQ from real customer reviews (#61).
 *
 * @remarks
 * Pure + extractive (no LLM, no I/O): clusters reviews by topic, and for topics
 * with enough corroboration emits a Q (templated per topic) + A (a representative
 * real-review sentence — actual customer language, never fabricated). The output
 * `{question, answer}[]` feeds the existing `seo_autopilot.buildJsonLd({kind:'FAQPage'})`
 * (which only emits FAQPage when real Q&A is passed) — so no JSON-LD is duplicated
 * here. Quality-gated: a topic must clear `minMentions` (default 3) or it is
 * dropped (quality over quota — never pad the FAQ to hit a count).
 *
 * @packageDocumentation
 */

/** A raw review (only the fields we read). */
export interface ReviewInput {
  text: string;
  rating?: number | null;
}

/** One derived FAQ entry. */
export interface FaqItem {
  question: string;
  /** A representative real-review sentence (extractive — customer's own words). */
  answer: string;
  /** How many reviews corroborated this topic. */
  mentions: number;
}

interface Topic {
  key: string;
  keywords: readonly string[];
  question: string;
}

/** Topic taxonomy — ordered by general business relevance. */
const TOPICS: readonly Topic[] = [
  {
    key: 'quality',
    keywords: ['quality', 'great work', 'excellent', 'best', 'amazing', 'top notch', 'professional'],
    question: 'What do customers say about the quality of the work?',
  },
  {
    key: 'service',
    keywords: ['service', 'helpful', 'attentive', 'responsive', 'accommodat', 'customer service'],
    question: 'How is the customer service?',
  },
  {
    key: 'staff',
    keywords: ['staff', 'friendly', 'team', 'owner', 'polite', 'welcoming', 'courteous'],
    question: 'What are the staff like?',
  },
  {
    key: 'value',
    keywords: ['price', 'value', 'affordable', 'reasonable', 'worth', 'fair', 'cost'],
    question: 'Is it good value for the price?',
  },
  {
    key: 'speed',
    keywords: ['fast', 'quick', 'on time', 'prompt', 'wait', 'timely', 'efficient'],
    question: 'How fast is the service?',
  },
  {
    key: 'cleanliness',
    keywords: ['clean', 'tidy', 'spotless', 'hygien', 'neat'],
    question: 'Is the place clean and well-kept?',
  },
];

/** Split a review into trimmed sentences. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Does the text mention any of the topic keywords (case-insensitive)? */
function mentionsTopic(lowerText: string, topic: Topic): boolean {
  return topic.keywords.some((kw) => lowerText.includes(kw));
}

/**
 * Pick the best representative sentence for a topic from a set of reviews:
 * prefer higher-rated reviews, then a clean, readable length (40–160 chars),
 * then the sentence that actually mentions a topic keyword.
 */
function representativeAnswer(reviews: ReviewInput[], topic: Topic): string | null {
  const ranked = [...reviews].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  for (const r of ranked) {
    const hit = sentences(r.text).find((s) => {
      const lower = s.toLowerCase();
      return mentionsTopic(lower, topic) && s.length >= 20 && s.length <= 200;
    });
    if (hit) return hit;
  }
  return null;
}

/**
 * Extract an honest, quality-gated FAQ from real reviews.
 *
 * @param reviews - Real customer reviews.
 * @param opts - `minMentions` (default 3) topic corroboration floor;
 *   `maxItems` (default 6) cap.
 * @returns Ranked {@link FaqItem}[] (most-corroborated first). Empty when no
 *   topic clears the floor — never pads.
 *
 * @example
 * ```ts
 * const faqs = extractReviewFaqs(reviews);
 * if (faqs.length) await buildJsonLd(env, { kind: 'FAQPage', faqs, ... });
 * ```
 */
export function extractReviewFaqs(
  reviews: readonly ReviewInput[],
  opts: { minMentions?: number; maxItems?: number } = {},
): FaqItem[] {
  const minMentions = opts.minMentions ?? 3;
  const maxItems = opts.maxItems ?? 6;
  const clean = reviews.filter((r) => typeof r.text === 'string' && r.text.trim().length > 0);

  const items: FaqItem[] = [];
  for (const topic of TOPICS) {
    const matching = clean.filter((r) => mentionsTopic(r.text.toLowerCase(), topic));
    if (matching.length < minMentions) continue; // quality gate — drop weak topics
    const answer = representativeAnswer(matching, topic);
    if (!answer) continue; // no clean representative sentence → skip, never fabricate
    items.push({ question: topic.question, answer, mentions: matching.length });
  }

  return items.sort((a, b) => b.mentions - a.mentions).slice(0, maxItems);
}
