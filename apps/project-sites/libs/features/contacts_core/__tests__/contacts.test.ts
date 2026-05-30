/**
 * Unit tests for Contacts Core (CRM) service.
 *
 * Covers: insert-new, dedupe-by-email (merge tags + flip consent + bump last_seen),
 * org-scoped get isolation, list paging, and soft-delete. D1 is mocked in-memory
 * with a tiny interpreter understanding the SQL shapes `service.ts` issues.
 */

import { recordContact, getContact, listContacts, deleteContact } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

interface Row {
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

function makeDb(): { db: D1Database; rows: Row[] } {
  const rows: Row[] = [];
  let clock = 0;
  const now = () => `2026-05-29T00:00:${String(clock++).padStart(2, '0')}Z`;

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const api = {
      bind: (...params: unknown[]) => {
        bound = params;
        return api;
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        if (sql.includes('COUNT(*)')) {
          const orgId = bound[0] as string;
          const list = rows.filter((r) => r.org_id === orgId && !r.deleted_at_present());
          return { results: [{ n: list.length } as unknown as T] };
        }
        if (sql.includes('SELECT id FROM contacts') && sql.includes('lower(email)')) {
          const [orgId, email] = bound as [string, string];
          const hit = rows.find(
            (r) =>
              r.org_id === orgId &&
              r.email?.toLowerCase() === email.toLowerCase() &&
              !r.deleted_at_present(),
          );
          return { results: hit ? [{ id: hit.id } as unknown as T] : [] };
        }
        if (sql.includes('SELECT id FROM contacts') && sql.includes('phone = ?')) {
          const [orgId, phone] = bound as [string, string];
          const hit = rows.find(
            (r) => r.org_id === orgId && r.phone === phone && !r.deleted_at_present(),
          );
          return { results: hit ? [{ id: hit.id } as unknown as T] : [] };
        }
        if (sql.includes('WHERE id = ?')) {
          const id = bound[0] as string;
          const orgScoped = sql.includes('org_id = ?');
          const requireLive = sql.includes('deleted_at IS NULL');
          const orgId = orgScoped ? (bound[1] as string) : undefined;
          const hit = rows.find(
            (r) =>
              r.id === id &&
              (!orgScoped || r.org_id === orgId) &&
              (!requireLive || !r.deleted_at_present()),
          );
          return { results: hit ? [{ ...hit } as unknown as T] : [] };
        }
        if (sql.includes('ORDER BY last_seen_at')) {
          const orgId = bound[0] as string;
          const limit = bound[bound.length - 2] as number;
          const offset = bound[bound.length - 1] as number;
          const list = rows
            .filter((r) => r.org_id === orgId && !r.deleted_at_present())
            .sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : -1))
            .slice(offset, offset + limit);
          return { results: list.map((r) => ({ ...r }) as unknown as T) };
        }
        return { results: [] };
      },
      run: async (): Promise<{ meta: { changes: number } }> => {
        if (sql.startsWith('INSERT INTO contacts') || sql.includes('INSERT INTO contacts')) {
          const [id, org_id, site_id, email, phone, name, source, tags, metadata, ce, cs] =
            bound as [
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
          const ts = now();
          rows.push({
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
            // helper attached below
          } as unknown as Row);
          return { meta: { changes: 1 } };
        }
        if (sql.includes('SET deleted_at')) {
          const [id, orgId] = bound as [string, string];
          const r = rows.find((x) => x.id === id && x.org_id === orgId);
          if (r) (r as unknown as { deleted_at: string }).deleted_at = now();
          return { meta: { changes: r ? 1 : 0 } };
        }
        if (sql.includes('UPDATE contacts SET')) {
          // merge update: params end with id
          const id = bound[bound.length - 1] as string;
          const [site_id, email, phone, name, tags, metadata, ce, cs] = bound as [
            string | null,
            string | null,
            string | null,
            string | null,
            string,
            string,
            number,
            number,
          ];
          const r = rows.find((x) => x.id === id);
          if (r) {
            if (site_id !== null) r.site_id = site_id;
            if (email !== null) r.email = email;
            if (phone !== null) r.phone = phone;
            if (name !== null) r.name = name;
            r.tags = tags;
            r.metadata = metadata;
            if (ce === 1) r.consent_email = 1;
            if (cs === 1) r.consent_sms = 1;
            r.last_seen_at = now();
            r.updated_at = r.last_seen_at;
          }
          return { meta: { changes: r ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return api;
  }

  // attach a deleted_at_present helper onto every row via prototype-free accessor
  const proto = {
    deleted_at_present(this: Row & { deleted_at?: string }) {
      return Boolean(this.deleted_at);
    },
  };
  const origPush = rows.push.bind(rows);
  rows.push = (...items: Row[]) =>
    origPush(...items.map((it) => Object.assign(Object.create(proto), it)));

  return { db: { prepare } as unknown as D1Database, rows };
}

function makeEnv(): Env {
  const { db } = makeDb();
  return { DB: db } as unknown as Env;
}

describe('contacts_core service', () => {
  it('inserts a new contact', async () => {
    const env = makeEnv();
    const c = await recordContact(env, {
      orgId: 'org1',
      email: 'ada@example.com',
      name: 'Ada',
      source: 'inbox',
    });
    expect(c.email).toBe('ada@example.com');
    expect(c.orgId).toBe('org1');
    expect(c.source).toBe('inbox');
  });

  it('dedupes by email, merges tags and flips consent 0->1', async () => {
    const env = makeEnv();
    const first = await recordContact(env, {
      orgId: 'org1',
      email: 'ada@example.com',
      tags: ['lead'],
      source: 'inbox',
    });
    const second = await recordContact(env, {
      orgId: 'org1',
      email: 'ADA@example.com',
      tags: ['donor'],
      consentEmail: true,
      source: 'donation',
      name: 'Ada L',
    });
    expect(second.id).toBe(first.id);
    expect(second.tags.sort()).toEqual(['donor', 'lead']);
    expect(second.consentEmail).toBe(true);
    expect(second.name).toBe('Ada L');
    const { total } = await listContacts(env, 'org1', { limit: 50, offset: 0 } as never);
    expect(total).toBe(1);
  });

  it('isolates contacts by org on get', async () => {
    const env = makeEnv();
    const c = await recordContact(env, { orgId: 'org1', email: 'a@x.com', source: 'manual' });
    expect(await getContact(env, 'org1', c.id)).not.toBeNull();
    expect(await getContact(env, 'org2', c.id)).toBeNull();
  });

  it('rejects a contact with neither email nor phone', async () => {
    const env = makeEnv();
    await expect(
      recordContact(env, { orgId: 'org1', source: 'manual' } as never),
    ).rejects.toThrow();
  });

  it('soft-deletes and drops from the list', async () => {
    const env = makeEnv();
    const c = await recordContact(env, { orgId: 'org1', email: 'a@x.com', source: 'manual' });
    expect(await deleteContact(env, 'org1', c.id)).toBe(true);
    const { total } = await listContacts(env, 'org1', { limit: 50, offset: 0 } as never);
    expect(total).toBe(0);
  });
});
