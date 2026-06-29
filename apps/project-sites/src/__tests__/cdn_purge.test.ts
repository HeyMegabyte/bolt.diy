/**
 * @file
 * Unit tests for the CDN purge service — pure request-body builders.
 *
 * @see services/cdn_purge.ts
 */

import {
  MAX_URLS_PER_PURGE,
  buildPurgeRequest,
  purgeByTag,
  purgeByPrefix,
  BuildPurgeRequestSchema,
  PurgeByTagSchema,
  PurgeByPrefixSchema,
  PurgeFilesBodySchema,
  PurgeTagsBodySchema,
  PurgePrefixBodySchema,
} from '../services/cdn_purge.js';

describe('cdn purge', () => {
  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------
  describe('MAX_URLS_PER_PURGE', () => {
    it('is 30', () => {
      expect(MAX_URLS_PER_PURGE).toBe(30);
    });
  });

  // -----------------------------------------------------------------------
  // Zod schemas
  // -----------------------------------------------------------------------
  describe('BuildPurgeRequestSchema', () => {
    it('accepts up to 30 valid URLs', () => {
      const urls = Array.from({ length: 30 }, (_, i) => `https://example.com/page-${i + 1}`);
      expect(() => BuildPurgeRequestSchema.parse(urls)).not.toThrow();
    });

    it('rejects more than 30 URLs', () => {
      const urls = Array.from({ length: 31 }, (_, i) => `https://example.com/page-${i + 1}`);
      expect(() => BuildPurgeRequestSchema.parse(urls)).toThrow();
    });

    it('rejects invalid URLs', () => {
      expect(() => BuildPurgeRequestSchema.parse(['not-a-url'])).toThrow();
    });

    it('rejects an empty array', () => {
      expect(() => BuildPurgeRequestSchema.parse([])).toThrow();
    });

    it('rejects relative URLs without a scheme', () => {
      expect(() => BuildPurgeRequestSchema.parse(['/relative/path'])).toThrow();
    });
  });

  describe('PurgeByTagSchema', () => {
    it('accepts up to 30 non-empty tags', () => {
      const tags = Array.from({ length: 30 }, (_, i) => `tag-${i + 1}`);
      expect(() => PurgeByTagSchema.parse(tags)).not.toThrow();
    });

    it('rejects more than 30 tags', () => {
      const tags = Array.from({ length: 31 }, (_, i) => `tag-${i + 1}`);
      expect(() => PurgeByTagSchema.parse(tags)).toThrow();
    });

    it('rejects empty strings in the array', () => {
      expect(() => PurgeByTagSchema.parse(['valid', ''])).toThrow();
    });

    it('rejects an empty array', () => {
      expect(() => PurgeByTagSchema.parse([])).toThrow();
    });
  });

  describe('PurgeByPrefixSchema', () => {
    it('accepts a non-empty string', () => {
      expect(() => PurgeByPrefixSchema.parse('https://example.com/blog/')).not.toThrow();
    });

    it('rejects an empty string', () => {
      expect(() => PurgeByPrefixSchema.parse('')).toThrow();
    });
  });

  describe('PurgeFilesBodySchema', () => {
    it('accepts a valid files body', () => {
      const body = { files: [{ url: 'https://example.com/' }] };
      expect(() => PurgeFilesBodySchema.parse(body)).not.toThrow();
    });

    it('rejects a body with too many files', () => {
      const body = {
        files: Array.from({ length: 31 }, (_, i) => ({ url: `https://example.com/p-${i + 1}` })),
      };
      expect(() => PurgeFilesBodySchema.parse(body)).toThrow();
    });
  });

  describe('PurgeTagsBodySchema', () => {
    it('accepts a valid tags body', () => {
      const body = { tags: ['v2-release'] };
      expect(() => PurgeTagsBodySchema.parse(body)).not.toThrow();
    });
  });

  describe('PurgePrefixBodySchema', () => {
    it('accepts a valid prefixes body', () => {
      const body = { prefixes: ['https://example.com/'] };
      expect(() => PurgePrefixBodySchema.parse(body)).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // buildPurgeRequest
  // -----------------------------------------------------------------------
  describe('buildPurgeRequest', () => {
    it('builds a single-URL purge body', () => {
      const body = buildPurgeRequest(['https://example.com/about']);
      expect(body).toEqual({ files: [{ url: 'https://example.com/about' }] });
    });

    it('builds a multi-URL purge body with 3 URLs', () => {
      const body = buildPurgeRequest([
        'https://example.com/',
        'https://example.com/about',
        'https://example.com/contact',
      ]);
      expect(body).toEqual({
        files: [
          { url: 'https://example.com/' },
          { url: 'https://example.com/about' },
          { url: 'https://example.com/contact' },
        ],
      });
    });

    it('builds a purge body at the max limit of 30 URLs', () => {
      const urls = Array.from({ length: 30 }, (_, i) => `https://example.net/page-${i + 1}`);
      const body = buildPurgeRequest(urls);
      expect(body.files).toHaveLength(30);
      expect(body.files[29].url).toBe('https://example.net/page-30');
    });

    it('throws for more than 30 URLs', () => {
      const urls = Array.from({ length: 31 }, (_, i) => `https://example.com/p-${i + 1}`);
      expect(() => buildPurgeRequest(urls)).toThrow();
    });

    it('throws for an invalid URL', () => {
      expect(() => buildPurgeRequest(['not-even-close'])).toThrow();
    });

    it('throws for an empty array', () => {
      expect(() => buildPurgeRequest([])).toThrow();
    });

    it('returns a body that passes the output schema every time', () => {
      const body = buildPurgeRequest(['https://example.com/a', 'https://example.com/b']);
      expect(() => PurgeFilesBodySchema.parse(body)).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // purgeByTag
  // -----------------------------------------------------------------------
  describe('purgeByTag', () => {
    it('builds a single-tag purge body', () => {
      const body = purgeByTag(['homepage']);
      expect(body).toEqual({ tags: ['homepage'] });
    });

    it('builds a multi-tag purge body', () => {
      const body = purgeByTag(['site-abc', 'homepage', 'v2-release']);
      expect(body).toEqual({ tags: ['site-abc', 'homepage', 'v2-release'] });
    });

    it('builds a tag body at the max limit of 30 tags', () => {
      const tags = Array.from({ length: 30 }, (_, i) => `tag-${i + 1}`);
      const body = purgeByTag(tags);
      expect(body.tags).toHaveLength(30);
    });

    it('throws for more than 30 tags', () => {
      const tags = Array.from({ length: 31 }, (_, i) => `tag-${i + 1}`);
      expect(() => purgeByTag(tags)).toThrow();
    });

    it('throws for empty strings in the tags array', () => {
      expect(() => purgeByTag(['', 'valid'])).toThrow();
    });

    it('throws for an empty array', () => {
      expect(() => purgeByTag([])).toThrow();
    });

    it('returns a body that passes the output schema every time', () => {
      const body = purgeByTag(['alpha', 'beta']);
      expect(() => PurgeTagsBodySchema.parse(body)).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // purgeByPrefix
  // -----------------------------------------------------------------------
  describe('purgeByPrefix', () => {
    it('builds a prefix purge body', () => {
      const body = purgeByPrefix('https://example.com/blog/');
      expect(body).toEqual({ prefixes: ['https://example.com/blog/'] });
    });

    it('accepts a short prefix like a path fragment', () => {
      const body = purgeByPrefix('/');
      expect(body.prefixes).toEqual(['/']);
    });

    it('throws for an empty prefix', () => {
      expect(() => purgeByPrefix('')).toThrow();
    });

    it('returns a body that passes the output schema every time', () => {
      const body = purgeByPrefix('https://example.com/api/');
      expect(() => PurgePrefixBodySchema.parse(body)).not.toThrow();
    });
  });
});
