/**
 * @module services/email_deliverability
 * @description Core logic for the Email Deliverability Wizard (build-first
 * module #12). Stateless — checks a sending domain's SPF, DMARC and DKIM DNS
 * records via DNS-over-HTTPS (Cloudflare 1.1.1.1) and returns a 0-100
 * deliverability score plus concrete fixes. No DB table / migration.
 *
 * `fetch` is injected so the parsing + scoring are unit-testable without real
 * network calls.
 *
 * @packageDocumentation
 */

/** Common DKIM selectors to probe (DKIM is selector-specific; can't enumerate). */
export const COMMON_DKIM_SELECTORS = ['google', 'default', 'k1', 's1', 'selector1', 'mail'] as const;

export interface DeliverabilityReport {
  domain: string;
  spf: { present: boolean; record: string | null };
  dmarc: { present: boolean; record: string | null; policy: string | null };
  dkim: { present: boolean; selectorsChecked: string[]; foundSelectors: string[] };
  /** 0-100: SPF 35 + DMARC 35 + DMARC-policy 10 + DKIM 20. */
  score: number;
  recommendations: string[];
}

type Fetcher = typeof fetch;

/** Normalize user input to a bare hostname (strip scheme, path, leading `www.`). */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
}

/** Fetch TXT records for `name` via DNS-over-HTTPS JSON. `[]` on any error. */
async function txtRecords(fetchFn: Fetcher, name: string): Promise<string[]> {
  try {
    const res = await fetchFn(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
      { headers: { accept: 'application/dns-json' } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { Answer?: Array<{ data?: string }> };
    // DoH returns TXT data quoted + chunked: `"v=spf1 ..." "more"`. Unwrap.
    return (json.Answer ?? []).map((a) =>
      (a.data ?? '').replace(/"\s+"/g, '').replace(/^"|"$/g, ''),
    );
  } catch {
    return [];
  }
}

/**
 * Run the SPF/DMARC/DKIM checks for a domain and compute the score + fixes.
 *
 * @param fetchFn - a `fetch` implementation (inject the global `fetch`; tests pass a mock).
 * @param domain - the sending domain (any form — normalized internally).
 *
 * @example
 * ```ts
 * const report = await checkDeliverability(fetch, 'example.com');
 * if (report.score < 70) sendFixes(report.recommendations);
 * ```
 */
export async function checkDeliverability(fetchFn: Fetcher, domain: string): Promise<DeliverabilityReport> {
  const clean = normalizeDomain(domain);

  const results = await Promise.all([
    txtRecords(fetchFn, clean),
    txtRecords(fetchFn, `_dmarc.${clean}`),
    ...COMMON_DKIM_SELECTORS.map((s) => txtRecords(fetchFn, `${s}._domainkey.${clean}`)),
  ]);
  const rootTxt = results[0];
  const dmarcTxt = results[1];
  const dkimTxt = results.slice(2);

  const spfRecord = rootTxt.find((r) => r.toLowerCase().startsWith('v=spf1')) ?? null;
  const dmarcRecord = dmarcTxt.find((r) => r.toLowerCase().startsWith('v=dmarc1')) ?? null;
  const dmarcPolicy = dmarcRecord ? (dmarcRecord.match(/\bp=([a-z]+)/i)?.[1]?.toLowerCase() ?? null) : null;
  const foundSelectors = COMMON_DKIM_SELECTORS.filter((_, i) =>
    (dkimTxt[i] ?? []).some((r) => {
      const v = r.toLowerCase();
      return v.includes('v=dkim1') || v.includes('k=rsa') || v.includes('p=');
    }),
  );
  const dkimPresent = foundSelectors.length > 0;

  const recommendations: string[] = [];
  let score = 0;
  if (spfRecord) score += 35;
  else recommendations.push('Add an SPF TXT record (start with "v=spf1") authorizing your mail senders.');
  if (dmarcRecord) score += 35;
  else recommendations.push('Add a DMARC TXT record at _dmarc.' + clean + ' — start with "v=DMARC1; p=none" to monitor.');
  if (dmarcPolicy === 'reject' || dmarcPolicy === 'quarantine') score += 10;
  else if (dmarcRecord) recommendations.push('Strengthen DMARC to p=quarantine or p=reject once monitoring reports look clean.');
  if (dkimPresent) score += 20;
  else
    recommendations.push(
      'Publish a DKIM key. Checked common selectors (' +
        COMMON_DKIM_SELECTORS.join(', ') +
        ') — none found; add yours and re-check with its selector.',
    );

  return {
    domain: clean,
    spf: { present: !!spfRecord, record: spfRecord },
    dmarc: { present: !!dmarcRecord, record: dmarcRecord, policy: dmarcPolicy },
    dkim: { present: dkimPresent, selectorsChecked: [...COMMON_DKIM_SELECTORS], foundSelectors },
    score,
    recommendations,
  };
}
