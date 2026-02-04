/**
 * Sanitization utilities - treat all input as hostile
 */

// ============================================================================
// HTML/SCRIPT SANITIZATION
// ============================================================================

/**
 * Remove all HTML tags from a string
 */
export function stripHtml(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/**
 * Escape HTML entities for safe display
 */
export function escapeHtml(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  };
  return input.replace(/[&<>"'`=/]/g, (char) => htmlEntities[char] || char);
}

/**
 * Check if string contains potential injection patterns
 */
export function containsInjection(input: string): boolean {
  if (typeof input !== 'string') {
    return false;
  }
  const patterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /data:\s*text\/html/i,
    /vbscript:/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /expression\s*\(/i,
    /url\s*\(\s*["']?\s*data:/i,
  ];
  return patterns.some((pattern) => pattern.test(input));
}

// ============================================================================
// URL SANITIZATION
// ============================================================================

/**
 * Validate and sanitize URL (HTTPS only)
 */
export function sanitizeUrl(input: string): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  try {
    // Upgrade HTTP to HTTPS
    let url = input.trim();
    if (url.startsWith('http://')) {
      url = url.replace('http://', 'https://');
    }

    // Add protocol if missing
    if (!url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const parsed = new URL(url);

    // Only allow HTTPS
    if (parsed.protocol !== 'https:') {
      return null;
    }

    // Block dangerous schemes that might have slipped through
    const dangerous = ['javascript:', 'data:', 'vbscript:', 'file:'];
    if (dangerous.some((d) => url.toLowerCase().includes(d))) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Check if URL is from an allowed domain
 */
export function isAllowedDomain(url: string, allowedDomains: string[]): boolean {
  try {
    const parsed = new URL(url);
    return allowedDomains.some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

// ============================================================================
// EMAIL/PHONE SANITIZATION
// ============================================================================

/**
 * Normalize email address
 */
export function normalizeEmail(email: string): string {
  if (typeof email !== 'string') {
    return '';
  }
  return email.toLowerCase().trim();
}

/**
 * Normalize phone to E.164 format (basic)
 */
export function normalizePhone(phone: string): string {
  if (typeof phone !== 'string') {
    return '';
  }

  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Ensure it starts with +
  if (!cleaned.startsWith('+')) {
    // Assume US if 10 digits
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      cleaned = '+' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }

  return cleaned;
}

// ============================================================================
// SLUG SANITIZATION
// ============================================================================

/**
 * Generate a safe slug from a string
 */
export function slugify(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

/**
 * Check if a string is a valid slug
 */
export function isValidSlug(slug: string): boolean {
  if (typeof slug !== 'string') {
    return false;
  }
  return (
    slug.length >= 3 &&
    slug.length <= 63 &&
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)
  );
}

// ============================================================================
// JSON SANITIZATION
// ============================================================================

/**
 * Safe JSON parse with size limit
 */
export function safeJsonParse<T>(
  input: string,
  maxSizeBytes: number = 256 * 1024
): T | null {
  if (typeof input !== 'string') {
    return null;
  }

  if (input.length > maxSizeBytes) {
    return null;
  }

  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

/**
 * Deep clone and sanitize an object (remove functions, symbols, etc.)
 */
export function sanitizeObject<T>(obj: T, maxDepth: number = 10): T {
  if (maxDepth <= 0) {
    return {} as T;
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    if (typeof obj === 'string') {
      return stripHtml(obj) as T;
    }
    if (typeof obj === 'function' || typeof obj === 'symbol') {
      return undefined as T;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj
      .slice(0, 1000) // Limit array size
      .map((item) => sanitizeObject(item, maxDepth - 1)) as T;
  }

  const result: Record<string, unknown> = {};
  const keys = Object.keys(obj as object).slice(0, 100); // Limit object keys

  for (const key of keys) {
    if (typeof key === 'string' && !key.startsWith('__')) {
      result[key] = sanitizeObject(
        (obj as Record<string, unknown>)[key],
        maxDepth - 1
      );
    }
  }

  return result as T;
}

// ============================================================================
// PII REDACTION (for logging)
// ============================================================================

const PII_PATTERNS = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL]' },
  { pattern: /\+?[1-9]\d{1,14}/g, replacement: '[PHONE]' },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[CARD]' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
  { pattern: /sk_[a-zA-Z0-9_]+/g, replacement: '[STRIPE_SECRET]' },
  { pattern: /whsec_[a-zA-Z0-9_]+/g, replacement: '[STRIPE_WEBHOOK]' },
  { pattern: /SG\.[a-zA-Z0-9_-]+/g, replacement: '[SENDGRID_KEY]' },
  { pattern: /Bearer\s+[a-zA-Z0-9._-]+/gi, replacement: 'Bearer [TOKEN]' },
];

/**
 * Redact PII from a string (for safe logging)
 */
export function redactPii(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  let result = input;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Redact PII from an object (deep)
 */
export function redactPiiFromObject<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return redactPii(obj) as T;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactPiiFromObject(item)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as object)) {
    // Redact sensitive field names entirely
    const sensitiveKeys = [
      'password',
      'secret',
      'token',
      'api_key',
      'apikey',
      'authorization',
      'cookie',
      'session',
      'credit_card',
      'ssn',
    ];
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactPiiFromObject(value);
    }
  }

  return result as T;
}
