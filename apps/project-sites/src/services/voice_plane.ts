/**
 * @module voice_plane
 * @remarks
 * PL15 — Maps LiveKit voice-agent call transcripts into Plane work items. The
 * voice agent runs Deepgram STT → gpt-4o-mini text inference. This module
 * converts the structured call output into Plane issue shapes.
 *
 * Pure, never throws, zero I/O.
 *
 * @example
 * ```ts
 * const call: VoiceCall = { id: 'call_1', transcript: 'I need to report a bug', durationMs: 120_000 };
 * const intent = classifyIntent(call);
 * // intent.intent === 'create_issue'
 * ```
 */

/** A single voice-agent call transcript with metadata from LiveKit. */
export interface VoiceCall {
  /** Unique call identifier from LiveKit. */
  readonly id: string;
  /** Full transcript text from the voice agent (Deepgram STT → gpt-4o-mini). */
  readonly transcript: string;
  /** Optional caller identifier (phone number or SIP URI). */
  readonly caller?: string;
  /** Call duration in milliseconds. */
  readonly durationMs: number;
}

/** Classified intent of a voice call with confidence score. */
export interface VoiceIntent {
  /** The action the caller intends to take. */
  readonly intent: 'create_issue' | 'create_task' | 'log_note' | 'unknown';
  /** Confidence score between 0 and 1. */
  readonly confidence: number;
}

/* ── Intent classification ──────────────────────────────────────────── */

