/**
 * Message-passing protocol between content script, popup, and service worker.
 *
 * Discriminated by `type` so the receiver can switch exhaustively.
 */
export type ExtensionMessage =
  | {
      type: 'PS_CLONE_REQUEST';
      url: string;
      page_title: string;
      referer?: string;
    }
  | { type: 'PS_OPEN_OPTIONS' }
  | { type: 'PS_CLONE_RESULT'; ok: boolean; siteId?: string; error?: string };
