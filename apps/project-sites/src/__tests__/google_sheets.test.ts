/**
 * Tests for src/services/google_sheets.ts — Google Sheets API v4 client used
 * to read public/API-key-accessible spreadsheets as a dynamic data source.
 *
 * Covers: values.get URL/range/A1-notation build, key handling (present,
 * missing/empty fallback), header-keyed row mapping, fewer-than-2-rows empty,
 * ragged-row coercion, metadata (spreadsheets.get) tab mapping, non-200
 * throw on both endpoints, network-throw propagation, and empty/edge data.
 *
 * Convergence r19 — additive only. Mocks the Sheets API via global.fetch.
 */

import { fetchSheetData, fetchSheetMeta } from '../services/google_sheets';

const originalFetch = global.fetch;
const mockFetch = jest.fn();

/** Build a Fetch-like Response stub. */
function res(body: unknown, ok = true, status = 200, statusText = 'OK'): Response {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
  } as unknown as Response;
}

const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchSheetData — request build (URL, range, key, A1 notation)', () => {
  it('hits the spreadsheets.values endpoint with the default A:ZZ range when no tab is given', async () => {
    mockFetch.mockResolvedValueOnce(res({ values: [['H'], ['v']] }));

    await fetchSheetData(SHEET_ID, undefined, 'KEY-XYZ');

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/`);
    expect(url).toContain(encodeURIComponent('A:ZZ'));
    expect(url).toContain('key=KEY-XYZ');
    expect(url).toContain('valueRenderOption=FORMATTED_VALUE');
  });

  it('builds a quoted, URL-encoded A1 range when a tab name is supplied', async () => {
    mockFetch.mockResolvedValueOnce(res({ values: [['H'], ['v']] }));

    await fetchSheetData(SHEET_ID, 'Menu Items', 'KEY');

    const url = mockFetch.mock.calls[0][0] as string;
    // range = `'Menu Items'!A:ZZ`, fully percent-encoded into the path.
    expect(url).toContain(encodeURIComponent("'Menu Items'!A:ZZ"));
    // Raw (unencoded) range must NOT appear verbatim.
    expect(url).not.toContain("'Menu Items'!A:ZZ");
  });

  it('falls back to an empty key string when apiKey is undefined', async () => {
    mockFetch.mockResolvedValueOnce(res({ values: [['H'], ['v']] }));

    await fetchSheetData(SHEET_ID);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('key=&');
  });

  it('falls back to an empty key string when apiKey is an empty string', async () => {
    mockFetch.mockResolvedValueOnce(res({ values: [['H'], ['v']] }));

    await fetchSheetData(SHEET_ID, 'Tab', '');

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('key=&');
  });
});

describe('fetchSheetData — success parse + header-keyed row mapping', () => {
  it('maps the first row as headers and subsequent rows as keyed records', async () => {
    mockFetch.mockResolvedValueOnce(
      res({
        values: [
          ['Name', 'Price', 'Category'],
          ['Margherita', '$12', 'Pizza'],
          ['Caesar', '$9', 'Salad'],
        ],
      }),
    );

    const rows = await fetchSheetData(SHEET_ID, 'Menu', 'KEY');

    expect(rows).toEqual([
      { Name: 'Margherita', Price: '$12', Category: 'Pizza' },
      { Name: 'Caesar', Price: '$9', Category: 'Salad' },
    ]);
  });

  it('coerces missing trailing cells in ragged rows to empty strings', async () => {
    mockFetch.mockResolvedValueOnce(
      res({
        values: [
          ['Name', 'Price', 'Category'],
          // row shorter than the header → Category should be ''
          ['Soup', '$5'],
        ],
      }),
    );

    const rows = await fetchSheetData(SHEET_ID, undefined, 'KEY');
    expect(rows).toEqual([{ Name: 'Soup', Price: '$5', Category: '' }]);
  });

  it('coerces a falsy/empty cell value to an empty string', async () => {
    mockFetch.mockResolvedValueOnce(
      res({
        values: [
          ['A', 'B'],
          ['x', ''],
        ],
      }),
    );

    const rows = await fetchSheetData(SHEET_ID, undefined, 'KEY');
    expect(rows).toEqual([{ A: 'x', B: '' }]);
  });

  it('handles duplicate header names by keeping the last column value', async () => {
    mockFetch.mockResolvedValueOnce(
      res({
        values: [
          ['Tag', 'Tag'],
          ['first', 'second'],
        ],
      }),
    );

    const rows = await fetchSheetData(SHEET_ID, undefined, 'KEY');
    // Same key written twice → last value wins.
    expect(rows).toEqual([{ Tag: 'second' }]);
  });
});

describe('fetchSheetData — empty + edge data', () => {
  it('returns [] when the response has no values field at all', async () => {
    mockFetch.mockResolvedValueOnce(res({}));
    await expect(fetchSheetData(SHEET_ID, undefined, 'KEY')).resolves.toEqual([]);
  });

  it('returns [] when values is an empty array', async () => {
    mockFetch.mockResolvedValueOnce(res({ values: [] }));
    await expect(fetchSheetData(SHEET_ID, undefined, 'KEY')).resolves.toEqual([]);
  });

  it('returns [] when only a header row is present (fewer than 2 rows)', async () => {
    mockFetch.mockResolvedValueOnce(res({ values: [['Only', 'Headers']] }));
    await expect(fetchSheetData(SHEET_ID, undefined, 'KEY')).resolves.toEqual([]);
  });
});

describe('fetchSheetData — error + resilience branches', () => {
  it('throws a descriptive error when the Sheets API returns a non-200', async () => {
    mockFetch.mockResolvedValueOnce(res({}, false, 403, 'Forbidden'));
    await expect(fetchSheetData(SHEET_ID, undefined, 'BAD-KEY')).rejects.toThrow(
      'Sheets API error: 403 Forbidden',
    );
  });

  it('throws on a 404 with the status text echoed', async () => {
    mockFetch.mockResolvedValueOnce(res({}, false, 404, 'Not Found'));
    await expect(fetchSheetData(SHEET_ID, 'Ghost', 'KEY')).rejects.toThrow(
      'Sheets API error: 404 Not Found',
    );
  });

  it('propagates a network error when fetch rejects', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(fetchSheetData(SHEET_ID, undefined, 'KEY')).rejects.toThrow('ECONNRESET');
  });

  it('propagates a JSON parse error when json() rejects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    } as unknown as Response);
    await expect(fetchSheetData(SHEET_ID, undefined, 'KEY')).rejects.toThrow(
      'Unexpected token < in JSON',
    );
  });
});

describe('fetchSheetMeta — request build', () => {
  it('hits the spreadsheets.get metadata endpoint with the fields mask and key', async () => {
    mockFetch.mockResolvedValueOnce(res({ sheets: [] }));

    await fetchSheetMeta(SHEET_ID, 'META-KEY');

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=META-KEY&fields=sheets.properties`,
    );
  });

  it('falls back to an empty key string when apiKey is undefined', async () => {
    mockFetch.mockResolvedValueOnce(res({ sheets: [] }));

    await fetchSheetMeta(SHEET_ID);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('?key=&fields=sheets.properties');
  });
});

