import type { LogEntry } from '../debug_log';
import {
  EXPORT_FORMATS,
  exportLogs,
  formatLogAsCsv,
  formatLogAsJson,
  formatLogAsNdjson,
} from '../log_export';

const makeEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  context: {},
  level: 'info',
  message: 'test',
  timestamp: '2026-06-01T12:00:00Z',
  traceId: 'trace-1',
  ...overrides,
});

// ---------------------------------------------------------------------------
// EXPORT_FORMATS
// ---------------------------------------------------------------------------

describe('EXPORT_FORMATS', () => {
  it('contains csv, json, and ndjson', () => {
    expect(EXPORT_FORMATS).toEqual(['csv', 'json', 'ndjson']);
  });

  it('is a frozen tuple', () => {
    // as const makes the type readonly but Object.freeze is runtime
    expect(Object.isFrozen(EXPORT_FORMATS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatLogAsCsv
// ---------------------------------------------------------------------------

describe('formatLogAsCsv', () => {
  it('formats a basic entry as a single CSV row', () => {
    const row = formatLogAsCsv(makeEntry());
    expect(row).toBe('"info","test","{}","2026-06-01T12:00:00Z","trace-1"');
  });

  it('escapes double quotes in the message', () => {
    const row = formatLogAsCsv(makeEntry({ message: 'say "hello"' }));
    expect(row).toContain('"say ""hello"""');
  });

  it('escapes double quotes in context JSON so CSV is still 5 columns', () => {
    const row = formatLogAsCsv(makeEntry({ context: { note: 'said "hi"' } }));
    // Even with nested JSON quotes, the CSV must produce exactly 5 columns
    // where each column is balanced (matching open/close quotes).
    const columns = row.match(/"(?:[^"]|"")*"/g);
    expect(columns).toBeDefined();
    expect(columns).toHaveLength(5);
    // First column is the level, second is message, third is context
    expect(columns![0]).toBe('"info"');
    expect(columns![1]).toBe('"test"');
  });

  it('handles an empty message', () => {
    const row = formatLogAsCsv(makeEntry({ message: '' }));
    expect(row).toMatch(/^"[^"]*",/); // first field quoted
  });

  it('handles an empty traceId', () => {
    const row = formatLogAsCsv(makeEntry({ traceId: '' }));
    expect(row.endsWith('""')).toBe(true);
  });

  it('outputs five quoted columns', () => {
    const row = formatLogAsCsv(makeEntry());
    const columns = row.match(/("(?:[^"]|"")*")/g);
    expect(columns).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// formatLogAsJson
// ---------------------------------------------------------------------------

describe('formatLogAsJson', () => {
  it('formats a single entry as a JSON array', () => {
    const entry = makeEntry();
    const json = formatLogAsJson([entry]);
    expect(json).toContain('"level": "info"');
    expect(json).toContain('"message": "test"');
    expect(json).toContain('"traceId": "trace-1"');
    expect(json.startsWith('[')).toBe(true);
    expect(json.endsWith(']')).toBe(true);
  });

  it('formats multiple entries', () => {
    const json = formatLogAsJson([makeEntry({ level: 'info' }), makeEntry({ level: 'warn' })]);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].level).toBe('info');
    expect(parsed[1].level).toBe('warn');
  });

  it('returns "[]" for an empty array', () => {
    expect(formatLogAsJson([])).toBe('[]');
  });

  it('produces valid JSON', () => {
    const entries = [
      makeEntry({ level: 'error', message: 'boom' }),
      makeEntry({ level: 'fatal', message: 'kaboom', traceId: 'x' }),
    ];
    expect(() => JSON.parse(formatLogAsJson(entries))).not.toThrow();
  });

  it('pretty-prints with 2-space indent', () => {
    const json = formatLogAsJson([makeEntry()]);
    expect(json).toContain('\n  ');
  });
});

// ---------------------------------------------------------------------------
// formatLogAsNdjson
// ---------------------------------------------------------------------------

describe('formatLogAsNdjson', () => {
  it('formats a single entry as one compact JSON line', () => {
    const nd = formatLogAsNdjson([makeEntry()]);
    const parsed = JSON.parse(nd);
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('test');
    expect(parsed.traceId).toBe('trace-1');
  });

  it('joins multiple entries with newlines', () => {
    const nd = formatLogAsNdjson([makeEntry({ level: 'info' }), makeEntry({ level: 'warn' })]);
    const lines = nd.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).level).toBe('info');
    expect(JSON.parse(lines[1]).level).toBe('warn');
  });

  it('returns an empty string for an empty array', () => {
    expect(formatLogAsNdjson([])).toBe('');
  });

  it('does not end with a trailing newline', () => {
    const nd = formatLogAsNdjson([makeEntry(), makeEntry()]);
    expect(nd.endsWith('\n')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// exportLogs
// ---------------------------------------------------------------------------

describe('exportLogs', () => {
  const entries: LogEntry[] = [
    makeEntry({ level: 'info', message: 'first' }),
    makeEntry({ level: 'warn', message: 'second', traceId: 'trace-2' }),
  ];

  it('exports as CSV when format is csv', () => {
    const result = exportLogs(entries, 'csv');
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"info"');
    expect(lines[1]).toContain('"warn"');
  });

  it('exports as JSON when format is json', () => {
    const result = exportLogs(entries, 'json');
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].message).toBe('first');
  });

  it('exports as NDJSON when format is ndjson', () => {
    const result = exportLogs(entries, 'ndjson');
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).message).toBe('first');
    expect(JSON.parse(lines[1]).message).toBe('second');
  });

  it('returns an empty string for csv with no entries', () => {
    expect(exportLogs([], 'csv')).toBe('');
  });

  it('returns "[]" for json with no entries', () => {
    expect(exportLogs([], 'json')).toBe('[]');
  });

  it('returns an empty string for ndjson with no entries', () => {
    expect(exportLogs([], 'ndjson')).toBe('');
  });

  it('does not mutate the input array', () => {
    const copy = [...entries];
    exportLogs(entries, 'json');
    expect(entries).toEqual(copy);
  });
});
