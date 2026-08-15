/**
 * Unit tests for the pure core of the editor "Logs" tab source
 * (`api.bolt-tabs.logs`): the Observability-event → LogLine mapping, the query
 * builder, the poll-window math, and level coercion. These guard the client
 * contract (`{ lines: LogLine[] }`) that the previous `{ tails }` shape broke.
 */
import { describe, expect, it } from 'vitest';
import {
  buildObservabilityQuery,
  computeWindow,
  mapEventToLogLine,
  sortLinesAscending,
  toLogLevel,
  type LogLine,
  type ObservabilityEvent,
} from './api.bolt-tabs.logs';

describe('toLogLevel', () => {
  it('passes through the four valid levels', () => {
    expect(toLogLevel('info')).toBe('info');
    expect(toLogLevel('warn')).toBe('warn');
    expect(toLogLevel('error')).toBe('error');
    expect(toLogLevel('debug')).toBe('debug');
  });

  it('defaults unknown / missing / non-string to info', () => {
    expect(toLogLevel('trace')).toBe('info');
    expect(toLogLevel(undefined)).toBe('info');
    expect(toLogLevel(42)).toBe('info');
    expect(toLogLevel(null)).toBe('info');
  });
});

describe('mapEventToLogLine', () => {
  it('summarizes an http_request event as METHOD path → status (durationMs)', () => {
    const event: ObservabilityEvent = {
      timestamp: 1,
      source: { level: 'info', method: 'GET', path: '/api/inbox/tasks', status: 200, durationMs: 227, scope: 'project-sites' },
    };
    const line = mapEventToLogLine(event, 0);
    expect(line.message).toBe('GET /api/inbox/tasks → 200 (227ms)');
    expect(line.level).toBe('info');
    expect(line.source).toBe('project-sites');
    expect(line.timestamp).toBe('1970-01-01T00:00:00.001Z');
  });

  it('omits status/duration when absent', () => {
    const line = mapEventToLogLine({ timestamp: 1, source: { method: 'POST', path: '/x' } }, 0);
    expect(line.message).toBe('POST /x');
  });

  it('falls back to msg, then message, then eventName, then JSON', () => {
    expect(mapEventToLogLine({ source: { msg: 'boot ok' } }, 0).message).toBe('boot ok');
    expect(mapEventToLogLine({ source: { message: 'legacy' } }, 0).message).toBe('legacy');
    expect(mapEventToLogLine({ source: { eventName: 'cron_fired' } }, 0).message).toBe('cron_fired');
    expect(mapEventToLogLine({ source: { foo: 'bar' } }, 0).message).toBe('{"foo":"bar"}');
  });

  it('coerces an unrecognized level to info and derives source from service when scope absent', () => {
    const line = mapEventToLogLine({ timestamp: 5, source: { level: 'fatal', msg: 'x', service: 'svc-a' } }, 2);
    expect(line.level).toBe('info');
    expect(line.source).toBe('svc-a');
  });

  it('omits source entirely when neither scope nor service is present', () => {
    const line = mapEventToLogLine({ timestamp: 5, source: { msg: 'x' } }, 0);
    expect('source' in line).toBe(false);
  });

  it('builds a stable id from timestamp, index and requestId', () => {
    const line = mapEventToLogLine({ timestamp: 1700, source: { msg: 'x', requestId: 'req-9' } }, 3);
    expect(line.id).toBe('1700-3-req-9');
  });

  it('never throws on an empty / sourceless event', () => {
    expect(() => mapEventToLogLine({}, 0)).not.toThrow();
    const line = mapEventToLogLine({}, 0);
    expect(line.timestamp).toBe('1970-01-01T00:00:00.000Z');
    expect(line.level).toBe('info');
  });
});

describe('buildObservabilityQuery', () => {
  it('filters by $metadata.service and targets the workers dataset in events view', () => {
    const q = buildObservabilityQuery('project-sites', 1000, 2000, 50);
    expect(q.parameters.datasets).toEqual(['cloudflare-workers']);
    expect(q.parameters.filters[0]).toEqual({ key: '$metadata.service', operation: 'eq', value: 'project-sites', type: 'string' });
    expect(q.timeframe).toEqual({ from: 1000, to: 2000 });
    expect(q.limit).toBe(50);
    expect(q.view).toBe('events');
  });
});

describe('computeWindow', () => {
  const NOW = 10_000_000;

  it('looks back the default window on the first poll (no cursor)', () => {
    const { fromMs, toMs } = computeWindow(null, NOW);
    expect(toMs).toBe(NOW);
    expect(fromMs).toBe(NOW - 5 * 60_000);
  });

  it('resumes 1ms after a valid cursor to avoid re-emitting the boundary event', () => {
    const since = new Date(NOW - 1000).toISOString();
    const { fromMs } = computeWindow(since, NOW);
    expect(fromMs).toBe(NOW - 1000 + 1);
  });

  it('clamps a future cursor so from stays < to', () => {
    const since = new Date(NOW + 999999).toISOString();
    const { fromMs, toMs } = computeWindow(since, NOW);
    expect(fromMs).toBe(toMs - 1);
  });

  it('falls back to the default window for a garbage cursor', () => {
    expect(computeWindow('not-a-date', NOW).fromMs).toBe(NOW - 5 * 60_000);
  });
});

describe('sortLinesAscending', () => {
  it('orders oldest→newest so the client cursor (last line) is the newest', () => {
    const lines: LogLine[] = [
      { id: 'b', timestamp: '2026-01-01T00:00:02.000Z', level: 'info', message: 'second' },
      { id: 'a', timestamp: '2026-01-01T00:00:01.000Z', level: 'info', message: 'first' },
      { id: 'c', timestamp: '2026-01-01T00:00:03.000Z', level: 'info', message: 'third' },
    ];
    const sorted = sortLinesAscending(lines);
    expect(sorted.map((l) => l.message)).toEqual(['first', 'second', 'third']);
    expect(sorted[sorted.length - 1].message).toBe('third');
  });
});