describe('fetchSheetMeta — success parse + mapping', () => {
  it('maps each sheet tab to { name, rows, columns }', async () => {
    mockFetch.mockResolvedValueOnce(
      res({
        sheets: [
          { properties: { title: 'Menu Items', gridProperties: { rowCount: 50, columnCount: 6 } } },
          { properties: { title: 'Team', gridProperties: { rowCount: 12, columnCount: 4 } } },
        ],
      }),
    );

    const meta = await fetchSheetMeta(SHEET_ID, 'KEY');
    expect(meta).toEqual([
      { name: 'Menu Items', rows: 50, columns: 6 },
      { name: 'Team', rows: 12, columns: 4 },
    ]);
  });

  it('returns [] when the sheets array is absent', async () => {
    mockFetch.mockResolvedValueOnce(res({}));
    await expect(fetchSheetMeta(SHEET_ID, 'KEY')).resolves.toEqual([]);
  });

  it('returns [] when the sheets array is empty', async () => {
    mockFetch.mockResolvedValueOnce(res({ sheets: [] }));
    await expect(fetchSheetMeta(SHEET_ID, 'KEY')).resolves.toEqual([]);
  });
});

describe('fetchSheetMeta — error + resilience branches', () => {
  it('throws a descriptive error when metadata fetch returns a non-200', async () => {
    mockFetch.mockResolvedValueOnce(res({}, false, 500, 'Internal Server Error'));
    await expect(fetchSheetMeta(SHEET_ID, 'KEY')).rejects.toThrow(
      'Sheets API error: 500 Internal Server Error',
    );
  });

  it('propagates a network error when fetch rejects', async () => {
    mockFetch.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(fetchSheetMeta(SHEET_ID, 'KEY')).rejects.toThrow('socket hang up');
  });
});
