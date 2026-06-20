import {
  readerUrl,
  fetchReaderMarkdown,
  JinaReaderUrlError,
  JinaReaderFetchError,
  type FetchLike,
} from '../services/jina_reader';

describe('jina_reader (tools #12)', () => {
  describe('readerUrl', () => {
    it('wraps an absolute https URL', () => {
      expect(readerUrl('https://example.com/about')).toBe(
        'https://r.jina.ai/https://example.com/about',
      );
    });

    it('accepts http too', () => {
      expect(readerUrl('http://example.com')).toBe('https://r.jina.ai/http://example.com/');
    });

    it('rejects empty / non-string', () => {
      expect(() => readerUrl('')).toThrow(JinaReaderUrlError);
      expect(() => readerUrl('   ')).toThrow(JinaReaderUrlError);
    });

    it('rejects non-absolute URLs', () => {
      expect(() => readerUrl('/relative/path')).toThrow(JinaReaderUrlError);
      expect(() => readerUrl('not a url')).toThrow(JinaReaderUrlError);
    });

    it('rejects non-http(s) schemes (SSRF-adjacent)', () => {
      expect(() => readerUrl('ftp://example.com')).toThrow(JinaReaderUrlError);
      expect(() => readerUrl('javascript:alert(1)')).toThrow(JinaReaderUrlError);
    });
  });

  describe('fetchReaderMarkdown', () => {
    it('returns the markdown body on 200', async () => {
      const calls: string[] = [];
      const fake: FetchLike = async (url) => {
        calls.push(url);
        return { ok: true, status: 200, text: async () => '# Title\n\nbody' };
      };
      const md = await fetchReaderMarkdown('https://example.com', { fetchImpl: fake });
      expect(md).toBe('# Title\n\nbody');
      expect(calls[0]).toBe('https://r.jina.ai/https://example.com/');
    });

    it('throws JinaReaderFetchError on non-2xx', async () => {
      const fake: FetchLike = async () => ({ ok: false, status: 503, text: async () => '' });
      await expect(
        fetchReaderMarkdown('https://example.com', { fetchImpl: fake }),
      ).rejects.toBeInstanceOf(JinaReaderFetchError);
    });

    it('propagates url validation before any fetch', async () => {
      let called = false;
      const fake: FetchLike = async () => {
        called = true;
        return { ok: true, status: 200, text: async () => '' };
      };
      await expect(fetchReaderMarkdown('bad', { fetchImpl: fake })).rejects.toBeInstanceOf(
        JinaReaderUrlError,
      );
      expect(called).toBe(false);
    });
  });
});
