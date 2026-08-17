/**
 * stuck_builds — the cron sweep that recovers builds whose workflow died mid-run.
 * The status set MUST include `collecting` (the research phase serve renders as
 * "Building…"), which the old inline sweep OMITTED → stranded builds looped forever.
 * D1 helpers are mocked.
 */
jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(async () => ({ data: [], error: null })),
  dbExecute: jest.fn(async () => ({ error: null, changes: 1 })),
}));

import { IN_PROGRESS_BUILD_STATUSES, unstickStalledBuilds } from '../services/stuck_builds.js';
import { dbQuery, dbExecute } from '../services/db.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockExecute = dbExecute as jest.MockedFunction<typeof dbExecute>;
const env = { DB: {} as unknown } as never;

beforeEach(() => jest.clearAllMocks());

describe('IN_PROGRESS_BUILD_STATUSES', () => {
  it('INCLUDES collecting — the research-phase gap the old inline sweep missed', () => {
    expect(IN_PROGRESS_BUILD_STATUSES).toContain('collecting');
  });

  it('covers the active build phases serve renders as "Building…" (except pre-build draft)', () => {
    for (const s of ['collecting', 'imaging', 'generating', 'building']) {
      expect(IN_PROGRESS_BUILD_STATUSES).toContain(s);
    }
    // `draft` is intentionally EXCLUDED — a saved-but-unbuilt site must not be auto-errored.
    expect(IN_PROGRESS_BUILD_STATUSES).not.toContain('draft');
  });
});

describe('unstickStalledBuilds', () => {
  it('flips every stalled in-progress build to error + returns the count', async () => {
    mockQuery.mockResolvedValueOnce({
      data: [
        { id: 's1', slug: 'a', business_name: 'A' },
        { id: 's2', slug: 'b', business_name: 'B' },
      ],
      error: null,
    } as never);
    const n = await unstickStalledBuilds(env);
    expect(n).toBe(2);
    // One UPDATE per stalled site, each flipping to 'error'.
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(String(mockExecute.mock.calls[0][1])).toMatch(/UPDATE sites SET status = 'error'/);
  });

  it('scopes the SELECT to the collecting-inclusive status set + the stale window', async () => {
    await unstickStalledBuilds(env, 45);
    const [, sql, params] = mockQuery.mock.calls[0] as [unknown, string, unknown[]];
    expect(sql).toMatch(/status IN \(/);
    expect(sql).toMatch(/updated_at < datetime\('now', \?\)/);
    // Params carry every status (incl. collecting) THEN the stale window.
    expect(params).toContain('collecting');
    expect(params[params.length - 1]).toBe('-45 minutes');
  });

  it('does NOT count a dropped UPDATE (self-heals next sweep) + logs it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockQuery.mockResolvedValueOnce({
      data: [{ id: 's1', slug: 'a', business_name: 'A' }],
      error: null,
    } as never);
    mockExecute.mockResolvedValueOnce({ error: 'D1_ERROR: locked', changes: 0 });
    const n = await unstickStalledBuilds(env);
    expect(n).toBe(0);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('failed to unstick a stalled build');
    warn.mockRestore();
  });

  it('is a no-op when nothing is stalled', async () => {
    const n = await unstickStalledBuilds(env);
    expect(n).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
