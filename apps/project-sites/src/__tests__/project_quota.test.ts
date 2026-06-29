/**
 * Per-project quota SSOT. Locks the matrix values + plan lookup + exceeded
 * logic that the billing + publish routes depend on. Drift here means a
 * free-tier user can publish their 4th page without a gate error.
 */
import { QUOTA_MATRIX, getProjectQuota, isQuotaExceeded } from '../services/project_quota.js';

describe('project quota matrix', () => {
  it('defines exactly the five resource types', () => {
    expect(QUOTA_MATRIX.map((q) => q.type)).toEqual([
      'pages',
      'images',
      'forms',
      'blog_posts',
      'team_members',
    ]);
  });

  it('assigns pages: free=3, starter=10, pro=50', () => {
    const row = QUOTA_MATRIX.find((q) => q.type === 'pages')!;
    expect(row.free).toBe(3);
    expect(row.starter).toBe(10);
    expect(row.pro).toBe(50);
    expect(row.unit).toBe('pages');
  });

  it('assigns images: free=10, starter=50, pro=200', () => {
    const row = QUOTA_MATRIX.find((q) => q.type === 'images')!;
    expect(row.free).toBe(10);
    expect(row.starter).toBe(50);
    expect(row.pro).toBe(200);
    expect(row.unit).toBe('images');
  });

  it('assigns forms: free=1, starter=3, pro=10', () => {
    const row = QUOTA_MATRIX.find((q) => q.type === 'forms')!;
    expect(row.free).toBe(1);
    expect(row.starter).toBe(3);
    expect(row.pro).toBe(10);
    expect(row.unit).toBe('forms');
  });

  it('assigns blog_posts: free=0, starter=5, pro=25', () => {
    const row = QUOTA_MATRIX.find((q) => q.type === 'blog_posts')!;
    expect(row.free).toBe(0);
    expect(row.starter).toBe(5);
    expect(row.pro).toBe(25);
    expect(row.unit).toBe('posts');
  });

  it('assigns team_members: free=1, starter=3, pro=10', () => {
    const row = QUOTA_MATRIX.find((q) => q.type === 'team_members')!;
    expect(row.free).toBe(1);
    expect(row.starter).toBe(3);
    expect(row.pro).toBe(10);
    expect(row.unit).toBe('members');
  });
});

describe('getProjectQuota', () => {
  it('returns the cap for a known resource + known plan', () => {
    expect(getProjectQuota('pages', 'free')).toBe(3);
    expect(getProjectQuota('pages', 'starter')).toBe(10);
    expect(getProjectQuota('pages', 'pro')).toBe(50);
    expect(getProjectQuota('images', 'starter')).toBe(50);
  });

  it('returns 0 for an unknown plan', () => {
    expect(getProjectQuota('pages', 'premium')).toBe(0);
    expect(getProjectQuota('images', '')).toBe(0);
  });

  it('returns 0 for an unknown resource type', () => {
    // @ts-expect-error — deliberate invalid type for defensive coverage
    expect(getProjectQuota('bandwidth', 'free')).toBe(0);
  });
});

describe('isQuotaExceeded', () => {
  it('returns true when used >= limit', () => {
    expect(isQuotaExceeded('pages', 'free', 3)).toBe(true);
    expect(isQuotaExceeded('pages', 'free', 4)).toBe(true);
    expect(isQuotaExceeded('images', 'pro', 200)).toBe(true);
  });

  it('returns false when used < limit', () => {
    expect(isQuotaExceeded('pages', 'free', 2)).toBe(false);
    expect(isQuotaExceeded('pages', 'free', 0)).toBe(false);
    expect(isQuotaExceeded('team_members', 'pro', 9)).toBe(false);
  });

  it('returns true for unknown plans (treated as zero-quota)', () => {
    expect(isQuotaExceeded('pages', 'nonexistent', 0)).toBe(true);
    expect(isQuotaExceeded('pages', 'nonexistent', 1)).toBe(true);
  });
});
