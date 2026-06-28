// Uses the injected global `jest` (NOT @jest/globals) so @swc/jest hoists the mock
// above the import — see CLAUDE.md gotcha #12.
jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));

import { runAbandonedNudgesForEnv } from '../services/abandoned_builds_cron.js';
import { isFlagOn } from '../modules/feature_flags/services.js';

const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;

describe('runAbandonedNudgesForEnv (dark-launch safety)', () => {
  beforeEach(() => mockIsFlagOn.mockReset());

  it('is a no-op when the abandoned_build_nudge flag is OFF (never touches D1)', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const prepare = jest.fn();
    const env = { DB: { prepare } } as any;

    const res = await runAbandonedNudgesForEnv(env);

    expect(res).toEqual({ scanned: 0, nudged: 0, skipped: true });
    expect(prepare).not.toHaveBeenCalled(); // dark → no scan, no email, no write
    expect(mockIsFlagOn).toHaveBeenCalledWith(env, 'abandoned_build_nudge');
  });

  it('runs the scan when the flag is ON (queries sites, returns counts)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const all = jest.fn().mockResolvedValue({ results: [] }); // empty scan → 0/0
    const prepare = jest.fn().mockReturnValue({ all });
    const env = { DB: { prepare } } as any;

    const res = await runAbandonedNudgesForEnv(env);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ scanned: 0, nudged: 0 });
  });
});
