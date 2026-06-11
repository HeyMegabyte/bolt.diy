/**
 * Unit coverage for `SocialPublishWorkflow.run` (workflows/social-publish.ts) —
 * the Pulse Social publish pipeline. Previously untested. Covers: no-accounts →
 * status failed + {ok:false}; all-succeed → published + {ok:true}; a per-account
 * publish failure → partial + notifyOnFailure step + {ok:false}; a
 * MissingAppCredsError → 'skipped' (not retried, no markAccountError); a missing
 * post → loadPost throws.
 *
 * `cloudflare:workers` is virtual-mocked; db/account/publisher deps + the
 * `step.do` runner (2- or 3-arg) are mocked.
 */
jest.mock(
  'cloudflare:workers',
  () => ({
    __esModule: true,
    WorkflowEntrypoint: class<E, P> {
      env: E;
      constructor(_ctx: unknown, env: E) {
        this.env = env;
      }
    },
  }),
  { virtual: true },
);

jest.mock('../services/db.js', () => ({
  __esModule: true,
  dbQueryOne: jest.fn(),
  dbUpdate: jest.fn().mockResolvedValue(undefined),
  dbInsert: jest.fn().mockResolvedValue(undefined),
  dbExecute: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/social_account_ctx.js', () => ({
  __esModule: true,
  loadAccountsByIds: jest.fn(),
  markAccountError: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/social_publishers/index.js', () => {
  class MissingAppCredsError extends Error {}
  return { __esModule: true, getPublisher: jest.fn(), MissingAppCredsError };
});

import { SocialPublishWorkflow } from '../workflows/social-publish.js';
import { dbQueryOne, dbUpdate } from '../services/db.js';
import { loadAccountsByIds, markAccountError } from '../services/social_account_ctx.js';
import { getPublisher, MissingAppCredsError } from '../services/social_publishers/index.js';
import type { Env } from '../types/env.js';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

const dbqo = dbQueryOne as jest.Mock;
const dbup = dbUpdate as jest.Mock;
const loadAccts = loadAccountsByIds as jest.Mock;
const getPub = getPublisher as jest.Mock;
const markErr = markAccountError as jest.Mock;

const postRow = (over: Record<string, unknown> = {}) => ({
  id: 'post1',
  org_id: 'o1',
  created_by: 'u1',
  content: 'Hi',
  per_platform_overrides: null,
  media_keys: null,
  account_ids: JSON.stringify(['a1']),
  hashtags: null,
  mentions: null,
  link: null,
  status: 'queued',
  ...over,
});
const acct = (id: string, platform: string) => ({
  id,
  org_id: 'o1',
  platform,
  external_id: 'x',
  handle: '@h',
  access_token: 't',
  refresh_token: null,
  token_expires_at: null,
  scopes: null,
  metadata: {},
});

function makeStep() {
  const names: string[] = [];
  const step = {
    do: jest.fn((name: string, a: unknown, b?: unknown) => {
      names.push(name);
      const fn = (typeof a === 'function' ? a : b) as () => Promise<unknown>;
      return fn();
    }),
  } as unknown as WorkflowStep;
  return { step, names };
}
const run = (step: WorkflowStep) => {
  const wf = new SocialPublishWorkflow({} as never, { DB: {} } as unknown as Env);
  return wf.run({ payload: { post_id: 'post1' } } as WorkflowEvent<{ post_id: string }>, step);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  dbup.mockResolvedValue(undefined);
});

describe('SocialPublishWorkflow.run', () => {
  it('marks the post failed and returns ok:false when it has no accounts', async () => {
    dbqo.mockResolvedValue(postRow({ account_ids: null }));
    const { step } = makeStep();
    const out = await run(step);
    expect(out).toEqual({ ok: false, succeeded: 0, failed: 0 });
    expect(dbup).toHaveBeenCalledWith(
      expect.anything(),
      'pulse_posts',
      { status: 'failed' },
      'id = ?',
      ['post1'],
    );
  });

  it('publishes to all accounts and returns published/ok when all succeed', async () => {
    dbqo.mockResolvedValue(postRow());
    loadAccts.mockResolvedValue([acct('a1', 'twitter')]);
    getPub.mockReturnValue({
      publish: jest.fn().mockResolvedValue({ external_id: 'e1', external_url: 'https://x/e1' }),
    });
    const { step, names } = makeStep();
    const out = await run(step);
    expect(out).toEqual({ ok: true, succeeded: 1, failed: 0 });
    expect(names).toContain('publish-twitter-a1');
    expect(names).toContain('recordResults');
    expect(names).not.toContain('notifyOnFailure'); // no failure → no notify step
  });

  it('records a per-account failure, runs notifyOnFailure, and returns ok:false', async () => {
    dbqo.mockResolvedValue(postRow({ account_ids: JSON.stringify(['a1', 'a2']) }));
    loadAccts.mockResolvedValue([acct('a1', 'twitter'), acct('a2', 'linkedin')]);
    getPub
      .mockReturnValueOnce({
        publish: jest.fn().mockResolvedValue({ external_id: 'e1', external_url: 'u1' }),
      })
      .mockReturnValueOnce({ publish: jest.fn().mockRejectedValue(new Error('401 unauthorized')) });
    const { step, names } = makeStep();
    const out = await run(step);
    expect(out.ok).toBe(false);
    expect(out.succeeded).toBe(1);
    expect(out.failed).toBe(1);
    expect(names).toContain('notifyOnFailure');
    // a 401/unauthorized marks the account error (token expired/revoked)
    expect(markErr).toHaveBeenCalledWith(expect.anything(), 'a2', expect.stringContaining('401'));
  });

  it('treats a MissingAppCredsError as skipped (no retry, no markAccountError)', async () => {
    dbqo.mockResolvedValue(postRow());
    loadAccts.mockResolvedValue([acct('a1', 'discord')]);
    getPub.mockReturnValue({
      publish: jest.fn().mockRejectedValue(new MissingAppCredsError('no creds')),
    });
    const { step } = makeStep();
    const out = await run(step);
    expect(out.ok).toBe(false);
    expect(out.failed).toBe(1); // skipped counts as not-succeeded
    expect(markErr).not.toHaveBeenCalled();
  });

  it('throws when the post is not found', async () => {
    dbqo.mockResolvedValue(null);
    const { step } = makeStep();
    await expect(run(step)).rejects.toThrow(/post_not_found/);
  });
});
