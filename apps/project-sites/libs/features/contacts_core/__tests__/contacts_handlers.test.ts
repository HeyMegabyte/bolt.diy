/**
 * Route-LAYER tests for contacts_core handlers (via Hono app.request + the
 * shared route harness). Exercises the full path: injected auth context →
 * requireOrgFlag → isFlagOn (mock KV) → handler → service → mock D1.
 *
 * Covers: 401 unauthenticated, 404 flag-off, 200 list (flag-on), 201 create.
 */

import { contactsCore } from '../handlers.js';
import { authApp, harnessEnv } from '../../../../src/__tests__/helpers/route_harness.js';

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

/** Minimal contacts-aware D1 double (also returns [] for the flag-override query). */
function contactsDb() {
  const rows: Row[] = [];
  const ts = '2026-05-29T00:00:00Z';
  function prepare(sql: string) {
    let b: unknown[] = [];
    const api = {
      bind: (...p: unknown[]) => {
        b = p;
        return api;
      },
      // feature-flag override lookup uses .first(); no override → registry default.
      first: async () => null,
      run: async () => {
        if (sql.includes('INSERT INTO contacts')) {
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
          });
        }
        return { meta: { changes: 1 } };
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        if (sql.includes('COUNT(*)')) return { results: [{ n: rows.length }] as unknown as T[] };
        if (sql.includes('SELECT id FROM contacts')) {
          const email = (b[1] as string)?.toLowerCase?.();
          const hit = rows.find((r) => r.email?.toLowerCase() === email);
          return { results: (hit ? [{ id: hit.id }] : []) as unknown as T[] };
        }
        if (sql.includes('SELECT * FROM contacts WHERE id')) {
          const hit = rows.find((r) => r.id === (b[0] as string));
          return { results: (hit ? [hit] : []) as unknown as T[] };
        }
        if (sql.includes('FROM contacts')) return { results: rows as unknown as T[] };
        return { results: [] }; // flag-override query + anything else
      },
    };
    return api;
  }
  return { prepare } as unknown as D1Database;
}

describe('contacts_core handlers (route layer)', () => {
  it('401 when unauthenticated', async () => {
    const app = authApp(contactsCore); // no ids injected
    const res = await app.request('/api/contacts', {}, harnessEnv(contactsDb(), true));
    expect(res.status).toBe(401);
  });

  it('404 when the flag is off', async () => {
    const app = authApp(contactsCore, { userId: 'u', orgId: 'org1' });
    const res = await app.request('/api/contacts', {}, harnessEnv(contactsDb(), false));
    expect(res.status).toBe(404);
  });

  it('200 lists contacts when authed + flag on', async () => {
    const app = authApp(contactsCore, { userId: 'u', orgId: 'org1' });
    const res = await app.request('/api/contacts', {}, harnessEnv(contactsDb(), true));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contacts: unknown[]; total: number };
    expect(Array.isArray(body.contacts)).toBe(true);
    expect(body.total).toBe(0);
  });

  it('201 creates a contact and ignores a body-supplied org', async () => {
    const app = authApp(contactsCore, { userId: 'u', orgId: 'org1' });
    const res = await app.request(
      '/api/contacts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ada@x.com', orgId: 'EVIL', source: 'manual' }),
      },
      harnessEnv(contactsDb(), true),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { contact: { email: string; orgId: string } };
    expect(body.contact.email).toBe('ada@x.com');
    expect(body.contact.orgId).toBe('org1'); // auth-context org, NOT the body's 'EVIL'
  });
});
