/**
 * Single WebSocket demultiplexed by topic.
 *
 * Caller supplies a `topicSelector` that pulls the topic key out of each
 * incoming frame; consumers call `getTopic(name)` to subscribe to a
 * filtered stream of frames for that topic. One physical connection,
 * many logical streams.
 *
 * @example
 * ```ts
 * const sock = multiplexedSocket<WSEnvelope>(
 *   'wss://api.projectsites.dev/v2/ws',
 *   (msg) => msg.topic,
 * );
 * sock.getTopic('jobs:abc').subscribe(onJobFrame);
 * sock.getTopic('logs:abc').subscribe(onLogFrame);
 * ```
 *
 * @remarks Reconnection + back-off is the caller's responsibility —
 * compose with `retryWithBackoff` on the connection observable.
 */
import { Observable, Subject, share } from 'rxjs';
import { filter, finalize } from 'rxjs/operators';

export interface MultiplexedSocket<T> {
  readonly messages$: Observable<T>;
  getTopic(topic: string): Observable<T>;
  send(payload: unknown): void;
  close(): void;
}

export interface MultiplexedSocketOptions {
  /** Sub-protocol(s) passed to the WebSocket constructor. */
  protocols?: string | string[];
  /** Custom serializer; defaults to `JSON.stringify`. */
  serializer?: (payload: unknown) => string;
  /** Custom parser; defaults to `JSON.parse`. */
  parser?: (data: string) => unknown;
}

export function multiplexedSocket<T>(
  url: string | URL,
  topicSelector: (msg: T) => string,
  opts: MultiplexedSocketOptions = {}
): MultiplexedSocket<T> {
  const serializer = opts.serializer ?? JSON.stringify;
  const parser = opts.parser ?? JSON.parse;
  const outbound = new Subject<unknown>();
  let ws: WebSocket | null = null;

  const messages$ = new Observable<T>((subscriber) => {
    if (typeof WebSocket === 'undefined') {
      subscriber.error(new Error('WebSocket is not available in this environment'));
      return;
    }
    ws = new WebSocket(url, opts.protocols);
    const outboundSub = outbound.subscribe((p) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(serializer(p));
      }
    });
    const onMessage = (event: MessageEvent<string>) => {
      try {
        subscriber.next(parser(event.data) as T);
      } catch (err) {
        subscriber.error(err);
      }
    };
    const onError = () => subscriber.error(new Error('WebSocket error'));
    const onClose = () => subscriber.complete();
    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);
    return () => {
      outboundSub.unsubscribe();
      ws?.removeEventListener('message', onMessage);
      ws?.removeEventListener('error', onError);
      ws?.removeEventListener('close', onClose);
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
      ws = null;
    };
  }).pipe(share());

  return {
    messages$,
    getTopic(topic: string): Observable<T> {
      return messages$.pipe(
        filter((msg) => topicSelector(msg) === topic),
        finalize(() => {
          /* topic-level finalize is a no-op; physical close on last sub */
        })
      );
    },
    send(payload: unknown): void {
      outbound.next(payload);
    },
    close(): void {
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    },
  };
}
