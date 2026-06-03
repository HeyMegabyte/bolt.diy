/**
 * Additive unit tests for the git-based snapshot service (services/git.ts).
 *
 * Complements `git_service.test.ts` (happy-path + basic edges) by exercising the
 * RESILIENCE branches the sibling omits:
 *   - R2 `get`-throws inside each try/catch (createSnapshot parent read,
 *     getHistory HEAD read + chain walk, getCommit, checkoutSnapshot per-file,
 *     getHead)
 *   - getHistory chain-break when a parent commit object is missing/null
 *   - empty-string HEAD treated as "no commits"
 *   - createSnapshot persisting the correct guessed content-type per extension
 *     (the internal `guessContentType` map — every branch incl. octet-stream)
 *   - revertToSnapshot propagating the checkout throw for a missing commit
 *
 * ts-jest: GLOBAL `jest` (NOT @jest/globals); transport (R2) is fully mocked,
 * never hits real network/APIs.
 */

import {
  createSnapshot,
  getHistory,
  getCommit,
  checkoutSnapshot,
  revertToSnapshot,
  getHead,
} from '../services/git.js';
import type { CommitMetadata } from '../services/git.js';

// ─── Controllable R2 Bucket Mock ───────────────────────────────
//
// Unlike the sibling's in-memory store, this mock lets each test inject:
//   - a throwing `get` (network/transport failure)
//   - a `get` that returns a specific object body (or null)
// so the `catch {}` resilience branches in git.ts are actually reached.

interface MockObject {
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}

