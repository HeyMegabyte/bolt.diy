/**
 * Level-filtering contract for the scoped logger.
 *
 * The editor logs through this logger; in prod the default level is `info`, so
 * anything below `info` (trace/debug) must be suppressed. This underpins the
 * console-hygiene fix that demotes per-provider registration spam from `info`
 * to `debug` (22 lines/boot → silent in prod, still visible in dev). Previously
 * the logger had no unit coverage at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

describe('logger level filtering', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
    logger.setLevel('debug'); // restore the test-runner default
  });

  it('at level=info, suppresses debug but emits info/warn/error', () => {
    logger.setLevel('info');

    logger.debug('reg detail'); // below threshold → dropped
    expect(spy).not.toHaveBeenCalled();

    logger.info('something happened');
    logger.warn('careful');
    logger.error('boom');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('at level=debug, emits debug too', () => {
    logger.setLevel('debug');
    logger.debug('reg detail');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('at level=none, suppresses everything including error', () => {
    logger.setLevel('none');
    logger.debug('x');
    logger.info('y');
    logger.warn('z');
    logger.error('boom');
    expect(spy).not.toHaveBeenCalled();
  });
});
