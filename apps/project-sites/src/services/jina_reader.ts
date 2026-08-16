/**
 * Jina Reader — clean Markdown extraction of a source URL for the clone/scrape
 * pipeline + RAG ingest.
 *
 * `r.jina.ai/<url>` returns a single LLM-ready Markdown rendering of a page
 * (boilerplate stripped, main content only) — far cleaner than raw HTML for
 * feeding the site-generation research step or embedding into Vectorize. No API
 * key required for the public reader endpoint.
 *
 * Ledger: 50-improvement-audit follow-on — "30 advanced tools" #12.
 *
 * @example
 * const md = await fetchReaderMarkdown('https://vitos-mens-salon.com');
 * // → '# Vito's Mens Salon\n\nFamily-owned barbershop in Lake Hiawatha…'
 */

/** A minimal `fetch` shape so callers/tests can inject a stub. */
export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Realistic desktop UA — bare tool UAs get WAF-blocked (`fetch-defaults`). */
const READER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

/** Thrown when the target URL is not a well-formed absolute http(s) URL. */
export class JinaReaderUrlError extends Error {
  constructor(
    message: string,
    public readonly url: unknown,
  ) {
    super(message);
    this.name = 'JinaReaderUrlError';
  }
}

/** Thrown when the reader endpoint returns a non-2xx response. */
export class JinaReaderFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'JinaReaderFetchError';
  }
}

/**
 * Validate + normalize a target URL into its `r.jina.ai` reader form.
 *
 * @param target - Absolute http(s) URL of the page to extract.
 * @returns The `https://r.jina.ai/<target>` reader URL.
 * @throws {JinaReaderUrlError} When `target` is not an absolute http(s) URL.
 * @example
 * readerUrl('https://example.com/about')
 * // → 'https://r.jina.ai/https://example.com/about'
 */
export function readerUrl(target: string): string {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new JinaReaderUrlError('Target URL must be a non-empty string', target);
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new JinaReaderUrlError('Target URL is not a valid absolute URL', target);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new JinaReaderUrlError('Target URL must be http(s)', target);
  }
  return `https://r.jina.ai/${parsed.toString()}`;
}

/**
 * Fetch a page as clean LLM-ready Markdown via the Jina Reader endpoint.
 *
 * @param target - Absolute http(s) URL to extract.
 * @param opts - Optional injected `fetch` (for tests) + abort signal.
 * @returns The page rendered as Markdown.
 * @throws {JinaReaderUrlError} When `target` is invalid.
 * @throws {JinaReaderFetchError} When the reader returns a non-2xx status.
 * @example
 * const md = await fetchReaderMarkdown('https://example.com');
 */
export async function fetchReaderMarkdown(
  target: string,
  opts: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<string> {
  const url = readerUrl(target);
  const doFetch: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const res = await doFetch(url, {
    headers: {
      Accept: 'text/markdown, text/plain, */*',
      'User-Agent': READER_UA,
      'X-Return-Format': 'markdown',
    },
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new JinaReaderFetchError(
      `Jina Reader returned HTTP ${res.status} for ${target}`,
      res.status,
    );
  }
  return res.text();
}