function objFromText(text: string): MockObject {
  return {
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

function createMockBucket(opts?: {
  getImpl?: (key: string) => Promise<MockObject | null>;
  putImpl?: (key: string, body: unknown, options?: unknown) => Promise<unknown>;
}): R2Bucket & { putCalls: Array<{ key: string; options?: unknown }> } {
  const putCalls: Array<{ key: string; options?: unknown }> = [];

  const bucket = {
    get: jest.fn(async (key: string) => {
      if (opts?.getImpl) return opts.getImpl(key) as unknown as R2ObjectBody | null;
      return null;
    }),
    put: jest.fn(async (key: string, body: unknown, options?: unknown) => {
      putCalls.push({ key, options });
      if (opts?.putImpl) return opts.putImpl(key, body, options);
      return { key } as unknown as R2Object;
    }),
    head: jest.fn(async () => null),
    delete: jest.fn(async () => {}),
    list: jest.fn(async () => ({ objects: [], delimitedPrefixes: [], truncated: false })),
    createMultipartUpload: jest.fn(),
    resumeMultipartUpload: jest.fn(),
  } as unknown as R2Bucket & { putCalls: Array<{ key: string; options?: unknown }> };

  bucket.putCalls = putCalls;
  return bucket;
}

describe('git service — resilience + content-type branches (additive)', () => {
  // ── createSnapshot: parent-read catch + no-HEAD ───────────────
  describe('createSnapshot resilience', () => {
    it('treats a throwing HEAD read as the first commit (parentId null)', async () => {
      // get always throws -> the try/catch around HEAD read swallows it.
      const bucket = createMockBucket({
        getImpl: async () => {
          throw new Error('R2 transport down');
        },
      });

      const id = await createSnapshot(
        bucket,
        'site-throw',
        [{ name: 'index.html', content: '<html></html>' }],
        'first',
      );

      expect(typeof id).toBe('string');
      const putMock = (bucket.put as unknown as jest.Mock).mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('/commits/'),
      );
      const stored: CommitMetadata = JSON.parse(putMock![1] as string);
      expect(stored.parentId).toBeNull();
    });

    it('treats an empty-string HEAD body as no parent', async () => {
      const bucket = createMockBucket({
        getImpl: async (key) => (key.endsWith('HEAD') ? objFromText('   ') : null),
      });

      await createSnapshot(bucket, 'site-empty-head', [{ name: 'a.txt', content: 'x' }], 'm');

      const putMock = (bucket.put as unknown as jest.Mock).mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('/commits/'),
      );
      const stored: CommitMetadata = JSON.parse(putMock![1] as string);
      expect(stored.parentId).toBeNull();
    });

    it('sets parentId from an existing non-empty HEAD', async () => {
      const bucket = createMockBucket({
        getImpl: async (key) => (key.endsWith('HEAD') ? objFromText('parent-123\n') : null),
      });

      await createSnapshot(bucket, 'site-parent', [{ name: 'a.txt', content: 'x' }], 'm');

      const putMock = (bucket.put as unknown as jest.Mock).mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('/commits/'),
      );
      const stored: CommitMetadata = JSON.parse(putMock![1] as string);
      expect(stored.parentId).toBe('parent-123');
    });

    it('records file sizes, author, and buildVersion', async () => {
      const bucket = createMockBucket();
      await createSnapshot(
        bucket,
        's',
        [{ name: 'f.txt', content: 'abcde' }],
        'm',
        'Author X',
        'v999',
      );
      const putMock = (bucket.put as unknown as jest.Mock).mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('/commits/'),
      );
      const stored: CommitMetadata = JSON.parse(putMock![1] as string);
      expect(stored.files[0].size).toBe(5);
      expect(stored.author).toBe('Author X');
      expect(stored.buildVersion).toBe('v999');
    });
  });

  // ── createSnapshot: guessContentType (every map branch) ───────
  describe('createSnapshot content-type guessing', () => {
    const cases: Array<[string, string]> = [
      ['index.html', 'text/html'],
      ['style.css', 'text/css'],
      ['app.js', 'application/javascript'],
      ['mod.mjs', 'application/javascript'],
      ['data.json', 'application/json'],
      ['logo.svg', 'image/svg+xml'],
      ['pic.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['photo.jpeg', 'image/jpeg'],
      ['anim.gif', 'image/gif'],
      ['img.webp', 'image/webp'],
      ['fav.ico', 'image/x-icon'],
      ['notes.txt', 'text/plain'],
      ['feed.xml', 'text/xml'],
      ['font.woff', 'font/woff'],
      ['font.woff2', 'font/woff2'],
      ['main.ts', 'application/typescript'],
      ['comp.tsx', 'application/typescript'],
      ['comp.jsx', 'application/javascript'],
      ['readme.md', 'text/markdown'],
      ['conf.yaml', 'text/yaml'],
      ['conf.yml', 'text/yaml'],
      ['blob.bin', 'application/octet-stream'], // unknown ext -> default
      ['NOEXTENSION', 'application/octet-stream'], // no dot -> default
    ];

    it.each(cases)('stores %s with content-type %s', async (filename, expected) => {
      const bucket = createMockBucket();
      await createSnapshot(bucket, 'ct', [{ name: filename, content: 'x' }], 'm');

      const treePut = (bucket.put as unknown as jest.Mock).mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('/trees/'),
      );
      expect(treePut).toBeDefined();
      const options = treePut![2] as { httpMetadata?: { contentType?: string } };
      expect(options.httpMetadata?.contentType).toBe(expected);
    });

    it('persists commit metadata as application/json', async () => {
      const bucket = createMockBucket();
      await createSnapshot(bucket, 'ct2', [{ name: 'a.txt', content: 'x' }], 'm');
      const commitPut = (bucket.put as unknown as jest.Mock).mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('/commits/'),
      );
      const options = commitPut![2] as { httpMetadata?: { contentType?: string } };
      expect(options.httpMetadata?.contentType).toBe('application/json');
    });
  });

  // ── getHistory: throw, empty, chain-break ─────────────────────
  describe('getHistory resilience', () => {
    it('returns [] when reading HEAD throws', async () => {
      const bucket = createMockBucket({
        getImpl: async () => {
          throw new Error('boom');
        },
      });
      expect(await getHistory(bucket, 'x')).toEqual([]);
    });

    it('returns [] when HEAD is empty string', async () => {
      const bucket = createMockBucket({
        getImpl: async (key) => (key.endsWith('HEAD') ? objFromText('  ') : null),
      });
      expect(await getHistory(bucket, 'x')).toEqual([]);
    });

    it('returns [] when HEAD object is null', async () => {
      const bucket = createMockBucket({ getImpl: async () => null });
      expect(await getHistory(bucket, 'x')).toEqual([]);
    });

    it('stops the walk when a commit object is missing mid-chain', async () => {
      // HEAD -> c2 (exists, parent c1) -> c1 (missing) => only c2 returned.
      const c2: CommitMetadata = {
        id: 'c2',
        message: 'second',
        timestamp: '2025-01-02T00:00:00.000Z',
        author: 'A',
        parentId: 'c1',
        files: [{ name: 'a', size: 1 }],
      };
      const bucket = createMockBucket({
        getImpl: async (key) => {
          if (key.endsWith('HEAD')) return objFromText('c2');
          if (key.includes('commits/c2.json')) return objFromText(JSON.stringify(c2));
          return null; // c1.json missing
        },
      });
      const history = await getHistory(bucket, 'x');
      expect(history).toHaveLength(1);
      expect(history[0].sha).toBe('c2');
      expect(history[0].fileCount).toBe(1);
    });

    it('stops the walk when a commit read throws mid-chain', async () => {
      const bucket = createMockBucket({
        getImpl: async (key) => {
          if (key.endsWith('HEAD')) return objFromText('c2');
          throw new Error('commit read failed');
        },
      });
      expect(await getHistory(bucket, 'x')).toEqual([]);
    });

    it('respects the depth parameter across a long chain', async () => {
      const commits: Record<string, CommitMetadata> = {
        c3: {
          id: 'c3',
          message: 'm3',
          timestamp: '2025-01-03T00:00:00.000Z',
          author: 'A',
          parentId: 'c2',
          files: [],
        },
        c2: {
          id: 'c2',
          message: 'm2',
          timestamp: '2025-01-02T00:00:00.000Z',
          author: 'A',
          parentId: 'c1',
          files: [],
        },
        c1: {
          id: 'c1',
          message: 'm1',
          timestamp: '2025-01-01T00:00:00.000Z',
          author: 'A',
          parentId: null,
          files: [],
        },
      };
      const bucket = createMockBucket({
        getImpl: async (key) => {
          if (key.endsWith('HEAD')) return objFromText('c3');
          const m = key.match(/commits\/(c\d)\.json/);
          if (m && commits[m[1]]) return objFromText(JSON.stringify(commits[m[1]]));
          return null;
        },
      });
      const history = await getHistory(bucket, 'x', 2);
      expect(history.map((h) => h.sha)).toEqual(['c3', 'c2']);
    });
  });

  // ── getCommit: null + throw ───────────────────────────────────
  describe('getCommit resilience', () => {
    it('returns null when the object is missing', async () => {
      const bucket = createMockBucket({ getImpl: async () => null });
      expect(await getCommit(bucket, 'x', 'nope')).toBeNull();
    });

    it('returns null when the read throws', async () => {
      const bucket = createMockBucket({
        getImpl: async () => {
          throw new Error('down');
        },
      });
      expect(await getCommit(bucket, 'x', 'c1')).toBeNull();
    });

    it('returns parsed metadata on success', async () => {
      const c: CommitMetadata = {
        id: 'c1',
        message: 'm',
        timestamp: 't',
        author: 'A',
        parentId: null,
        files: [],
      };
      const bucket = createMockBucket({ getImpl: async () => objFromText(JSON.stringify(c)) });
      const got = await getCommit(bucket, 'x', 'c1');
      expect(got?.id).toBe('c1');
    });
  });

  // ── checkoutSnapshot: missing commit throws, per-file resilience ──
  describe('checkoutSnapshot resilience', () => {
    it('throws when the commit does not exist', async () => {
      const bucket = createMockBucket({ getImpl: async () => null });
      await expect(checkoutSnapshot(bucket, 'x', 'missing')).rejects.toThrow(
        'Commit not found: missing',
      );
    });

    it('skips files whose object is missing (null)', async () => {
      const commit: CommitMetadata = {
        id: 'c1',
        message: 'm',
        timestamp: 't',
        author: 'A',
        parentId: null,
        files: [
          { name: 'present.txt', size: 1 },
          { name: 'gone.txt', size: 1 },
        ],
      };
      const bucket = createMockBucket({
        getImpl: async (key) => {
          if (key.includes('commits/c1.json')) return objFromText(JSON.stringify(commit));
          if (key.includes('trees/c1/present.txt')) return objFromText('hello');
          return null; // gone.txt missing
        },
      });
      const files = await checkoutSnapshot(bucket, 'x', 'c1');
      expect(files).toEqual([{ name: 'present.txt', content: 'hello' }]);
    });

    it('skips files whose read throws', async () => {
      const commit: CommitMetadata = {
        id: 'c1',
        message: 'm',
        timestamp: 't',
        author: 'A',
        parentId: null,
        files: [{ name: 'boom.txt', size: 1 }],
      };
      const bucket = createMockBucket({
        getImpl: async (key) => {
          if (key.includes('commits/c1.json')) return objFromText(JSON.stringify(commit));
          throw new Error('file read failed');
        },
      });
      const files = await checkoutSnapshot(bucket, 'x', 'c1');
      expect(files).toEqual([]);
    });
  });

  // ── revertToSnapshot: propagates checkout failure ─────────────
  describe('revertToSnapshot resilience', () => {
    it('rejects when the target commit is missing (checkout throws)', async () => {
      const bucket = createMockBucket({ getImpl: async () => null });
      await expect(revertToSnapshot(bucket, 'x', 'missing')).rejects.toThrow(
        'Commit not found: missing',
      );
    });

    it('throws when the target commit has no files', async () => {
      const commit: CommitMetadata = {
        id: 'c1',
        message: 'empty',
        timestamp: 't',
        author: 'A',
        parentId: null,
        files: [], // no files -> checkout returns [] -> revert throws
      };
      const bucket = createMockBucket({
        getImpl: async (key) =>
          key.includes('commits/c1.json') ? objFromText(JSON.stringify(commit)) : null,
      });
      await expect(revertToSnapshot(bucket, 'x', 'c1')).rejects.toThrow(
        'No files found in commit: c1',
      );
    });
  });

  // ── getHead: null, empty, throw, success ──────────────────────
  describe('getHead resilience', () => {
    it('returns null when HEAD object missing', async () => {
      const bucket = createMockBucket({ getImpl: async () => null });
      expect(await getHead(bucket, 'x')).toBeNull();
    });

    it('returns null when HEAD is whitespace-only', async () => {
      const bucket = createMockBucket({ getImpl: async () => objFromText('   ') });
      expect(await getHead(bucket, 'x')).toBeNull();
    });

    it('returns null when the read throws', async () => {
      const bucket = createMockBucket({
        getImpl: async () => {
          throw new Error('down');
        },
      });
      expect(await getHead(bucket, 'x')).toBeNull();
    });

    it('returns the trimmed HEAD commit id', async () => {
      const bucket = createMockBucket({ getImpl: async () => objFromText('  abc-123\n') });
      expect(await getHead(bucket, 'x')).toBe('abc-123');
    });
  });
});
