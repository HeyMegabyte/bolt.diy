import {
  createRollbackPoint,
  rollbackPreview,
  rollbackSummary,
  type RollbackPoint,
} from '../services/rollback_point.js';

describe('rollback_point', () => {
  // -----------------------------------------------------------------------
  // createRollbackPoint
  // -----------------------------------------------------------------------
  describe('createRollbackPoint', () => {
    it('creates a RollbackPoint with required fields', () => {
      const rp = createRollbackPoint('site_1', 'abc123', 42);

      expect(rp.id).toBeDefined();
      expect(typeof rp.id).toBe('string');
      expect(rp.id.length).toBeGreaterThan(0);
      expect(rp.siteId).toBe('site_1');
      expect(rp.version).toBe('abc123');
      expect(rp.fileCount).toBe(42);
    });

    it('generates a unique id per call', () => {
      const a = createRollbackPoint('site_1', 'v1', 10);
      const b = createRollbackPoint('site_1', 'v1', 10);
      expect(a.id).not.toBe(b.id);
    });

    it('generates an ISO timestamp', () => {
      const rp = createRollbackPoint('site_1', 'v1', 10);
      expect(rp.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(() => new Date(rp.createdAt)).not.toThrow();
    });

    it('omits reason when not provided', () => {
      const rp = createRollbackPoint('site_1', 'v1', 10);
      expect(rp.reason).toBeUndefined();
    });

    it('sets reason when provided', () => {
      const rp = createRollbackPoint('site_1', 'v1', 10, 'Fix layout bug');
      expect(rp.reason).toBe('Fix layout bug');
    });

    it('accepts empty string reason', () => {
      const rp = createRollbackPoint('site_1', 'v1', 10, '');
      expect(rp.reason).toBe('');
    });

    it('preserves all passed fields in the result', () => {
      const rp = createRollbackPoint('site_42', 'release/2.0', 128, 'Major deploy');
      expect(rp.siteId).toBe('site_42');
      expect(rp.version).toBe('release/2.0');
      expect(rp.fileCount).toBe(128);
      expect(rp.reason).toBe('Major deploy');
    });
  });

  // -----------------------------------------------------------------------
  // rollbackPreview
  // -----------------------------------------------------------------------
  describe('rollbackPreview', () => {
    const makePoint = (version: string): RollbackPoint => ({
      id: `id_${version}`,
      siteId: 'site_1',
      version,
      createdAt: '2026-06-29T12:00:00.000Z',
      fileCount: 10,
    });

    const p1 = makePoint('v1');
    const p2 = makePoint('v2');
    const p3 = makePoint('v3');
    const points = [p1, p2, p3];

    it('returns all points as available', () => {
      const { available } = rollbackPreview(points, null);
      expect(available).toHaveLength(3);
      expect(available).toEqual(points);
    });

    it('returns a new array reference for available', () => {
      const { available } = rollbackPreview(points, null);
      expect(available).not.toBe(points);
    });

    it('selects the point matching the target version', () => {
      const { selected } = rollbackPreview(points, 'v2');
      expect(selected).not.toBeNull();
      expect(selected!.version).toBe('v2');
      expect(selected!.id).toBe('id_v2');
    });

    it('returns null selected when target is null', () => {
      const { selected } = rollbackPreview(points, null);
      expect(selected).toBeNull();
    });

    it('returns null selected when target does not match any version', () => {
      const { selected } = rollbackPreview(points, 'v99');
      expect(selected).toBeNull();
    });

    it('handles empty points array', () => {
      const { available, selected } = rollbackPreview([], 'v1');
      expect(available).toEqual([]);
      expect(selected).toBeNull();
    });

    it('selects the first match when multiple points share the same version', () => {
      const dupes = [
        { ...makePoint('v1'), id: 'first' },
        { ...makePoint('v1'), id: 'second' },
      ];
      const { selected } = rollbackPreview(dupes, 'v1');
      expect(selected!.id).toBe('first');
    });

    it('does not mutate the original array', () => {
      const copy = [...points];
      rollbackPreview(points, 'v2');
      expect(points).toEqual(copy);
    });
  });

  // -----------------------------------------------------------------------
  // rollbackSummary
  // -----------------------------------------------------------------------
  describe('rollbackSummary', () => {
    const makeDated = (version: string, iso: string): RollbackPoint => ({
      id: `id_${version}`,
      siteId: 'site_1',
      version,
      createdAt: iso,
      fileCount: 10,
    });

    it('returns zeros and nulls for an empty list', () => {
      const s = rollbackSummary([]);
      expect(s).toEqual({ count: 0, newest: null, oldest: null });
    });

    it('returns count = points.length', () => {
      const points = [
        makeDated('v1', '2026-06-01T00:00:00.000Z'),
        makeDated('v2', '2026-06-02T00:00:00.000Z'),
      ];
      expect(rollbackSummary(points).count).toBe(2);
    });

    it('identifies the newest point by createdAt', () => {
      const old = makeDated('v1', '2026-06-01T00:00:00.000Z');
      const mid = makeDated('v2', '2026-06-10T00:00:00.000Z');
      const new_ = makeDated('v3', '2026-06-20T00:00:00.000Z');
      const s = rollbackSummary([old, mid, new_]);
      expect(s.newest!.version).toBe('v3');
      expect(s.newest!.createdAt).toBe('2026-06-20T00:00:00.000Z');
    });

    it('identifies the oldest point by createdAt', () => {
      const old = makeDated('v1', '2026-06-01T00:00:00.000Z');
      const mid = makeDated('v2', '2026-06-10T00:00:00.000Z');
      const new_ = makeDated('v3', '2026-06-20T00:00:00.000Z');
      const s = rollbackSummary([old, mid, new_]);
      expect(s.oldest!.version).toBe('v1');
      expect(s.oldest!.createdAt).toBe('2026-06-01T00:00:00.000Z');
    });

    it('handles single-element list (same point is both newest and oldest)', () => {
      const p = makeDated('v1', '2026-06-15T00:00:00.000Z');
      const s = rollbackSummary([p]);
      expect(s.count).toBe(1);
      expect(s.newest!.id).toBe(p.id);
      expect(s.oldest!.id).toBe(p.id);
      expect(s.newest!.id).toBe(s.oldest!.id);
    });

    it('returns correct newest and oldest regardless of input order', () => {
      const new_ = makeDated('v3', '2026-06-20T00:00:00.000Z');
      const old = makeDated('v1', '2026-06-01T00:00:00.000Z');
      const mid = makeDated('v2', '2026-06-10T00:00:00.000Z');
      const s = rollbackSummary([new_, old, mid]); // reverse order
      expect(s.oldest!.version).toBe('v1');
      expect(s.newest!.version).toBe('v3');
    });

    it('does not mutate the original array', () => {
      const points = [
        makeDated('v1', '2026-06-01T00:00:00.000Z'),
        makeDated('v2', '2026-06-02T00:00:00.000Z'),
      ];
      const copy = [...points];
      rollbackSummary(points);
      expect(points).toEqual(copy);
    });
  });
});
