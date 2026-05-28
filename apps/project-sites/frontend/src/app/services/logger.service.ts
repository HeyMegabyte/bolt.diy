/**
 * @module services/logger
 *
 * @description
 * Browser-side structured logger with:
 * - Identical `Logger` interface to the Worker-side `src/lib/log.ts`
 * - **Production** — emits plain-object `console.warn(payload)` so Sentry
 *   breadcrumb hooks (via `error-handler.service.ts`) pick it up automatically.
 * - **Development** — emits styled `%c` console output with colour per level.
 * - **Redaction** — key-pattern guard strips authorization/cookie/token/secret/
 *   password/key/stripe-signature values before they touch the console.
 * - **Scoped children** — `logger.child('auth')` returns a new service whose
 *   every call carries `scope: 'auth'`.
 *
 * @example
 * ```ts
 * import { LoggerService } from './logger.service';
 *
 * @Component({ … })
 * export class SomeComponent {
 *   private readonly log = inject(LoggerService).child('some-feature');
 *
 *   doThing() {
 *     this.log.info('thing_started', { siteId: '…' });
 *   }
 * }
 * ```
 */

import { Injectable, isDevMode } from '@angular/core';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

/** Public interface — mirrors Worker-side Logger. */
export interface Logger {
  debug(msg: string, ctx?: LogFields): void;
  info(msg: string, ctx?: LogFields): void;
  warn(msg: string, ctx?: LogFields): void;
  error(msg: string, ctx?: LogFields): void;
  child(scope: string): Logger;
}

// ── Redaction ─────────────────────────────────────────────────────────────────

const SENSITIVE_KEY_RE = /(authorization|cookie|token|secret|password|key|stripe-signature)/i;

function redact(ctx: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

// ── Dev colour map ────────────────────────────────────────────────────────────

const DEV_STYLES: Record<LogLevel, string> = {
  debug: 'color:#888;font-weight:normal',
  info:  'color:#0af;font-weight:bold',
  warn:  'color:#fa0;font-weight:bold',
  error: 'color:#f44;font-weight:bold',
};

// ── Logger factory ────────────────────────────────────────────────────────────

function makeLogger(scope: string): Logger {
  const dev = isDevMode();

  function emit(level: LogLevel, msg: string, ctx: LogFields): void {
    const safe = redact(ctx);
    if (dev) {
      const style = DEV_STYLES[level];
      const label = `[${scope}] ${msg}`;
      if (Object.keys(safe).length > 0) {
        console.warn(`%c${level.toUpperCase()} ${label}`, style, safe);
      } else {
        console.warn(`%c${level.toUpperCase()} ${label}`, style);
      }
    } else {
      // Production: structured object — Sentry breadcrumb interceptors pick this up.
      const payload = {
        ts: new Date().toISOString(),
        level,
        scope,
        msg,
        service: 'project-sites-spa',
        ...safe,
      };
      console.warn(payload);
    }
  }

  return {
    debug(msg, ctx = {}): void {
      if (!dev) return; // debug suppressed in production
      emit('debug', msg, ctx);
    },
    info(msg, ctx = {}): void { emit('info', msg, ctx); },
    warn(msg, ctx = {}): void { emit('warn', msg, ctx); },
    error(msg, ctx = {}): void { emit('error', msg, ctx); },
    child(childScope: string): Logger {
      return makeLogger(childScope ? `${scope}/${childScope}` : childScope);
    },
  };
}

// ── Angular Service ───────────────────────────────────────────────────────────

/**
 * Injectable wrapper around the logger factory.
 *
 * Provides a root-scoped logger plus a `.child(scope)` helper for creating
 * sub-scoped loggers inside components and services.
 *
 * @example
 * ```ts
 * const logger = inject(LoggerService);
 * const l = logger.child('auth');
 * l.info('session_started', { userId });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LoggerService implements Logger {
  private readonly _root: Logger = makeLogger('spa');

  debug(msg: string, ctx?: LogFields): void { this._root.debug(msg, ctx); }
  info(msg:  string, ctx?: LogFields): void { this._root.info(msg, ctx); }
  warn(msg:  string, ctx?: LogFields): void { this._root.warn(msg, ctx); }
  error(msg: string, ctx?: LogFields): void { this._root.error(msg, ctx); }

  /**
   * Return a new Logger whose calls carry the given `scope`.
   *
   * @param scope - Human-readable sub-system name (e.g. `'billing'`).
   */
  child(scope: string): Logger {
    return this._root.child(scope);
  }
}
