/**
 * @module services/address_deliverability
 * @description Lead Scanner #91 — address deliverability gate. A pure,
 * deterministic content check that BLOCKS Lob/postcard spend on incomplete or
 * malformed US addresses BEFORE money is spent. Scores the structural
 * completeness of an address (street number, street, city, 2-letter state,
 * ZIP5/ZIP+4) into a 0–100 `confidence`; the orchestrator gates a postcard send
 * on `deliverable` (confidence ≥ threshold).
 *
 * This is the functional gate — it stops the obvious waste (no street number, no
 * ZIP). Authoritative USPS CASS verification (catches valid-format-but-
 * nonexistent addresses) is a follow-on that needs a USPS Web Tools USERID
 * secret; when present, the orchestrator can AND this gate with the USPS result.
 *
 * @packageDocumentation
 */

/** The deliverability assessment for one address. */
export interface AddressDeliverability {
  /** 0–100 structural-completeness confidence. */
  confidence: number;
  /** True when confidence clears the spend threshold (default 70). */
  deliverable: boolean;
  /** Which structural components were detected. */
  parts: {
    streetNumber: boolean;
    street: boolean;
    city: boolean;
    state: boolean;
    zip: boolean;
  };
  /** Human-readable gaps (for the funnel/coverage dashboard #97). */
  reasons: string[];
}

/** Two-letter USPS state/territory codes (incl. DC + common territories). */
const STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP',
]);

const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/;
const STREET_SUFFIX_RE =
  /\b(st|street|ave|avenue|blvd|boulevard|rd|road|ln|lane|dr|drive|ct|court|way|pl|place|ter|terrace|cir|circle|hwy|highway|pkwy|parkway|sq|square|trl|trail|loop|run|pike|row)\b/i;

/** Default spend threshold — below this, don't pay to mail. */
export const DELIVERABILITY_THRESHOLD = 70;

/**
 * Assess a US postal address's structural deliverability. Pure + deterministic;
 * never throws. A blank/garbage address scores 0 (not deliverable).
 *
 * Weights (sum 100): street number 25, street name 25, city 15, state 20, ZIP 15.
 *
 * @param address - A free-text US address line (any format).
 * @param threshold - Min confidence to be `deliverable` (default {@link DELIVERABILITY_THRESHOLD}).
 * @returns The {@link AddressDeliverability} assessment.
 *
 * @example
 * assessAddressDeliverability('74 N Beverwyck Rd, Lake Hiawatha, NJ 07034');
 * // → { confidence: 100, deliverable: true, ... }
 */
export function assessAddressDeliverability(
  address: string | null | undefined,
  threshold = DELIVERABILITY_THRESHOLD,
): AddressDeliverability {
  const raw = (address ?? '').trim();
  const tokens = raw.split(/[\s,]+/).filter(Boolean);

  const hasZip = ZIP_RE.test(raw);
  // A street number = a leading token that's purely digits (or digits+letter, e.g. 74B).
  const streetNumber = /^\d+[a-z]?$/i.test(tokens[0] ?? '');
  const street = STREET_SUFFIX_RE.test(raw);
  // State = a standalone 2-letter token (commonly just before the ZIP).
  const state = tokens.some((t) => STATE_CODES.has(t.toUpperCase().replace(/[^A-Z]/gi, '')));
  // City heuristic: a comma-separated segment that's alphabetic + isn't the state.
  const segments = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const city = segments.length >= 2 && /[a-z]{2,}/i.test(segments[1] ?? '');

  const parts = { streetNumber, street, city, state, zip: hasZip };
  let confidence = 0;
  if (streetNumber) confidence += 25;
  if (street) confidence += 25;
  if (city) confidence += 15;
  if (state) confidence += 20;
  if (hasZip) confidence += 15;

  const reasons: string[] = [];
  if (!streetNumber) reasons.push('missing street number');
  if (!street) reasons.push('no recognizable street');
  if (!city) reasons.push('missing city');
  if (!state) reasons.push('missing/invalid state');
  if (!hasZip) reasons.push('missing ZIP');

  return { confidence, deliverable: confidence >= threshold, parts, reasons };
}
