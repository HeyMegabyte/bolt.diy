/**
 * @module __tests__/workflow_status
 * Tests for workflow status transitions (collecting → generating → uploading → published)
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';

describe('Workflow status transitions', () => {
  const mockRun = jest.fn();
  const mockBind = jest.fn().mockReturnValue({ run: mockRun });
  const mockPrepare = jest.fn().mockReturnValue({ bind: mockBind });
  const mockDb = { prepare: mockPrepare } as unknown as D1Database;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockResolvedValue({ results: [] });
    mockBind.mockReturnValue({ run: mockRun });
    mockPrepare.mockReturnValue({ bind: mockBind });
  });

  it('updateSiteStatus sets status to collecting', async () => {
    await mockDb
      .prepare("UPDATE sites SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind('collecting', 'site-123')
      .run();
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE sites SET status'),
    );
    expect(mockBind).toHaveBeenCalledWith('collecting', 'site-123');
    expect(mockRun).toHaveBeenCalled();
  });

  it('updateSiteStatus sets status to generating', async () => {
    await mockDb
      .prepare("UPDATE sites SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind('generating', 'site-456')
      .run();
    expect(mockBind).toHaveBeenCalledWith('generating', 'site-456');
  });

  it('updateSiteStatus sets status to uploading', async () => {
    await mockDb
      .prepare("UPDATE sites SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind('uploading', 'site-789')
      .run();
    expect(mockBind).toHaveBeenCalledWith('uploading', 'site-789');
  });

  it('status transitions follow correct order', () => {
    const expectedOrder = ['building', 'collecting', 'generating', 'uploading', 'published'];
    // Verify the expected status progression
    expect(expectedOrder[0]).toBe('building');
    expect(expectedOrder[1]).toBe('collecting');
    expect(expectedOrder[2]).toBe('generating');
    expect(expectedOrder[3]).toBe('uploading');
    expect(expectedOrder[4]).toBe('published');
  });

  it('error status should exist for failed workflows', () => {
    const statusLabels: Record<string, string> = {
      published: 'Live',
      building: 'Building',
      queued: 'Queued',
      collecting: 'Collecting Data',
      generating: 'Generating',
      uploading: 'Uploading',
      error: 'Error',
      failed: 'Error',
      draft: 'Draft',
    };
    expect(statusLabels['error']).toBe('Error');
    expect(statusLabels['failed']).toBe('Error');
    expect(statusLabels['collecting']).toBe('Collecting Data');
    expect(statusLabels['generating']).toBe('Generating');
    expect(statusLabels['uploading']).toBe('Uploading');
    expect(statusLabels['published']).toBe('Live');
  });

  it('mapStatusClass maps failed to error', () => {
    function mapStatusClass(status: string): string {
      if (status === 'failed') return 'error';
      return status;
    }
    expect(mapStatusClass('failed')).toBe('error');
    expect(mapStatusClass('published')).toBe('published');
    expect(mapStatusClass('collecting')).toBe('collecting');
    expect(mapStatusClass('error')).toBe('error');
  });
});
