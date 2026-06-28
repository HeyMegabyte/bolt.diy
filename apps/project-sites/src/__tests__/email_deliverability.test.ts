import {
  checkDeliverability,
  hasDeliverableMx,
  normalizeDomain,
} from '../services/email_deliverability.js';

/** Build a fake `fetch` that answers MX/A DoH queries by record type + status. */
function mockDnsFetch(
  cfg: { mx?: number; a?: number; status?: number; throw?: boolean } = {},
): typeof fetch {
  return (async (url: string | URL | Request) => {
    if (cfg.throw) throw new Error('network down');
    const u = typeof url === 'string' ? url : (url as URL | Request).toString();
    const type = new URL(u).searchParams.get('type') ?? '';
    const count = type === 'MX' ? (cfg.mx ?? 0) : (cfg.a ?? 0);
    return {
      ok: true,
      json: async () => ({
        Status: cfg.status ?? 0,
        Answer: Array.from({ length: count }, (_, i) => ({ data: `rec-${i}` })),
      }),
    } as Response;
  }) as unknown as typeof fetch;
}

/** Build a fake `fetch` that returns DoH-shaped TXT answers keyed by query `name`. */
function mockFetch(
  records: Record<string, string[]>,
  opts: { throwOn?: string } = {},
): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : (url as URL | Request).toString();
    const name = new URL(u).searchParams.get('name') ?? '';
    if (opts.throwOn && name.includes(opts.throwOn)) throw new Error('network down');
    const txt = records[name] ?? [];
    return {
      ok: true,
      // Real DoH wraps TXT data in quotes — mirror it so the unwrap path is exercised.
      json: async () => ({ Answer: txt.map((t) => ({ data: `"${t}"` })) }),
    } as Response;
  }) as unknown as typeof fetch;
}

describe('email_deliverability', () => {
  describe('normalizeDomain', () => {
    it('strips scheme, path, www and lowercases', () => {
      expect(normalizeDomain('HTTPS://www.Example.com/path?q=1')).toBe('example.com');
      expect(normalizeDomain('  Sub.Example.COM  ')).toBe('sub.example.com');
    });
  });

  describe('checkDeliverability', () => {
    it('scores a fully-configured domain 100 with no recommendations', async () => {
      const f = mockFetch({
        'example.com': ['v=spf1 include:_spf.google.com ~all'],
        '_dmarc.example.com': ['v=DMARC1; p=reject; rua=mailto:dmarc@example.com'],
        'google._domainkey.example.com': ['v=DKIM1; k=rsa; p=MIGfMA0GCS'],
      });
      const r = await checkDeliverability(f, 'https://example.com/');
      expect(r.domain).toBe('example.com');
      expect(r.spf.present).toBe(true);
      expect(r.dmarc.present).toBe(true);
      expect(r.dmarc.policy).toBe('reject');
      expect(r.dkim.present).toBe(true);
      expect(r.dkim.foundSelectors).toContain('google');
      expect(r.score).toBe(100);
      expect(r.recommendations).toEqual([]);
    });

    it('scores an unconfigured domain 0 with SPF + DMARC + DKIM fixes', async () => {
      const r = await checkDeliverability(mockFetch({}), 'bare.example');
      expect(r.score).toBe(0);
      expect(r.spf.present).toBe(false);
      expect(r.dmarc.present).toBe(false);
      expect(r.dkim.present).toBe(false);
      expect(r.recommendations.length).toBe(3);
      expect(r.recommendations.some((m) => m.includes('SPF'))).toBe(true);
      expect(r.recommendations.some((m) => m.includes('DMARC'))).toBe(true);
      expect(r.recommendations.some((m) => m.includes('DKIM'))).toBe(true);
    });

    it('gives SPF its 35 points but still flags the DMARC + DKIM gaps', async () => {
      const r = await checkDeliverability(
        mockFetch({ 'spf-only.test': ['v=spf1 -all'] }),
        'spf-only.test',
      );
      expect(r.spf.present).toBe(true);
      expect(r.score).toBe(35);
      expect(r.recommendations.some((m) => m.includes('DMARC'))).toBe(true);
      expect(r.recommendations.some((m) => m.includes('DKIM'))).toBe(true);
    });

    it('does not award the policy bonus for DMARC p=none and recommends strengthening', async () => {
      const r = await checkDeliverability(
        mockFetch({
          'mon.test': ['v=spf1 ~all'],
          '_dmarc.mon.test': ['v=DMARC1; p=none; rua=mailto:r@mon.test'],
        }),
        'mon.test',
      );
      expect(r.dmarc.policy).toBe('none');
      expect(r.score).toBe(70); // 35 SPF + 35 DMARC, no policy bonus, no DKIM
      expect(r.recommendations.some((m) => m.toLowerCase().includes('strengthen'))).toBe(true);
    });

    it('degrades gracefully to score 0 when DNS lookups throw', async () => {
      const r = await checkDeliverability(mockFetch({}, { throwOn: 'fail.test' }), 'fail.test');
      expect(r.score).toBe(0);
      expect(r.spf.present).toBe(false);
      expect(r.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('hasDeliverableMx (reply-deliverability guardrail, #121)', () => {
    it('true when the domain publishes an MX record', async () => {
      expect(await hasDeliverableMx(mockDnsFetch({ mx: 2 }), 'gmail.com')).toBe(true);
    });

    it('true via the A/AAAA implicit-MX fallback when no MX but an A exists', async () => {
      expect(await hasDeliverableMx(mockDnsFetch({ mx: 0, a: 1 }), 'apex-only.test')).toBe(true);
    });

    it('false when the domain has neither MX nor A (undeliverable)', async () => {
      expect(await hasDeliverableMx(mockDnsFetch({ mx: 0, a: 0 }), 'nomail.test')).toBe(false);
    });

    it('false on NXDOMAIN (Status 3 — domain does not exist)', async () => {
      expect(await hasDeliverableMx(mockDnsFetch({ status: 3 }), 'typo-domian.test')).toBe(false);
    });

    it('false for a malformed / domainless input', async () => {
      expect(await hasDeliverableMx(mockDnsFetch({ mx: 5 }), 'notadomain')).toBe(false);
    });

    it('fails OPEN (true) on a DoH network error — never drops a legit receipt', async () => {
      expect(await hasDeliverableMx(mockDnsFetch({ throw: true }), 'gmail.com')).toBe(true);
    });
  });
});
