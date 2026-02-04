/**
 * Utility function tests
 * TDD: These tests define expected behavior of all utilities
 */
import { describe, it, expect } from '@jest/globals';
import {
  // Sanitization
  stripHtml,
  escapeHtml,
  containsInjection,
  sanitizeUrl,
  isAllowedDomain,
  normalizeEmail,
  normalizePhone,
  slugify,
  isValidSlug,
  safeJsonParse,
  sanitizeObject,
  redactPii,
  redactPiiFromObject,
} from '../utils/sanitize.js';

import {
  // Crypto
  generateSecureToken,
  generateOtpCode,
  generateUuid,
  sha256,
  hashToken,
  verifyTokenHash,
  hmacSha256,
  verifyHmacSha256,
  timingSafeEqual,
  base64UrlEncode,
  base64UrlDecode,
  generateCodeVerifier,
  generateCodeChallenge,
} from '../utils/crypto.js';

import {
  // Errors
  AppError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  PaymentRequiredError,
  isOperationalError,
  normalizeError,
  getUserSafeMessage,
  createErrorResponse,
  calculateBackoff,
  withRetry,
} from '../utils/errors.js';

describe('Sanitization Utilities', () => {
  describe('stripHtml', () => {
    it('removes HTML tags', () => {
      expect(stripHtml('<p>Hello</p>')).toBe('Hello');
      expect(stripHtml('<script>alert("xss")</script>')).toBe('');
      expect(stripHtml('<div><span>Nested</span></div>')).toBe('Nested');
    });

    it('removes script tags with content', () => {
      const input = 'Before<script>alert("xss")</script>After';
      expect(stripHtml(input)).toBe('BeforeAfter');
    });

    it('handles non-string input', () => {
      expect(stripHtml(null as any)).toBe('');
      expect(stripHtml(undefined as any)).toBe('');
      expect(stripHtml(123 as any)).toBe('');
    });
  });

  describe('escapeHtml', () => {
    it('escapes HTML entities', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(escapeHtml('"quotes"')).toBe('&quot;quotes&quot;');
      expect(escapeHtml("'apostrophe'")).toBe('&#x27;apostrophe&#x27;');
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });
  });

  describe('containsInjection', () => {
    it('detects script tags', () => {
      expect(containsInjection('<script>alert(1)</script>')).toBe(true);
      expect(containsInjection('<SCRIPT>alert(1)</SCRIPT>')).toBe(true);
    });

    it('detects javascript: URLs', () => {
      expect(containsInjection('javascript:alert(1)')).toBe(true);
    });

    it('detects event handlers', () => {
      expect(containsInjection('onclick=alert(1)')).toBe(true);
      expect(containsInjection('onload = alert(1)')).toBe(true);
    });

    it('detects data: URLs with HTML', () => {
      expect(containsInjection('data:text/html,<script>alert(1)</script>')).toBe(true);
    });

    it('returns false for safe content', () => {
      expect(containsInjection('Hello World')).toBe(false);
      expect(containsInjection('My Business Inc.')).toBe(false);
    });
  });

  describe('sanitizeUrl', () => {
    it('accepts valid HTTPS URLs', () => {
      expect(sanitizeUrl('https://example.com')).toBe('https://example.com/');
    });

    it('upgrades HTTP to HTTPS', () => {
      expect(sanitizeUrl('http://example.com')).toBe('https://example.com/');
    });

    it('adds HTTPS if missing', () => {
      expect(sanitizeUrl('example.com')).toBe('https://example.com/');
    });

    it('rejects javascript: URLs', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe(null);
    });

    it('rejects data: URLs', () => {
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe(null);
    });

    it('returns null for invalid URLs', () => {
      expect(sanitizeUrl('not a url')).toBe(null);
    });
  });

  describe('isAllowedDomain', () => {
    const allowed = ['example.com', 'trusted.org'];

    it('allows exact domain match', () => {
      expect(isAllowedDomain('https://example.com', allowed)).toBe(true);
    });

    it('allows subdomain match', () => {
      expect(isAllowedDomain('https://sub.example.com', allowed)).toBe(true);
    });

    it('rejects unlisted domains', () => {
      expect(isAllowedDomain('https://malicious.com', allowed)).toBe(false);
    });
  });

  describe('normalizeEmail', () => {
    it('lowercases email', () => {
      expect(normalizeEmail('Test@Example.COM')).toBe('test@example.com');
    });

    it('trims whitespace', () => {
      expect(normalizeEmail('  test@example.com  ')).toBe('test@example.com');
    });

    it('handles non-string input', () => {
      expect(normalizeEmail(null as any)).toBe('');
    });
  });

  describe('normalizePhone', () => {
    it('normalizes US phone with country code', () => {
      expect(normalizePhone('+1 (415) 555-1234')).toBe('+14155551234');
    });

    it('adds country code for 10-digit US numbers', () => {
      expect(normalizePhone('4155551234')).toBe('+14155551234');
    });

    it('handles 11-digit US numbers', () => {
      expect(normalizePhone('14155551234')).toBe('+14155551234');
    });
  });

  describe('slugify', () => {
    it('converts to lowercase', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('replaces spaces with hyphens', () => {
      expect(slugify('my business name')).toBe('my-business-name');
    });

    it('removes special characters', () => {
      expect(slugify("Bob's Pizza & Grill")).toBe('bobs-pizza-grill');
    });

    it('truncates to max length', () => {
      const longName = 'a'.repeat(100);
      expect(slugify(longName).length).toBeLessThanOrEqual(63);
    });
  });

  describe('isValidSlug', () => {
    it('accepts valid slugs', () => {
      expect(isValidSlug('my-business')).toBe(true);
      expect(isValidSlug('abc')).toBe(true);
      expect(isValidSlug('123')).toBe(true);
    });

    it('rejects invalid slugs', () => {
      expect(isValidSlug('ab')).toBe(false); // too short
      expect(isValidSlug('-starts')).toBe(false);
      expect(isValidSlug('ends-')).toBe(false);
      expect(isValidSlug('HAS_CAPS')).toBe(false);
    });
  });

  describe('safeJsonParse', () => {
    it('parses valid JSON', () => {
      expect(safeJsonParse('{"a": 1}')).toEqual({ a: 1 });
    });

    it('returns null for invalid JSON', () => {
      expect(safeJsonParse('not json')).toBe(null);
    });

    it('rejects oversized input', () => {
      const large = JSON.stringify({ data: 'x'.repeat(300000) });
      expect(safeJsonParse(large)).toBe(null);
    });
  });

  describe('sanitizeObject', () => {
    it('strips HTML from string values', () => {
      const obj = { name: '<script>alert(1)</script>Hello' };
      const result = sanitizeObject(obj);
      expect(result.name).not.toContain('<script>');
    });

    it('handles nested objects', () => {
      const obj = { a: { b: { c: '<b>bold</b>' } } };
      const result = sanitizeObject(obj);
      expect((result as any).a.b.c).toBe('bold');
    });

    it('limits array size', () => {
      const obj = { arr: Array(2000).fill('x') };
      const result = sanitizeObject(obj);
      expect((result as any).arr.length).toBe(1000);
    });
  });

  describe('redactPii', () => {
    it('redacts email addresses', () => {
      expect(redactPii('Contact test@example.com')).toBe('Contact [EMAIL]');
    });

    it('redacts phone numbers', () => {
      expect(redactPii('Call +14155551234')).toBe('Call [PHONE]');
    });

    it('redacts Stripe secret keys', () => {
      expect(redactPii('Key: sk_live_abc123')).toBe('Key: [STRIPE_SECRET]');
    });

    it('redacts Bearer tokens', () => {
      expect(redactPii('Bearer eyJhbGciOiJIUzI1NiJ9')).toBe('Bearer [TOKEN]');
    });
  });

  describe('redactPiiFromObject', () => {
    it('redacts sensitive field names', () => {
      const obj = {
        username: 'john',
        password: 'secret123',
        api_key: 'key123',
      };
      const result = redactPiiFromObject(obj);
      expect(result.username).toBe('john');
      expect(result.password).toBe('[REDACTED]');
      expect(result.api_key).toBe('[REDACTED]');
    });
  });
});

