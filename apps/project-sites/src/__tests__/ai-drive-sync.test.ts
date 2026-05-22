/**
 * Unit tests for the Google Drive ingest pipeline (services/ai_drive_sync.ts).
 *
 * Mocks:
 *   - getAccessToken so no real OAuth happens
 *   - listFolderFiles / downloadFile from google_drive.ts (Drive API)
 *   - extractContext from ai_context_extract.ts
 *
 * Covers:
 *   - throws when no folder configured
 *   - inserts new files with source='drive'
 *   - updates existing rows when modified_time is newer
 *   - skips existing rows when not newer
 *   - soft-deletes orphaned rows whose drive_file_id is no longer remote
 */

jest.mock('../services/google_drive.js', () => ({
  __esModule: true,
  getAccessToken: jest.fn().mockResolvedValue('access-token'),
  listFolderFiles: jest.fn(),
  downloadFile: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.readonly',
}));

jest.mock('../services/ai_context_extract.js', () => ({
  __esModule: true,
  MAX_CONTEXT_FILE_BYTES: 10 * 1024 * 1024,
  extractContext: jest.fn().mockResolvedValue({
    text: 'drive file text',
    pages_processed: 1,
    truncated: false,
  }),
}));

import { syncDriveFolder } from '../services/ai_drive_sync.js';
import { listFolderFiles } from '../services/google_drive.js';
import type { Env } from '../types/env.js';

interface MockRun {
  sql: string;
  params: unknown[];
}

function makeDb(opts: {
  folderId: string | null;
  existing: Array<{ id: string; drive_file_id: string; drive_modified_time: string; r2_key: string }>;
}): { db: D1Database; runs: MockRun[] } {
  const runs: MockRun[] = [];
  const db = {
    prepare: jest.fn().mockImplementation((sql: string) => ({
      bind: jest.fn().mockImplementation((...params: unknown[]) => ({
        first: jest.fn().mockImplementation(() => {
          if (sql.includes('drive_folder_id FROM ai_site_settings')) {
            return Promise.resolve({ drive_folder_id: opts.folderId });
          }
          return Promise.resolve(null);
        }),
        all: jest.fn().mockImplementation(() => {
          if (sql.includes('FROM ai_context_files')) {
            return Promise.resolve({ results: opts.existing });
          }
          return Promise.resolve({ results: [] });
        }),
        run: jest.fn().mockImplementation(() => {
          runs.push({ sql, params });
          return Promise.resolve({});
        }),
      })),
    })),
  } as unknown as D1Database;
  return { db, runs };
}

function makeEnv(): Env {
  return {
    SITES_BUCKET: { put: jest.fn().mockResolvedValue(undefined) } as unknown as R2Bucket,
  } as unknown as Env;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('syncDriveFolder', () => {
  it('throws when site has no folder configured', async () => {
    const env = makeEnv();
    const { db } = makeDb({ folderId: null, existing: [] });
    await expect(syncDriveFolder(env, db, 'site-1', 'org-1', 'slug')).rejects.toThrow(
      'drive_folder_not_configured',
    );
  });

  it('inserts a new file row with source=drive', async () => {
    (listFolderFiles as jest.Mock).mockResolvedValue([
      {
        id: 'd1',
        name: 'spec.pdf',
        mime_type: 'application/pdf',
        modified_time: '2026-01-01T00:00:00Z',
        size: 1000,
      },
    ]);
    const env = makeEnv();
    const { db, runs } = makeDb({ folderId: 'folder-1', existing: [] });
    const result = await syncDriveFolder(env, db, 'site-1', 'org-1', 'slug');
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
    const insertRun = runs.find((r) =>
      r.sql.includes("INSERT INTO ai_context_files") && r.sql.includes("'drive'"),
    );
    expect(insertRun).toBeDefined();
  });

  it('updates existing rows when modified_time is newer', async () => {
    (listFolderFiles as jest.Mock).mockResolvedValue([
      {
        id: 'd1',
        name: 'spec.pdf',
        mime_type: 'application/pdf',
        modified_time: '2026-02-01T00:00:00Z',
        size: 1000,
      },
    ]);
    const env = makeEnv();
    const { db, runs } = makeDb({
      folderId: 'folder-1',
      existing: [
        {
          id: 'row-1',
          drive_file_id: 'd1',
          drive_modified_time: '2026-01-01T00:00:00Z',
          r2_key: 'sites/slug/ai-context/old',
        },
      ],
    });
    const result = await syncDriveFolder(env, db, 'site-1', 'org-1', 'slug');
    expect(result.updated).toBe(1);
    expect(result.added).toBe(0);
    const updateRun = runs.find((r) => r.sql.includes('UPDATE ai_context_files SET filename'));
    expect(updateRun).toBeDefined();
  });

  it('skips files when modified_time is not newer', async () => {
    (listFolderFiles as jest.Mock).mockResolvedValue([
      {
        id: 'd1',
        name: 'spec.pdf',
        mime_type: 'application/pdf',
        modified_time: '2026-01-01T00:00:00Z',
        size: 1000,
      },
    ]);
    const env = makeEnv();
    const { db } = makeDb({
      folderId: 'folder-1',
      existing: [
        {
          id: 'row-1',
          drive_file_id: 'd1',
          drive_modified_time: '2026-01-01T00:00:00Z',
          r2_key: 'sites/slug/ai-context/cur',
        },
      ],
    });
    const result = await syncDriveFolder(env, db, 'site-1', 'org-1', 'slug');
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
  });

  it('soft-deletes orphans missing from remote', async () => {
    (listFolderFiles as jest.Mock).mockResolvedValue([]);
    const env = makeEnv();
    const { db, runs } = makeDb({
      folderId: 'folder-1',
      existing: [
        {
          id: 'row-orphan',
          drive_file_id: 'gone',
          drive_modified_time: '2026-01-01T00:00:00Z',
          r2_key: 'sites/slug/ai-context/orphan',
        },
      ],
    });
    const result = await syncDriveFolder(env, db, 'site-1', 'org-1', 'slug');
    expect(result.removed).toBe(1);
    const deleteRun = runs.find((r) => r.sql.includes('UPDATE ai_context_files SET deleted_at'));
    expect(deleteRun).toBeDefined();
  });
});
