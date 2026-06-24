/**
 * @module services/collab
 * @description Client for real-time collaborative editing (feature: collab_editing).
 *
 * Opens a vanilla reconnecting WebSocket (`partysocket`) to
 * `GET /api/sites/:id/collab` — the CollabRoomDO (PartyServer + Yjs) gateway —
 * and binds a Yjs document so every connected client converges on shared state.
 *
 * Gated behind the `collab_editing` feature flag: `connect()` resolves to `null`
 * when the flag is off (the editor stays single-player). The backend route also
 * returns 404 when the flag is off and 503 when the COLLAB_ROOM binding is
 * absent (the DO ships INERT until a watched go-live deploy), so the socket
 * simply never establishes — no errors surface to the user.
 */
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import * as Y from 'yjs';
import { WebSocket as ReconnectingWebSocket } from 'partysocket';
import { FeatureFlagService } from './feature-flag.service';

/** Handle returned by {@link CollabService.connect}. */
export interface CollabSession {
  /** The shared Yjs document — mutate it; updates broadcast automatically. */
  readonly doc: Y.Doc;
  /** Close the socket + destroy the document. Idempotent. */
  readonly disconnect: () => void;
}

@Injectable({ providedIn: 'root' })
export class CollabService {
  private readonly flags = inject(FeatureFlagService);

  /**
   * Connect to a site's collaborative editing room.
   *
   * @param siteId - The site id whose `CollabRoomDO` room to join.
   * @returns A {@link CollabSession}, or `null` when the `collab_editing` flag is
   *   off (caller should fall back to single-player editing).
   *
   * @example
   * const session = await collab.connect(siteId);
   * if (session) {
   *   const text = session.doc.getText('content');
   *   text.observe(() => render(text.toString()));
   * }
   */
  async connect(siteId: string): Promise<CollabSession | null> {
    const enabled = await firstValueFrom(this.flags.isOn('collab_editing'));
    if (!enabled) return null;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/api/sites/${encodeURIComponent(siteId)}/collab`;

    const doc = new Y.Doc();
    const socket = new ReconnectingWebSocket(url);
    socket.binaryType = 'arraybuffer';

    // Local edits → broadcast the binary update to the room.
    const onUpdate = (update: Uint8Array, origin: unknown): void => {
      if (origin === 'remote') return; // don't echo updates we just applied
      if (socket.readyState === ReconnectingWebSocket.OPEN) socket.send(update);
    };
    doc.on('update', onUpdate);

    // Remote updates → apply to the local doc (tagged 'remote' so we don't echo).
    socket.addEventListener('message', (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        Y.applyUpdate(doc, new Uint8Array(event.data), 'remote');
      }
    });

    // On (re)connect, send our full state so a late joiner catches up.
    socket.addEventListener('open', () => {
      socket.send(Y.encodeStateAsUpdate(doc));
    });

    let closed = false;
    const disconnect = (): void => {
      if (closed) return;
      closed = true;
      doc.off('update', onUpdate);
      socket.close();
      doc.destroy();
    };

    return { doc, disconnect };
  }
}