const INTENT_PATTERNS: Record<Exclude<VoiceIntent['intent'], 'unknown'>, RegExp[]> = {
  create_issue: [
    /(?:file|report|open|create|submit)\s+(?:a\s+)?(?:bug|issue|problem|ticket)/i,
    /(?:there(?:'s| is)\s+(?:a\s+)?(?:problem|bug|issue|error))/i,
    /(?:something\s+(?:is|seems)\s+(?:broken|wrong|not\s+working))/i,
    /(?:i\s+(?:need|want)\s+to\s+(?:report|file))/i,
  ],
  create_task: [
    /(?:create|add|make|set\s+up)\s+(?:a\s+)?(?:task|to-do|todo|action\s+item)/i,
    /(?:i\s+(?:need|want)\s+someone\s+to)/i,
    /(?:can\s+you\s+(?:create|add|make)\s+(?:a\s+)?(?:task|to-do))/i,
    /(?:please\s+(?:create|add|make)\s+(?:a\s+)?(?:task|to-do))/i,
  ],
  log_note: [
    /(?:just\s+)?(?:wanted\s+to\s+)?(?:note|log|record|document|write\s+down)/i,
    /(?:for\s+(?:the\s+)?record)/i,
    /(?:make\s+(?:a\s+)?note)/i,
    /(?:here(?:'s| is)\s+(?:the\s+)?(?:update|status|summary))/i,
  ],
};

const MIN_CONFIDENCE = 0.25;

/**
 * Classifies the call intent from a voice transcript by matching known
 * linguistic patterns. Returns the best-matching intent with a confidence
 * score between 0 and 1. When multiple intents match, the highest-confidence
 * one wins. Returns `{ intent: 'unknown', confidence: 0 }` when nothing
 * exceeds `MIN_CONFIDENCE`.
 *
 * @param call - The voice call transcript and metadata.
 * @returns The classified intent with confidence score.
 *
 * @example
 * ```ts
 * const call: VoiceCall = { id: 'c1', transcript: 'I need to report a bug', durationMs: 45000 };
 * classifyIntent(call);
 * // → { intent: 'create_issue', confidence: 0.5 }
 * ```
 */
export function classifyIntent(call: VoiceCall): VoiceIntent {
  const t = call.transcript;
  let best: VoiceIntent = { confidence: 0, intent: 'unknown' };

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    let matches = 0;
    for (const pattern of patterns) {
      if (pattern.test(t)) matches++;
    }
    if (matches > 0) {
      const confidence = Math.min(matches / patterns.length, 1);
      if (confidence > best.confidence) {
        best = { confidence, intent: intent as VoiceIntent['intent'] };
      }
    }
  }

  // Floor: unknown if below minimum confidence
  if (best.confidence < MIN_CONFIDENCE) {
    return { confidence: 0, intent: 'unknown' };
  }

  return best;
}

/* ── Voice call → Plane issue ───────────────────────────────────────── */

/**
 * Converts a voice call classified as `create_issue` into a Plane-compatible
 * issue shape. Extracts a title from the first substantive sentence and builds
 * a description with caller metadata and the full transcript. Priority is
 * inferred from urgency keywords in the transcript.
 *
 * @param call - The voice call transcript and metadata.
 * @returns A Plane-compatible issue object.
 *
 * @example
 * ```ts
 * const call: VoiceCall = { id: 'c1', transcript: 'The login crashes when I click submit.', caller: '+15551234567', durationMs: 90000 };
 * voiceCallToIssue(call);
 * // → { title: 'The login crashes when I click submit.', description: '...\n**Caller:** +15551234567\n...', priority: 'medium', labels: ['voice'] }
 * ```
 */
export function voiceCallToIssue(call: VoiceCall): {
  title: string;
  description: string;
  priority: string;
  labels: string[];
} {
  const callerInfo = extractCaller(call.transcript);
  const t = call.transcript.trim();

  // Title: first sentence or first 80 chars
  const firstSentence = t.match(/^[^.!?]*[.!?]/)?.[0]?.trim() ?? t.slice(0, 80).trim();
  const title =
    firstSentence && firstSentence.length > 10 ? firstSentence : `Voice call ${call.id}`;

  // Description: full transcript + metadata appendix
  const metaLines: string[] = [
    '',
    '---',
    `**Call ID:** ${call.id}`,
    `**Duration:** ${formatDuration(call.durationMs)}`,
    `**Source:** LiveKit voice agent`,
  ];
  if (call.caller) metaLines.push(`**Caller:** ${call.caller}`);
  if (callerInfo.name) metaLines.push(`**Caller Name:** ${callerInfo.name}`);
  if (callerInfo.company) metaLines.push(`**Company:** ${callerInfo.company}`);

  const description = ['## Voice Call Transcript', '', t, ...metaLines].join('\n');

  const priority = inferPriority(t);

  return { description, labels: ['voice'], priority, title };
}

/* ── Caller extraction ──────────────────────────────────────────────── */

/**
 * Extracts the caller's name and company from the opening of a transcript.
 * Scans the first 300 characters for patterns like "my name is X",
 * "this is X from Y", or "I'm X".
 *
 * @param transcript - The full call transcript.
 * @returns An object with the extracted name and company (or null when not found).
 *
 * @example
 * ```ts
 * extractCaller("Hi, my name is Jane Smith from Acme Corp. I'm calling about...");
 * // → { name: 'Jane Smith', company: 'Acme Corp' }
 * ```
 */
export function extractCaller(transcript: string): {
  name: string | null;
  company: string | null;
} {
  const opening = transcript.slice(0, 300);

  // "my name is X" / "this is X" / "I’m X" / "calling as X"
  // Name stops before a stop-word (from/at/and/about/regarding/is/calling) or punctuation.
  const nameFromMatch =
    opening.match(
      /(?:my\s+name\s+is|this\s+is|i['‘’]m|calling\s+as)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?=\s+(?:from|at|and|on|about|regarding|calling|is)\b|[.,;!?]|$)/i,
    )?.[1] ?? null;

  // "from Y" / "at Y" where Y looks like an organization name
  const rawCompany =
    opening
      .match(
        /(?:from|at)\s+([A-Z][A-Za-z0-9\s&.]+?)(?:\.|,|$|\s+(?:and|on|about|regarding|i['’]m))/,
      )?.[1]
      ?.trim() ?? null;

  // Filter out common false-positive company words
  const FALSE_COMPANIES = new Set([
    'the',
    'a',
    'an',
    'this',
    'that',
    'home',
    'work',
    'office',
    'phone',
    'here',
    'there',
  ]);
  const company = rawCompany && !FALSE_COMPANIES.has(rawCompany.toLowerCase()) ? rawCompany : null;

  return { company, name: nameFromMatch };
}

/* ── Private helpers ────────────────────────────────────────────────── */

const URGENT_KEYWORDS =
  /\b(?:urgent|critical|blocker|emergency|asap|immediately|crashes|down|outage|production|broken)\b/i;
const HIGH_KEYWORDS = /\b(?:important|high|priority|error|fail(?:ed|ure)?|cannot|can't|won't)\b/i;

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function inferPriority(transcript: string): string {
  if (URGENT_KEYWORDS.test(transcript)) return 'urgent';
  if (HIGH_KEYWORDS.test(transcript)) return 'high';
  return 'medium';
}
