import {
  buildRestorePlan,
  restorePreviewUrl,
  type RestorePoint,
} from '../services/site_restore.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POINTS: readonly RestorePoint[] = [
  {
    version: 'abc',
    slug: 'my-site',
    createdAt: '2026-06-28T12:00:00Z',
    fileCount: 10,
    sizeBytes: 50000,
  },
  {
    version: 'def',
    slug: 'my-site',
    createdAt: '2026-06-29T12:00:00Z',
    fileCount: 12,
    sizeBytes: 62000,
  },
  {
    version: 'ghi',
    slug: 'my-site',
    createdAt: '2026-06-30T12:00:00Z',
    fileCount: 15,
    sizeBytes: 80000,
  },
];

const SINGLE_POINT: readonly RestorePoint[] = [
  {
    version: 'abc',
    slug: 'my-site',
    createdAt: '2026-06-28T12:00:00Z',
    fileCount: 8,
    sizeBytes: 30000,
  },
];

// ---------------------------------------------------------------------------
// buildRestorePlan
// ---------------------------------------------------------------------------

describe('buildRestorePlan', () => {
  it('returns null latest and oldest when points array is empty', () => {
    const plan = buildRestorePlan('site-1', 'my-site', []);

    expect(plan.latest).toBeNull();
    expect(plan.oldest).toBeNull();
    expect(plan.count).toBe(0);
  });

  it('identifies the same point as both latest and oldest for a single entry', () => {
    const plan = buildRestorePlan('site-1', 'my-site', SINGLE_POINT);

    expect(plan.count).toBe(1);
    expect(plan.latest).toEqual(SINGLE_POINT[0]);
    expect(plan.oldest).toEqual(SINGLE_POINT[0]);
  });

  it('identifies latest and oldest from multiple points', () => {
    const plan = buildRestorePlan('site-1', 'my-site', POINTS);

    expect(plan.count).toBe(3);
    expect(plan.latest?.version).toBe('ghi');
    expect(plan.latest?.createdAt).toBe('2026-06-30T12:00:00Z');
    expect(plan.oldest?.version).toBe('abc');
    expect(plan.oldest?.createdAt).toBe('2026-06-28T12:00:00Z');
  });

  it('handles unsorted input and returns chronologically correct latest/oldest', () => {
    const unsorted: readonly RestorePoint[] = [
      {
        version: 'ghi',
        slug: 'my-site',
        createdAt: '2026-06-30T12:00:00Z',
        fileCount: 15,
        sizeBytes: 80000,
      },
      {
        version: 'abc',
        slug: 'my-site',
        createdAt: '2026-06-28T12:00:00Z',
        fileCount: 10,
        sizeBytes: 50000,
      },
      {
        version: 'def',
        slug: 'my-site',
        createdAt: '2026-06-29T12:00:00Z',
        fileCount: 12,
        sizeBytes: 62000,
      },
    ];

    const plan = buildRestorePlan('site-1', 'my-site', unsorted);

    expect(plan.count).toBe(3);
    expect(plan.latest?.version).toBe('ghi');
    expect(plan.oldest?.version).toBe('abc');
  });

  it('collapses adjacent duplicates, keeping only the last occurrence', () => {
    const withDups: readonly RestorePoint[] = [
      {
        version: 'abc',
        slug: 'my-site',
        createdAt: '2026-06-28T12:00:00Z',
        fileCount: 10,
        sizeBytes: 50000,
      },
      {
        version: 'abc',
        slug: 'my-site',
        createdAt: '2026-06-28T13:00:00Z',
        fileCount: 11,
        sizeBytes: 51000,
      },
      {
        version: 'def',
        slug: 'my-site',
        createdAt: '2026-06-29T12:00:00Z',
        fileCount: 12,
        sizeBytes: 62000,
      },
    ];

    const plan = buildRestorePlan('site-1', 'my-site', withDups);

    // abc is deduped to the last occurrence (the one with 11 files)
    expect(plan.count).toBe(2);
    expect(plan.latest?.version).toBe('def');
    expect(plan.oldest?.version).toBe('abc');
    expect(plan.oldest?.fileCount).toBe(11);
  });

  it('accepts siteId and slug params without affecting the plan (reserved for provenance)', () => {
    const plan = buildRestorePlan('site-999', 'other-site', SINGLE_POINT);

    // The slug in the plan comes from the RestorePoint data, not the _slug param.
    // The params are accepted for future provenance tracing.
    expect(plan.count).toBe(1);
    expect(plan.latest).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// restorePreviewUrl
// ---------------------------------------------------------------------------

describe('restorePreviewUrl', () => {
  it('uses the default projectsites.dev domain', () => {
    const url = restorePreviewUrl('my-site', 'abc123');

    expect(url).toBe('https://my-site-abc123.projectsites.dev');
  });

  it('accepts a custom base domain', () => {
    const url = restorePreviewUrl('my-site', 'def456', 'preview.example.com');

    expect(url).toBe('https://my-site-def456.preview.example.com');
  });

  it('uses http for localhost domains', () => {
    const url = restorePreviewUrl('my-site', 'abc123', 'localhost:8787');

    expect(url).toBe('http://my-site-abc123.localhost:8787');
  });

  it('uses http for 127.x.x.x domains', () => {
    const url = restorePreviewUrl('my-site', 'abc123', '127.0.0.1:8787');

    expect(url).toBe('http://my-site-abc123.127.0.0.1:8787');
  });

  it('handles version strings with dots and dashes', () => {
    const url = restorePreviewUrl('my-site', 'v1.2.3-rc1');

    expect(url).toBe('https://my-site-v1.2.3-rc1.projectsites.dev');
  });

  it('handles empty version string', () => {
    const url = restorePreviewUrl('my-site', '');

    expect(url).toBe('https://my-site-.projectsites.dev');
  });
});
