import { buildLogEntry, logLevelToSentrySeverity, serializeLogEntry } from '../structured_logger';

const BASE = {
  msg: 'Request completed',
  traceId: 'trace-001',
  requestId: 'req-001',
  workerId: 'project-sites',
  env: 'production' as const,
  ts: 1719705600000,
};

describe('buildLogEntry', () => {
  it('builds a minimal valid log entry', () => {
    const entry = buildLogEntry({ ...BASE, level: 'info' });
    expect(entry.level).toBe('info');
    expect(entry.traceId).toBe('trace-001');
    expect(entry.workerId).toBe('project-sites');
    expect(entry.env).toBe('production');
  });

  it('accepts optional durationMs', () => {
    const entry = buildLogEntry({ ...BASE, level: 'info', durationMs: 42 });
    expect(entry.durationMs).toBe(42);
  });

  it('accepts optional error payload', () => {
    const entry = buildLogEntry({
      ...BASE,
      level: 'error',
      error: { message: 'Connection refused', code: 'ECONNREFUSED' },
    });
    expect(entry.error).toEqual({ message: 'Connection refused', code: 'ECONNREFUSED' });
  });

  it('accepts path, status, method', () => {
    const entry = buildLogEntry({
      ...BASE,
      level: 'info',
      path: '/api/health',
      status: 200,
      method: 'GET',
    });
    expect(entry.path).toBe('/api/health');
    expect(entry.status).toBe(200);
    expect(entry.method).toBe('GET');
  });

  it('accepts metadata', () => {
    const entry = buildLogEntry({
      ...BASE,
      level: 'info',
      meta: { featureSlug: 'health', cacheHit: true },
    });
    expect(entry.meta).toEqual({ featureSlug: 'health', cacheHit: true });
  });

  it('validates all log levels', () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      expect(buildLogEntry({ ...BASE, level }).level).toBe(level);
    }
  });

  it('rejects invalid log levels', () => {
    expect(() => buildLogEntry({ ...BASE, level: 'critical' as any })).toThrow();
  });

  it('rejects empty message', () => {
    expect(() => buildLogEntry({ ...BASE, level: 'info', msg: '' })).toThrow();
  });

  it('defaults ts to Date.now() when omitted', () => {
    const entry = buildLogEntry({ ...BASE, level: 'info', ts: undefined });
    expect(entry.ts).toBeGreaterThan(0);
  });
});

describe('serializeLogEntry', () => {
  it('produces valid JSON', () => {
    const entry = buildLogEntry({ ...BASE, level: 'info' });
    const json = serializeLogEntry(entry);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.level).toBe('info');
    expect(parsed.traceId).toBe('trace-001');
  });
});

describe('logLevelToSentrySeverity', () => {
  it('trace → 5', () => expect(logLevelToSentrySeverity('trace')).toBe(5));
  it('debug → 7', () => expect(logLevelToSentrySeverity('debug')).toBe(7));
  it('info → 9', () => expect(logLevelToSentrySeverity('info')).toBe(9));
  it('warn → 13', () => expect(logLevelToSentrySeverity('warn')).toBe(13));
  it('error → 17', () => expect(logLevelToSentrySeverity('error')).toBe(17));
  it('fatal → 21', () => expect(logLevelToSentrySeverity('fatal')).toBe(21));
});
