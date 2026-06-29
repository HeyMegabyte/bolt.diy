/**
 * @module services/data_classification
 * @description GDPR field sensitivity classifier. Pure zero-I/O — never throws.
 * Classifies (fieldName, exampleValue) pairs into sensitivity tiers.
 */

// ── Types ───────────────────────────────────────────────────────────

export type SensitivityTier = 'public' | 'internal' | 'sensitive' | 'restricted';

export interface FieldClass {
  readonly field: string;
  readonly tier: SensitivityTier;
  readonly reason: string; // e.g. 'matches email pattern' or 'field name contains "ssn"'
  readonly gdprArticle: string | null; // relevant GDPR article, e.g. 'Art. 9' for special categories
}

export interface ClassificationResult {
  readonly fields: readonly FieldClass[];
  readonly summary: Readonly<Record<SensitivityTier, number>>;
  readonly hasRestricted: boolean;
}

// ── Known pattern registry ──────────────────────────────────────────

/**
 * Known sensitive field-name patterns (case-insensitive).
 * Each entry maps an exact field name (lowercase) to its tier and GDPR article.
 */
export const KNOWN_PATTERNS: Readonly<
  Record<string, { tier: SensitivityTier; article: string | null }>
> = Object.freeze({
  ssn: { tier: 'restricted', article: 'Art. 9' },
  health_notes: { tier: 'restricted', article: 'Art. 9' },
  ethnicity: { tier: 'restricted', article: 'Art. 9' },
  religion: { tier: 'restricted', article: 'Art. 9' },
  biometric: { tier: 'restricted', article: 'Art. 9' },
  political: { tier: 'restricted', article: 'Art. 9' },
  ip_address: { tier: 'sensitive', article: 'Art. 4(1)' },
  email: { tier: 'sensitive', article: 'Art. 4(1)' },
  phone: { tier: 'sensitive', article: 'Art. 4(1)' },
  address: { tier: 'sensitive', article: 'Art. 4(1)' },
});

// ── Helpers ─────────────────────────────────────────────────────────

function keyFromPattern(
  fieldName: string,
): { tier: SensitivityTier; article: string | null } | null {
  const exact = KNOWN_PATTERNS[fieldName.toLowerCase()];
  if (exact) return exact;
  return null;
}

function inferFromName(
  fieldName: string,
): { tier: SensitivityTier; reason: string; article: string | null } | null {
  const lower = fieldName.toLowerCase();

  // Restricted — sensitive personal data / special categories
  const restricted = [
    { pattern: 'password', article: null },
    { pattern: 'secret', article: null },
    { pattern: 'token', article: null },
    { pattern: 'key', article: null },
    { pattern: 'credential', article: null },
    { pattern: 'ssn', article: 'Art. 9' },
    { pattern: 'passport', article: null },
    { pattern: 'license', article: null },
    { pattern: 'dob', article: null },
    { pattern: 'birth', article: null },
    { pattern: 'health', article: 'Art. 9' },
    { pattern: 'medical', article: 'Art. 9' },
    { pattern: 'phone', article: 'Art. 4(1)' },
    { pattern: 'mobile', article: 'Art. 4(1)' },
  ];

  for (const r of restricted) {
    if (lower.includes(r.pattern)) {
      return {
        tier: 'restricted',
        reason: `field name contains "${r.pattern}"`,
        article: r.article,
      };
    }
  }

  // Sensitive — common PII identifiers
  const sensitive = ['name', 'address', 'ip', 'user', 'customer', 'client'];

  for (const s of sensitive) {
    if (lower.includes(s)) {
      return {
        tier: 'sensitive',
        reason: `field name contains "${s}"`,
        article: null,
      };
    }
  }

  return null;
}

const EMAIL_REGEX = /@/;

function isEmailLike(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return EMAIL_REGEX.test(value);
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Classify a set of (fieldName, exampleValue) pairs into sensitivity tiers.
 *
 * @param fields - Record of field names to example values
 * @returns ClassificationResult with per-field classifications, summary counts, and restricted flag
 *
 * @example
 * const result = classifyFields({ email: 'user@example.com', ssn: '123-45-6789', pet_name: 'Fido' });
 * // result.fields[0].tier === 'sensitive'  // email
 * // result.fields[1].tier === 'restricted' // ssn
 * // result.fields[2].tier === 'internal'   // pet_name
 * // result.hasRestricted === true
 */
export function classifyFields(fields: Readonly<Record<string, unknown>>): ClassificationResult {
  const classifications: FieldClass[] = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    classifications.push(classifyField(fieldName, value));
  }

  const summary: Record<SensitivityTier, number> = {
    public: 0,
    internal: 0,
    sensitive: 0,
    restricted: 0,
  };

  for (const c of classifications) {
    summary[c.tier] = (summary[c.tier] ?? 0) + 1;
  }

  const hasRestricted = classifications.some((c) => c.tier === 'restricted');

  return {
    fields: classifications,
    summary: Object.freeze(summary) as Readonly<Record<SensitivityTier, number>>,
    hasRestricted,
  };
}

/**
 * Classify a single field by name + optional example value.
 *
 * Classification priority:
 * 1. Field name matches a KNOWN_PATTERN → use that tier
 * 2. Name contains 'password'/'secret'/'token'/'key'/'credential' → restricted
 * 3. Name contains 'email' → sensitive (PII)
 * 4. Name contains 'phone'/'mobile'/'ssn'/'passport'/'license'/'dob'/'birth'/'health'/'medical' → restricted
 * 5. Name contains 'name'/'address'/'ip'/'user'/'customer'/'client' → sensitive
 * 6. Example value looks like email (contains @) → sensitive
 * 7. Default → internal
 *
 * @param fieldName - The field name
 * @param exampleValue - Optional example value for heuristic inference
 * @returns FieldClass
 *
 * @example
 * classifyField('email', 'user@example.com')
 * // { field: 'email', tier: 'sensitive', reason: 'field name is in known patterns', gdprArticle: 'Art. 4(1)' }
 *
 * @example
 * classifyField('pet_name')
 * // { field: 'pet_name', tier: 'internal', reason: 'default classification', gdprArticle: null }
 */
export function classifyField(fieldName: string, exampleValue?: unknown): FieldClass {
  // 1. Exact known pattern match
  const known = keyFromPattern(fieldName);
  if (known) {
    return {
      field: fieldName,
      tier: known.tier,
      reason: 'field name is in known patterns',
      gdprArticle: known.article,
    };
  }

  // 2-5. Name-based heuristic inference
  const inferred = inferFromName(fieldName);
  if (inferred) {
    return {
      field: fieldName,
      tier: inferred.tier,
      reason: inferred.reason,
      gdprArticle: inferred.article,
    };
  }

  // 6. Example value heuristic (email-like)
  if (exampleValue !== undefined && isEmailLike(exampleValue)) {
    return {
      field: fieldName,
      tier: 'sensitive',
      reason: 'example value matches email pattern',
      gdprArticle: 'Art. 4(1)',
    };
  }

  // 7. Default
  return {
    field: fieldName,
    tier: 'internal',
    reason: 'default classification',
    gdprArticle: null,
  };
}
