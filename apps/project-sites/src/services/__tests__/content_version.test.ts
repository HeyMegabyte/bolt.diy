import {
  createVersion,
  diffVersions,
  rollbackVersion,
  type ContentVersion,
} from '../content_version';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SITE_ID = 'site_test_abc';

/** Stub versions for rollback tests — deterministic by overriding id/createdAt. */
function stubVersion(version: string, content: string, reason?: string): ContentVersion {
  return {
    createdAt: '2026-06-29T00:00:00.000Z',
    content,
    id: `id-${version}`,
    reason,
    siteId: SITE_ID,
    version,
  };
}

// ---------------------------------------------------------------------------
// createVersion
// ---------------------------------------------------------------------------

describe('createVersion', () => {
  it('returns all required fields', () => {
    const v = createVersion(SITE_ID, 'hello', 'draft-1');
    expect(v.siteId).toBe(SITE_ID);
    expect(v.content).toBe('hello');
    expect(v.version).toBe('draft-1');
    expect(v.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(v.createdAt).toEqual(expect.any(String));
    expect(Date.parse(v.createdAt)).not.toBeNaN();
  });

  it('sets reason when provided', () => {
    const v = createVersion(SITE_ID, 'x', 'v1', 'After AI polish');
    expect(v.reason).toBe('After AI polish');
  });

  it('omits reason when not provided', () => {
    const v = createVersion(SITE_ID, 'x', 'v1');
    expect(v.reason).toBeUndefined();
  });

  it('generates a unique id on each call', () => {
    const a = createVersion(SITE_ID, 'a', 'v1');
    const b = createVersion(SITE_ID, 'b', 'v2');
    expect(a.id).not.toBe(b.id);
  });

  it('produces a parsable ISO timestamp', () => {
    const before = Date.now() - 100;
    const v = createVersion(SITE_ID, 'x', 'v1');
    const after = Date.now() + 100;
    const ts = Date.parse(v.createdAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// diffVersions
// ---------------------------------------------------------------------------

describe('diffVersions', () => {
  it('returns empty diff for identical content', () => {
    const result = diffVersions('a\nb\nc', 'a\nb\nc');
    expect(result).toEqual({ added: [], removed: [], changed: [] });
  });

  it('detects additions', () => {
    const result = diffVersions('a\nb', 'a\nb\nc\nd');
    expect(result.added).toEqual(['c', 'd']);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it('detects removals', () => {
    const result = diffVersions('a\nb\nc', 'a');
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(['b', 'c']);
    expect(result.changed).toEqual([]);
  });

  it('detects changes at the same line index', () => {
    const result = diffVersions('a\nb\nc', 'a\nx\nc');
    expect(result.changed).toEqual(['x']);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('handles empty strings', () => {
    expect(diffVersions('', '')).toEqual({ added: [], removed: [], changed: [] });
  });

  it('detects content from empty to non-empty', () => {
    // '' splits to ['']; i=0 triggers changed, i=1 triggers added
    const result = diffVersions('', 'hello\nworld');
    expect(result.changed).toEqual(['hello']);
    expect(result.added).toEqual(['world']);
  });

  it('detects content from non-empty to empty', () => {
    // '' splits to ['']; i=0 triggers changed, i=1 triggers removed
    const result = diffVersions('hello\nworld', '');
    expect(result.changed).toEqual(['']);
    expect(result.removed).toEqual(['world']);
  });

  it('handles single-line strings', () => {
    expect(diffVersions('line1', 'line2')).toEqual({
      added: [],
      removed: [],
      changed: ['line2'],
    });
  });

  it('preserves trailing empty line from split', () => {
    // "a\n" splits to ['a', '']; "a" splits to ['a']
    const result = diffVersions('a\n', 'a');
    expect(result).toEqual({ added: [], removed: [''], changed: [] });
  });

  it('detects mixed diff where all lines differ at same index', () => {
    // oldLines: ['keep', 'remove', 'old']  len=3
    // newLines: ['keep', 'new', 'changed'] len=3
    // i=0: match, i=1-2: differ → both in changed
    const result = diffVersions('keep\nremove\nold', 'keep\nnew\nchanged');
    expect(result.changed).toEqual(['new', 'changed']);
    expect(result.removed).toEqual([]);
    expect(result.added).toEqual([]);
  });

  it('does not mutate input strings', () => {
    const older = 'unchanged content';
    const newer = 'unchanged content';
    diffVersions(older, newer);
    expect(older).toBe('unchanged content');
    expect(newer).toBe('unchanged content');
  });
});

// ---------------------------------------------------------------------------
// rollbackVersion
// ---------------------------------------------------------------------------

describe('rollbackVersion', () => {
  const versions: readonly ContentVersion[] = [
    stubVersion('v1', 'Hello'),
    stubVersion('v2', 'Hello World'),
    stubVersion('v3', 'Hello World!'),
  ];

  it('returns matching version by label', () => {
    const result = rollbackVersion(versions, 'v1');
    expect(result).not.toBeNull();
    expect(result!.version).toBe('v1');
    expect(result!.content).toBe('Hello');
  });

  it('returns the full ContentVersion object', () => {
    const result = rollbackVersion(versions, 'v2');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('id-v2');
    expect(result!.siteId).toBe(SITE_ID);
    expect(result!.content).toBe('Hello World');
    expect(result!.createdAt).toBe('2026-06-29T00:00:00.000Z');
  });

  it('returns null when target does not exist', () => {
    const result = rollbackVersion(versions, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for empty versions list', () => {
    const result = rollbackVersion([], 'v1');
    expect(result).toBeNull();
  });

  it('returns a shallow clone, not a reference to the array entry', () => {
    const result = rollbackVersion(versions, 'v1');
    expect(result).toEqual(versions[0]);
    // Mutating the result must not affect the source
    if (result) {
      (result as ContentVersion & { mutated?: boolean }).mutated = true;
    }
    expect((versions[0] as unknown as Record<string, unknown>).mutated).toBeUndefined();
  });

  it('does not mutate the input array', () => {
    const copy = [...versions];
    rollbackVersion(versions, 'v2');
    expect(versions).toEqual(copy);
  });
});
