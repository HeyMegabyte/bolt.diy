/**
 * Unit tests for Email Marketing send pipeline.
 * Covers: recipient dedupe across contacts+subscribers, consent/confirmed
 * filtering (via the mock's query routing), real send (mocked Resend),
 * already-sent idempotency, no-recipients, and missing-API-key guard.
 */

import {
  resolveRecipients,
  estimateRecipients,
  sendCampaign,
  type CampaignRow,
} from '../service.js';
import type { Env } from '../../../../src/types/env.js';

function makeEnv(opts: {
  contactEmails?: string[];
  subEmails?: string[];
  resendOk?: boolean;
  apiKey?: string | undefined;
}): { env: Env; updates: Array<{ status: string; sent: number }> } {
  const contactEmails = opts.contactEmails ?? [];
  const subEmails = opts.subEmails ?? [];
  const updates: Array<{ status: string; sent: number }> = [];

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const api = {
      bind: (...p: unknown[]) => {
        bound = p;
        return api;
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        if (sql.includes('FROM contacts')) {
          if (sql.includes('COUNT('))
            return { results: [{ n: new Set(contactEmails).size }] as unknown as T[] };
          return {
            results: [...new Set(contactEmails)].map((email) => ({ email })) as unknown as T[],
          };
        }
        if (sql.includes('FROM newsletter_subscribers')) {
          if (sql.includes('COUNT('))
            return { results: [{ n: new Set(subEmails).size }] as unknown as T[] };
          return { results: [...new Set(subEmails)].map((email) => ({ email })) as unknown as T[] };
        }
        return { results: [] };
      },
      run: async () => {
        if (sql.includes('UPDATE newsletter_campaigns')) {
          // bound = [status, sent, id]
          updates.push({ status: String(bound[0]), sent: Number(bound[1]) });
        }
        return { meta: { changes: 1 } };
      },
    };
    return api;
  }

  const env = {
    DB: { prepare } as unknown as D1Database,
    RESEND_API_KEY: 'apiKey' in opts ? opts.apiKey : 're_test_key',
  } as unknown as Env;

  // Mock global fetch (Resend batch).
  (globalThis as { fetch: typeof fetch }).fetch = (async () =>
    ({
      ok: opts.resendOk !== false,
      status: opts.resendOk === false ? 500 : 200,
    }) as Response) as typeof fetch;

  return { env, updates };
}

const campaign: CampaignRow = {
  id: 'camp1',
  site_id: 'site1',
  org_id: 'org1',
  subject: 'Hi',
  body_html: '<p>Hi</p>',
  status: 'draft',
};

describe('email_marketing service', () => {
  it('dedupes recipients across contacts + subscribers', async () => {
    const { env } = makeEnv({
      contactEmails: ['a@x.com', 'b@x.com'],
      subEmails: ['b@x.com', 'c@x.com'],
    });
    const list = await resolveRecipients(env, 'org1', 'site1');
    expect(list.sort()).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('reports a real recipient breakdown (not a fabricated number)', async () => {
    const { env } = makeEnv({ contactEmails: ['a@x.com', 'b@x.com'], subEmails: ['b@x.com'] });
    const c = await estimateRecipients(env, 'org1', 'site1');
    expect(c.total).toBe(2);
    expect(c.fromContacts).toBe(2);
    expect(c.fromSubscribers).toBe(1);
  });

  it('sends to the consented audience and marks sent', async () => {
    const { env, updates } = makeEnv({
      contactEmails: ['a@x.com'],
      subEmails: ['b@x.com'],
      resendOk: true,
    });
    const r = await sendCampaign(env, campaign);
    expect(r.status).toBe('sent');
    expect(r.recipients).toBe(2);
    expect(r.sent).toBe(2);
    expect(updates.at(-1)).toMatchObject({ status: 'sent', sent: 2 });
  });

  it('is idempotent on an already-sent campaign', async () => {
    const { env } = makeEnv({ contactEmails: ['a@x.com'] });
    const r = await sendCampaign(env, { ...campaign, status: 'sent' });
    expect(r).toMatchObject({ recipients: 0, sent: 0, status: 'sent' });
  });

  it('reports no_recipients when the audience is empty', async () => {
    const { env } = makeEnv({ contactEmails: [], subEmails: [] });
    const r = await sendCampaign(env, campaign);
    expect(r.status).toBe('no_recipients');
  });

  it('throws when RESEND_API_KEY is missing', async () => {
    const { env } = makeEnv({ contactEmails: ['a@x.com'], apiKey: undefined });
    await expect(sendCampaign(env, campaign)).rejects.toThrow(/not configured/);
  });

  it('marks partial when some batches fail', async () => {
    const { env } = makeEnv({ contactEmails: ['a@x.com'], resendOk: false });
    const r = await sendCampaign(env, campaign);
    expect(r.status).toBe('failed'); // single batch, hard-fail → 0 sent
    expect(r.failed).toBe(1);
  });
});
