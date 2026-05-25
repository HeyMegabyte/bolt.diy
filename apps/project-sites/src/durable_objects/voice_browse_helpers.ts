/**
 * @module durable_objects/voice_browse_helpers
 *
 * @description
 * Pure helpers extracted from `voice_browse_agent.ts` so they can be unit-
 * tested in Node without dragging in the `@cloudflare/containers` ESM
 * runtime (which Jest can't load without an extra transformer).
 *
 * Every load-bearing invariant of the Voice Browse Agent lives here:
 *   - {@link sanitisePII} — strip CC/SSN/password patterns
 *   - {@link chunkNarration} — letter-by-letter SSE chunking
 *   - {@link shouldRestart} — 3-per-rolling-minute cap
 *   - {@link dispatchAction} — tool-call normalisation
 *   - {@link narrateAction} — action → narration string
 *
 * @packageDocumentation
 */

/** Supported in-page actions chosen by the agentic loop or remote caller. */
export type BrowseAction =
  | { type: 'goto'; url: string }
  | { type: 'click'; selector: string }
  | { type: 'type'; selector: string; text: string }
  | { type: 'extract'; selector: string }
  | { type: 'screenshot' }
  | { type: 'wait'; selector?: string; ms?: number };

// ── Restart-window constants (mirrored by the DO class) ─────────────────────

/** Rolling-window length used by `shouldRestart`. */
export const RESTART_WINDOW_MS = 60_000;
/** Max restart attempts permitted inside the rolling window. */
export const RESTART_MAX_PER_WINDOW = 3;

// ── PII sanitisation ────────────────────────────────────────────────────────

/** 13-19 digit run with optional separators — matches Visa/MC/Amex/Discover. */
const CC_RE = /\b(?:\d[ -]?){13,19}\b/g;
/** US SSN. */
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
/** Likely password values in `password=foo`, `pwd:foo`, `secret = foo`. */
const PASSWORD_RE = /(password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*\S+/gi;
/** CVV trailing a card number ("4111... cvv 123"). */
const CVV_RE = /\bcvv\s*[:=]?\s*\d{3,4}\b/gi;

/**
 * Strip credit-card, SSN, and password-shaped substrings from text destined
 * for the narration log or voice stream. Called on EVERY string before
 * persistence — defence-in-depth even if the LLM caller forgot to redact.
 */
export function sanitisePII(text: string): string {
  return text
    .replace(CC_RE, (m) => maskNumber(m))
    .replace(SSN_RE, '[ssn]')
    .replace(PASSWORD_RE, (_m, label: string) => `${label}=[redacted]`)
    .replace(CVV_RE, 'cvv [redacted]');
}

function maskNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 13) return raw;
  return `[card ending ${digits.slice(-4)}]`;
}

// ── Letter-by-letter narration ──────────────────────────────────────────────

/**
 * Split a narration string into incremental SSE frames so the voice TTS
 * stream can begin synthesising the first phoneme before the full sentence
 * is ready. Coalesces on word boundaries so partial tokens never reach
 * the TTS engine.
 */
export function chunkNarration(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (/[\s.,;:!?]/.test(ch)) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

// ── Tool dispatch validation ────────────────────────────────────────────────

/**
 * Validate + normalise a `BrowseAction` arriving from the agentic loop or
 * the remote caller. Returns a normalised action or throws with a
 * human-readable message.
 */
export function dispatchAction(action: unknown): BrowseAction {
  if (!action || typeof action !== 'object') {
    throw new Error('action must be an object');
  }
  const a = action as Record<string, unknown>;
  switch (a.type) {
    case 'goto':
      if (typeof a.url !== 'string' || !/^https?:\/\//i.test(a.url)) {
        throw new Error('goto requires an http(s) url');
      }
      return { type: 'goto', url: a.url };
    case 'click':
      if (typeof a.selector !== 'string' || !a.selector) {
        throw new Error('click requires a selector');
      }
      return { type: 'click', selector: a.selector };
    case 'type':
      if (typeof a.selector !== 'string' || typeof a.text !== 'string') {
        throw new Error('type requires selector + text');
      }
      return { type: 'type', selector: a.selector, text: a.text };
    case 'extract':
      if (typeof a.selector !== 'string') {
        throw new Error('extract requires selector');
      }
      return { type: 'extract', selector: a.selector };
    case 'screenshot':
      return { type: 'screenshot' };
    case 'wait':
      if (a.selector !== undefined && typeof a.selector !== 'string') {
        throw new Error('wait.selector must be string');
      }
      if (a.ms !== undefined && typeof a.ms !== 'number') {
        throw new Error('wait.ms must be number');
      }
      return {
        type: 'wait',
        selector: typeof a.selector === 'string' ? a.selector : undefined,
        ms: typeof a.ms === 'number' ? a.ms : undefined,
      };
    default:
      throw new Error(`Unknown action type: ${String(a.type)}`);
  }
}

// ── Restart cap helper ──────────────────────────────────────────────────────

/**
 * Decide whether a new restart attempt should proceed. Returns true if the
 * `nowMs` timestamp is allowed under the 3-per-rolling-minute cap given
 * the historic timestamps array.
 */
export function shouldRestart(history: readonly number[], nowMs: number): boolean {
  const recent = history.filter((t) => nowMs - t < RESTART_WINDOW_MS);
  return recent.length < RESTART_MAX_PER_WINDOW;
}

// ── Narration string ────────────────────────────────────────────────────────

/** Human-readable narration for a given action. */
export function narrateAction(action: BrowseAction): string {
  switch (action.type) {
    case 'goto':
      return `Opening ${action.url}.`;
    case 'click':
      return `Clicking ${action.selector}.`;
    case 'type':
      return `Typing into ${action.selector}.`;
    case 'extract':
      return `Reading ${action.selector}.`;
    case 'screenshot':
      return 'Taking a screenshot.';
    case 'wait':
      return action.selector
        ? `Waiting for ${action.selector}.`
        : `Waiting ${action.ms ?? 0}ms.`;
  }
}