describe('Crypto Utilities', () => {
  describe('generateSecureToken', () => {
    it('generates token of specified length', () => {
      const token = generateSecureToken(32);
      expect(token.length).toBe(64); // 32 bytes = 64 hex chars
    });

    it('generates unique tokens', () => {
      const token1 = generateSecureToken();
      const token2 = generateSecureToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('generateOtpCode', () => {
    it('generates numeric code of specified length', () => {
      const code = generateOtpCode(6);
      expect(code.length).toBe(6);
      expect(/^\d+$/.test(code)).toBe(true);
    });
  });

  describe('generateUuid', () => {
    it('generates valid UUIDs', () => {
      const uuid = generateUuid();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  describe('sha256', () => {
    it('hashes strings consistently', async () => {
      const hash1 = await sha256('hello');
      const hash2 = await sha256('hello');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', async () => {
      const hash1 = await sha256('hello');
      const hash2 = await sha256('world');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('hashToken / verifyTokenHash', () => {
    it('verifies correct token', async () => {
      const token = 'my-secret-token';
      const hash = await hashToken(token);
      expect(await verifyTokenHash(token, hash)).toBe(true);
    });

    it('rejects incorrect token', async () => {
      const hash = await hashToken('correct-token');
      expect(await verifyTokenHash('wrong-token', hash)).toBe(false);
    });
  });

  describe('hmacSha256 / verifyHmacSha256', () => {
    it('creates and verifies HMAC signatures', async () => {
      const key = 'secret-key';
      const message = 'hello world';
      const signature = await hmacSha256(key, message);
      expect(await verifyHmacSha256(key, message, signature)).toBe(true);
    });

    it('rejects invalid signatures', async () => {
      const key = 'secret-key';
      const message = 'hello world';
      expect(await verifyHmacSha256(key, message, 'invalid')).toBe(false);
    });
  });

  describe('timingSafeEqual', () => {
    it('returns true for equal strings', () => {
      expect(timingSafeEqual('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings', () => {
      expect(timingSafeEqual('abc', 'abd')).toBe(false);
    });

    it('returns false for different length strings', () => {
      expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    });
  });

  describe('base64Url encode/decode', () => {
    it('round-trips correctly', () => {
      const original = 'Hello, World!';
      const encoded = base64UrlEncode(original);
      const decoded = base64UrlDecode(encoded);
      expect(decoded).toBe(original);
    });

    it('produces URL-safe output', () => {
      const encoded = base64UrlEncode('test+with/special=chars');
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });
  });

  describe('PKCE', () => {
    it('generates code verifier of correct length', () => {
      const verifier = generateCodeVerifier(64);
      expect(verifier.length).toBe(64);
    });

    it('generates consistent code challenge', async () => {
      const verifier = 'test-verifier-string';
      const challenge1 = await generateCodeChallenge(verifier);
      const challenge2 = await generateCodeChallenge(verifier);
      expect(challenge1).toBe(challenge2);
    });
  });
});

describe('Error Utilities', () => {
  describe('AppError', () => {
    it('creates error with correct properties', () => {
      const error = new AppError('Test error', 'TEST_CODE', 400, { detail: 'info' });
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ detail: 'info' });
      expect(error.isOperational).toBe(true);
    });

    it('serializes to JSON correctly', () => {
      const error = new AppError('Test', 'CODE', 400);
      const json = error.toJSON();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('CODE');
      expect(json.error.message).toBe('Test');
    });
  });

  describe('Error classes', () => {
    it('AuthError has 401 status', () => {
      const error = new AuthError();
      expect(error.statusCode).toBe(401);
    });

    it('ForbiddenError has 403 status', () => {
      const error = new ForbiddenError();
      expect(error.statusCode).toBe(403);
    });

    it('NotFoundError has 404 status', () => {
      const error = new NotFoundError('User');
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('User not found');
    });

    it('ValidationError has 400 status', () => {
      const error = new ValidationError();
      expect(error.statusCode).toBe(400);
    });

    it('RateLimitError has 429 status', () => {
      const error = new RateLimitError('Too many requests', 60);
      expect(error.statusCode).toBe(429);
      expect(error.retryAfter).toBe(60);
    });

    it('PaymentRequiredError has 402 status', () => {
      const error = new PaymentRequiredError();
      expect(error.statusCode).toBe(402);
    });
  });

  describe('isOperationalError', () => {
    it('returns true for AppError', () => {
      expect(isOperationalError(new AppError('test'))).toBe(true);
    });

    it('returns false for generic Error', () => {
      expect(isOperationalError(new Error('test'))).toBe(false);
    });
  });

  describe('normalizeError', () => {
    it('returns AppError unchanged', () => {
      const original = new AppError('test');
      expect(normalizeError(original)).toBe(original);
    });

    it('wraps generic Error', () => {
      const error = new Error('test');
      const normalized = normalizeError(error);
      expect(normalized).toBeInstanceOf(AppError);
      expect(normalized.message).toBe('test');
    });

    it('wraps string', () => {
      const normalized = normalizeError('test error');
      expect(normalized).toBeInstanceOf(AppError);
      expect(normalized.message).toBe('test error');
    });
  });

  describe('getUserSafeMessage', () => {
    it('returns message for operational errors', () => {
      const error = new AuthError('Please log in');
      expect(getUserSafeMessage(error)).toBe('Please log in');
    });

    it('returns generic message for non-operational errors', () => {
      const error = new Error('Internal details');
      expect(getUserSafeMessage(error)).toBe('An unexpected error occurred. Please try again later.');
    });
  });

  describe('createErrorResponse', () => {
    it('creates error response object', () => {
      const error = new ValidationError('Invalid input', { field: 'email' });
      const response = createErrorResponse(error, 'req-123');
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('VALIDATION_ERROR');
      expect(response.error.message).toBe('Invalid input');
      expect(response.request_id).toBe('req-123');
    });
  });

  describe('calculateBackoff', () => {
    it('calculates exponential backoff', () => {
      const delay1 = calculateBackoff(1, 1000, 30000);
      const delay2 = calculateBackoff(2, 1000, 30000);
      const delay3 = calculateBackoff(3, 1000, 30000);

      expect(delay1).toBeGreaterThanOrEqual(1000);
      expect(delay1).toBeLessThanOrEqual(1250);
      expect(delay2).toBeGreaterThanOrEqual(2000);
      expect(delay3).toBeGreaterThanOrEqual(4000);
    });

    it('respects max delay', () => {
      const delay = calculateBackoff(10, 1000, 5000);
      expect(delay).toBeLessThanOrEqual(6250); // 5000 + 25% jitter
    });
  });

  describe('withRetry', () => {
    it('returns result on first success', async () => {
      let attempts = 0;
      const result = await withRetry(async () => {
        attempts++;
        return 'success';
      });
      expect(result).toBe('success');
      expect(attempts).toBe(1);
    });

    it('retries on failure', async () => {
      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('fail');
          }
          return 'success';
        },
        { maxAttempts: 3, baseDelayMs: 10 }
      );
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('throws after max attempts', async () => {
      let attempts = 0;
      await expect(
        withRetry(
          async () => {
            attempts++;
            throw new Error('always fails');
          },
          { maxAttempts: 2, baseDelayMs: 10 }
        )
      ).rejects.toThrow('always fails');
      expect(attempts).toBe(2);
    });
  });
});
