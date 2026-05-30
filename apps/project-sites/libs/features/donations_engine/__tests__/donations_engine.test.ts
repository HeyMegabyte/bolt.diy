/**
 * Unit tests for the Donations Engine.
 * Covers: campaign creation, donation recording (totals bump), real donor
 * capture into contacts_core (via a contacts-aware in-memory D1 — no module
 * mock, so the real recordContact path is exercised), anonymous donations
 * (no donor row, no contact), accumulation, and campaign-not-found.
 */

import { createCampaign, recordDonation, getCampaign } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

interface Campaign {
  id: string;
  site_id: string;
  name: string;
  goal_cents: number | null;
  raised_cents: number;
  donor_count: number;
  ends_at: string | null;
  created_at: string;
}
interface ContactRow {
  id: string;
  org_id: string;
  site_id: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  source: string;
  tags: string;
  metadata: string;
  consent_email: number;
  consent_sms: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

/** In-memory D1 covering donation_campaigns, donations, and contacts. */
function makeEnv(): { env: Env; donations: unknown[]; contacts: ContactRow[] } {
  const campaigns = new Map<string, Campaign>();
  const donations: unknown[] = [];
  const contacts: ContactRow[] = [];
  const ts = '2026-05-29T00:00:00Z';

  function prepare(sql: string) {
    let b: unknown[] = [];
    const api = {
      bind: (...p: unknown[]) => {
        b = p;
        return api;
      },
      run: async () => {
        if (sql.includes('INSERT INTO donation_campaigns')) {
          const [id, site_id, name, goal_cents, ends_at] = b as [
            string,
            string,
            string,
            number | null,
            string | null,
          ];
          campaigns.set(id, {
            id,
            site_id,
            name,
            goal_cents,
            raised_cents: 0,
            donor_count: 0,
            ends_at,
            created_at: ts,
          });
        } else if (sql.includes('INSERT INTO donations')) {
          donations.push(b);
        } else if (sql.includes('UPDATE donation_campaigns')) {
          const [amount, id] = b as [number, string];
          const c = campaigns.get(id);
          if (c) {
            c.raised_cents += amount;
            c.donor_count += 1;
          }
        } else if (sql.includes('INSERT INTO contacts')) {
          const [id, org_id, site_id, email, phone, name, source, tags, metadata, ce, cs] = b as [
            string,
            string,
            string | null,
            string | null,
            string | null,
            string | null,
            string,
            string,
            string,
            number,
            number,
          ];
          contacts.push({
            id,
            org_id,
            site_id,
            email,
            phone,
            name,
            source,
            tags,
            metadata,
            consent_email: ce,
            consent_sms: cs,
            first_seen_at: ts,
            last_seen_at: ts,
            created_at: ts,
            updated_at: ts,
          });
        }
        return { meta: { changes: 1 } };
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        if (sql.includes('SELECT s.org_id')) {
          const id = b[0] as string;
          return { results: (campaigns.has(id) ? [{ org_id: 'org1' }] : []) as unknown as T[] };
        }
        if (sql.includes('SELECT * FROM donation_campaigns WHERE id')) {
          const c = campaigns.get(b[0] as string);
          return { results: (c ? [c] : []) as unknown as T[] };
        }
        if (sql.includes('SELECT c.* FROM donation_campaigns')) {
          return { results: [...campaigns.values()] as unknown as T[] };
        }
        // contacts_core findExistingId (by email)
        if (sql.includes('SELECT id FROM contacts')) {
          const [, email] = b as [string, string];
          const hit = contacts.find((x) => x.email?.toLowerCase() === String(email).toLowerCase());
          return { results: (hit ? [{ id: hit.id }] : []) as unknown as T[] };
        }
        // contacts_core post-insert read
        if (sql.includes('SELECT * FROM contacts WHERE id')) {
          const hit = contacts.find((x) => x.id === (b[0] as string));
          return { results: (hit ? [hit] : []) as unknown as T[] };
        }
        return { results: [] };
      },
    };
    return api;
  }
  return {
    env: { DB: { prepare } as unknown as D1Database } as unknown as Env,
    donations,
    contacts,
  };
}

describe('donations_engine service', () => {
  it('creates a campaign with zeroed totals', async () => {
    const { env } = makeEnv();
    const c = await createCampaign(env, { siteId: 'site1', name: 'Build Fund', goalCents: 100000 });
    expect(c).toMatchObject({
      siteId: 'site1',
      name: 'Build Fund',
      goalCents: 100000,
      raisedCents: 0,
      donorCount: 0,
    });
  });

  it('records a donation, bumps totals, and captures the donor as a contact', async () => {
    const { env, donations, contacts } = makeEnv();
    const c = await createCampaign(env, { siteId: 'site1', name: 'Fund' });
    const r = await recordDonation(env, {
      campaignId: c.id,
      amountCents: 5000,
      donorEmail: 'gift@x.com',
      donorName: 'Pat',
    });
    expect(r).toMatchObject({ amountCents: 5000, raisedCents: 5000, donorCount: 1 });
    expect(donations).toHaveLength(1);
    // real contacts_core capture happened
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ email: 'gift@x.com', org_id: 'org1', source: 'donation' });
  });

  it('accumulates across multiple donations', async () => {
    const { env } = makeEnv();
    const c = await createCampaign(env, { siteId: 'site1', name: 'Fund' });
    await recordDonation(env, { campaignId: c.id, amountCents: 2500, donorEmail: 'a@x.com' });
    const r2 = await recordDonation(env, {
      campaignId: c.id,
      amountCents: 7500,
      donorEmail: 'b@x.com',
    });
    expect(r2.raisedCents).toBe(10000);
    expect(r2.donorCount).toBe(2);
    expect((await getCampaign(env, c.id))!.raisedCents).toBe(10000);
  });

  it('does NOT capture a contact for an anonymous donation', async () => {
    const { env, contacts } = makeEnv();
    const c = await createCampaign(env, { siteId: 'site1', name: 'Fund' });
    const r = await recordDonation(env, {
      campaignId: c.id,
      amountCents: 9900,
      anonymous: true,
      donorEmail: 'hide@x.com',
    });
    expect(r.raisedCents).toBe(9900);
    expect(contacts).toHaveLength(0);
  });

  it('throws when the campaign does not exist', async () => {
    const { env } = makeEnv();
    await expect(recordDonation(env, { campaignId: 'ghost', amountCents: 100 })).rejects.toThrow(
      /not found/i,
    );
  });
});
