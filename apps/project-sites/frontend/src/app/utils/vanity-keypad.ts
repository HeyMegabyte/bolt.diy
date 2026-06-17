/**
 * E.161 phone-keypad letter→digit mapping for the voice "Find a number" search.
 *
 * @remarks
 * Mirrors the worker's {@link letterToDigit} (`src/services/twilio.ts`) so the
 * live as-you-type preview in the Numbers tab ("MOVE = 6683") shows EXACTLY the
 * digits the `/api/voice/numbers/search?contains=` query resolves to. Letters
 * map to their keypad digit; every non-letter (digits, `*` wildcard, dashes,
 * spaces) passes through untouched — same contract as Twilio's `Contains=`.
 *
 * @example
 * ```ts
 * vanityToDigits('MOVE');      // '6683'
 * vanityToDigits('LABOR');     // '52267'
 * vanityToDigits('82LABOR');   // '8252267'
 * vanityToDigits('1-800-FLOWERS'); // '1-800-3569377'
 * ```
 */
const LETTER_DIGIT_MAP: Readonly<Record<string, string>> = {
  A: '2', B: '2', C: '2',
  D: '3', E: '3', F: '3',
  G: '4', H: '4', I: '4',
  J: '5', K: '5', L: '5',
  M: '6', N: '6', O: '6',
  P: '7', Q: '7', R: '7', S: '7',
  T: '8', U: '8', V: '8',
  W: '9', X: '9', Y: '9', Z: '9',
};

/**
 * Convert every A-Z letter (case-insensitive) in `input` to its E.161 keypad
 * digit. Non-letters pass through untouched.
 *
 * @param input - A vanity word or mixed word/digit search query.
 * @returns The keypad-digit rendering, non-letters preserved.
 */
export function vanityToDigits(input: string): string {
  let out = '';
  for (const ch of input) out += LETTER_DIGIT_MAP[ch.toUpperCase()] ?? ch;
  return out;
}

/**
 * Whether `input` contains at least one A-Z letter — i.e. a keypad preview
 * would differ from the raw input and is worth showing.
 *
 * @param input - The raw search query.
 * @returns `true` when a digit preview adds information.
 */
export function hasVanityLetters(input: string): boolean {
  return /[A-Za-z]/.test(input);
}
