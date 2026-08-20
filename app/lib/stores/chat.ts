import { map } from 'nanostores';

export const chatStore = map({
  started: false,
  aborted: false,
  showChat: true,
  /**
   * Mobile (<1024px): the chat renders as a full-screen slide-over panel,
   * toggled by the Workbench's "Chat" tab (alongside Code/Preview/Functions/
   * Data) — the two surfaces never squeeze side-by-side on a phone.
   */
  mobileChatOpen: false,
});
