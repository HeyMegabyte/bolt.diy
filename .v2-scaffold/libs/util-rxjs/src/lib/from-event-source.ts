/**
 * Wrap an `EventSource` in an Observable.
 *
 * @example
 * ```ts
 * fromEventSource<LogLine>('/api/apps/instances/abc/logs').pipe(
 *   filter((line) => line.level !== 'trace'),
 * );
 * ```
 *
 * @remarks `EventSource` is a browser API. In SSR contexts the caller
 * must guard with `isPlatformBrowser`. The Observable closes the
 * underlying connection on unsubscribe and emits an `error` notification
 * when the stream errors before the first `open` event.
 */
import { Observable } from 'rxjs';

export interface FromEventSourceOptions extends EventSourceInit {
  /** Event name to listen to (default `'message'`). */
  eventName?: string;
  /** Custom JSON parser; defaults to `JSON.parse`. */
  parser?: (data: string) => unknown;
}

export function fromEventSource<T>(
  url: string | URL,
  opts: FromEventSourceOptions = {}
): Observable<T> {
  const { eventName = 'message', parser = JSON.parse, ...init } = opts;
  return new Observable<T>((subscriber) => {
    if (typeof EventSource === 'undefined') {
      subscriber.error(new Error('EventSource is not available in this environment'));
      return;
    }
    const es = new EventSource(url, init);
    const onMessage = (event: MessageEvent<string>) => {
      try {
        subscriber.next(parser(event.data) as T);
      } catch (err) {
        subscriber.error(err);
      }
    };
    const onError = (event: Event) => {
      // EventSource auto-reconnects on transient errors; only surface
      // when the connection is definitively closed.
      if (es.readyState === EventSource.CLOSED) {
        subscriber.error(event instanceof Error ? event : new Error('EventSource closed'));
      }
    };
    es.addEventListener(eventName, onMessage as EventListener);
    es.addEventListener('error', onError);
    return () => {
      es.removeEventListener(eventName, onMessage as EventListener);
      es.removeEventListener('error', onError);
      es.close();
    };
  });
}
