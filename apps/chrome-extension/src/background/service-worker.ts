/**
 * MV3 background service worker.
 *
 * Owns:
 *   1. Context menu + keyboard command registration
 *   2. POST to /api/sites/import-from-url
 *   3. Opening the resulting build URL in a new tab
 *   4. Routing PS_CLONE_REQUEST messages from content + popup
 */
import {
  postImport,
  WAITING_ROUTE,
  type ImportFromUrlRequest,
} from '../shared/api.js';
import type { ExtensionMessage } from '../shared/messages.js';

const MENU_ID = 'projectsites-clone';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Clone this page with ProjectSites',
    contexts: ['page', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const url = info.linkUrl ?? info.pageUrl ?? tab?.url;
  if (!url) return;
  void cloneUrl({
    url,
    source: 'chrome-extension',
    page_title: tab?.title ?? '',
    referer: tab?.url ?? '',
    user_intent: 'clone',
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'clone-current-tab') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  void cloneUrl({
    url: tab.url,
    source: 'chrome-extension',
    page_title: tab.title ?? '',
    referer: tab.url,
    user_intent: 'clone',
  });
});

chrome.runtime.onMessage.addListener(
  (msg: ExtensionMessage, _sender, sendResponse) => {
    if (msg.type === 'PS_CLONE_REQUEST') {
      void cloneUrl({
        url: msg.url,
        source: 'chrome-extension',
        page_title: msg.page_title,
        referer: msg.referer,
        user_intent: 'clone',
      })
        .then((siteId) => sendResponse({ type: 'PS_CLONE_RESULT', ok: true, siteId }))
        .catch((err: unknown) =>
          sendResponse({
            type: 'PS_CLONE_RESULT',
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return true; // async response
    }
    if (msg.type === 'PS_OPEN_OPTIONS') {
      chrome.runtime.openOptionsPage();
      sendResponse(undefined);
      return false;
    }
    return false;
  },
);

async function cloneUrl(req: ImportFromUrlRequest): Promise<string> {
  const result = await postImport(req);
  await chrome.tabs.create({ url: WAITING_ROUTE(result.site_id) });
  await chrome.action.setBadgeText({ text: '✓' });
  await chrome.action.setBadgeBackgroundColor({ color: '#00e5ff' });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' });
  }, 4000);
  return result.site_id;
}
