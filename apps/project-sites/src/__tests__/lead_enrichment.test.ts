import { enrichLeadContact } from '../services/lead_enrichment';

/**
 * On-demand deep contact enrichment (#9). {@link enrichLeadContact} merges three
 * best-effort sources — known-homepage parse, free DuckDuckGo search, and an
 * optional paid adapter — into one ContactBundle, degrading SILENTLY (never throws)
 * when any source fails. All I/O is injected via `deps.fetchImpl`, so these tests
 * stub fetch directly (no KV/D1/network). Uses the GLOBAL `jest` per @swc/jest.
 */

/** Build a `Response`-ish stub the service reads via `.ok` + `.text()`/`.json()`. */
function htmlResponse(html: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    text: async () => html,
    json: async () => ({}),
  } as unknown as Response;
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe('enrichLeadContact — homepage parse', () => {
  it('extracts socials + email from a stubbed homepage fetch', async () => {
    const html = `
      <html><body>
        <a href="https://facebook.com/vitossalon">Facebook</a>
        <a href="mailto:hello@vitossalon.com">Email us</a>
      </body></html>`;
    // Only the known-website homepage fetch returns HTML; the DDG search returns empty.
    const fetchImpl = jest.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://vitos.com')) return htmlResponse(html);
      return htmlResponse('', true); // DDG: no results
    }) as unknown as typeof fetch;

    const contact = await enrichLeadContact(
      { businessName: "Vito's Salon", website: 'https://vitos.com' },
      { fetchImpl, paidEnabled: false },
    );

    expect(contact.website).toBe('https://vitos.com');
    expect(contact.email).toBe('hello@vitossalon.com');
    expect(contact.socials?.facebook).toBe('https://facebook.com/vitossalon');
  });

  it('harvests socials + a candidate website from a stubbed DuckDuckGo search', async () => {
    const ddg = `
      <html><body>
        <a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fvitos-salon.com%2F&rut=x">Vito's Salon</a>
        <a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Finstagram.com%2Fvitos&rut=y">Instagram</a>
      </body></html>`;
    const site = `<html><body><a href="tel:+19735551234">Call</a></body></html>`;
    const fetchImpl = jest.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('duckduckgo.com/html')) return htmlResponse(ddg);
      if (u.startsWith('https://vitos-salon.com')) return htmlResponse(site);
      return htmlResponse('', false);
    }) as unknown as typeof fetch;

    const contact = await enrichLeadContact(
      { businessName: "Vito's Salon", city: 'Lake Hiawatha' },
      { fetchImpl },
    );

    // Candidate website discovered from the (decoded) DDG result + its phone parsed.
    expect(contact.website).toBe('https://vitos-salon.com/');
    expect(contact.phone).toContain('973');
    expect(contact.socials?.instagram).toBe('https://instagram.com/vitos');
  });
});

describe('enrichLeadContact — paid adapter gating', () => {
  const paidUrl = 'https://enrich.example.com/v1/lookup';

  it('calls the paid adapter (and prioritizes it) only when enabled + key + url present', async () => {
    const fetchImpl = jest.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === paidUrl) {
        return jsonResponse({ website: 'https://paid-result.com', phone: '+18005550000' });
      }
      return htmlResponse('', true); // DDG empty
    }) as unknown as typeof fetch;

    const contact = await enrichLeadContact(
      { businessName: 'Acme Roofing', address: '1 Main St' },
      { fetchImpl, paidEnabled: true, paidApiUrl: paidUrl, paidApiKey: 'sk_test' },
    );

    // The paid URL WAS hit, with a Bearer header + POST body.
    const paidCall = fetchImpl.mock.calls.find((c: unknown[]) => c[0] === paidUrl);
    expect(paidCall).toBeDefined();
    const init = paidCall?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test');
    // Paid result wins the merge.
    expect(contact.website).toBe('https://paid-result.com');
    expect(contact.phone).toBe('+18005550000');
  });

  it('does NOT call the paid adapter when the flag is off', async () => {
    const fetchImpl = jest.fn(async () => htmlResponse('', true)) as unknown as typeof fetch;

    await enrichLeadContact(
      { businessName: 'Acme Roofing' },
      { fetchImpl, paidEnabled: false, paidApiUrl: paidUrl, paidApiKey: 'sk_test' },
    );

    const paidCall = fetchImpl.mock.calls.find((c: unknown[]) => c[0] === paidUrl);
    expect(paidCall).toBeUndefined();
  });

  it('does NOT call the paid adapter when the key is missing (even if enabled)', async () => {
    const fetchImpl = jest.fn(async () => htmlResponse('', true)) as unknown as typeof fetch;

    await enrichLeadContact(
      { businessName: 'Acme Roofing' },
      { fetchImpl, paidEnabled: true, paidApiUrl: paidUrl },
    );

    const paidCall = fetchImpl.mock.calls.find((c: unknown[]) => c[0] === paidUrl);
    expect(paidCall).toBeUndefined();
  });
});

describe('enrichLeadContact — resilience', () => {
  it('never throws and returns {} when every fetch rejects', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const contact = await enrichLeadContact(
      { businessName: 'Acme Roofing', website: 'https://acme.com' },
      { fetchImpl, paidEnabled: true, paidApiUrl: 'https://p.example.com', paidApiKey: 'k' },
    );

    expect(contact).toEqual({});
  });

  it('returns a partial bundle when the homepage succeeds but search rejects', async () => {
    const html = `<html><body><a href="https://instagram.com/acme">IG</a></body></html>`;
    const fetchImpl = jest.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://acme.com')) return htmlResponse(html);
      throw new Error('ddg blocked');
    }) as unknown as typeof fetch;

    const contact = await enrichLeadContact(
      { businessName: 'Acme Roofing', website: 'https://acme.com' },
      { fetchImpl },
    );

    expect(contact.website).toBe('https://acme.com');
    expect(contact.socials?.instagram).toBe('https://instagram.com/acme');
  });
});
