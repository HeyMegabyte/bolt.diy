/**
 * @module __tests__/asset_migration
 * @description Unit tests for migrateExternalAssets — the external-asset
 * migration stub. Locks the zeroed MigrationReport contract so the eventual
 * full implementation can be diffed against a known baseline.
 */

import { migrateExternalAssets } from '../services/asset_migration.js';
import type { MigrationReport } from '../services/asset_migration.js';

// The stub ignores its R2 argument; a no-op cast keeps types honest.
const bucket = {} as unknown as R2Bucket;

describe('migrateExternalAssets', () => {
  it('resolves to a fully-zeroed MigrationReport', async () => {
    const report = await migrateExternalAssets(bucket, 'vitos', 'v1');
    expect(report).toEqual<MigrationReport>({
      scanned_files: 0,
      unique_urls: 0,
      uploaded: 0,
      rewritten_files: 0,
      failed: [],
    });
  });

  it('returns numeric counters and an array for failed', async () => {
    const report = await migrateExternalAssets(bucket, 'slug', 'v2');
    expect(typeof report.scanned_files).toBe('number');
    expect(typeof report.unique_urls).toBe('number');
    expect(typeof report.uploaded).toBe('number');
    expect(typeof report.rewritten_files).toBe('number');
    expect(Array.isArray(report.failed)).toBe(true);
    expect(report.failed).toHaveLength(0);
  });

  it('is a no-op stub: never touches the R2 bucket', async () => {
    const get = jest.fn();
    const put = jest.fn();
    const list = jest.fn();
    const spyBucket = { get, put, list } as unknown as R2Bucket;
    await migrateExternalAssets(spyBucket, 'slug', 'v1');
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('returns a fresh report object on each call (no shared mutation)', async () => {
    const a = await migrateExternalAssets(bucket, 'a', 'v1');
    const b = await migrateExternalAssets(bucket, 'b', 'v1');
    expect(a).not.toBe(b);
    expect(a.failed).not.toBe(b.failed);
    a.failed.push({ url: 'https://x', reason: 'test' });
    expect(b.failed).toHaveLength(0);
  });

  it('tolerates empty slug and version inputs', async () => {
    const report = await migrateExternalAssets(bucket, '', '');
    expect(report.scanned_files).toBe(0);
    expect(report.failed).toEqual([]);
  });

  it('tolerates unusual slug/version edge inputs', async () => {
    const report = await migrateExternalAssets(
      bucket,
      'slug-with-../weird~chars',
      'v999.beta',
    );
    expect(report.uploaded).toBe(0);
    expect(report.rewritten_files).toBe(0);
  });
});
