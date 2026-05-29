/**
 * Popup UI — current tab summary + manual clone button.
 *
 * The popup talks ONLY to the background service worker via
 * chrome.runtime.sendMessage; never POSTs to the API directly so the
 * import flow stays in one place.
 */
import type { ExtensionMessage } from '../shared/messages.js';

const urlEl = document.getElementById('current-url') as HTMLParagraphElement;
const btn = document.getElementById('clone-btn') as HTMLButtonElement;
const optionsBtn = document.getElementById('options-btn') as HTMLButtonElement;

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    urlEl.textContent = 'No active tab';
    btn.disabled = true;
    return;
  }
  urlEl.textContent = tab.url;
  urlEl.title = tab.url;

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Sending…';
    const msg: ExtensionMessage = {
      type: 'PS_CLONE_REQUEST',
      url: tab.url!,
      page_title: tab.title ?? '',
      referer: tab.url!,
    };
    chrome.runtime.sendMessage(msg, (response: ExtensionMessage | undefined) => {
      if (response?.type === 'PS_CLONE_RESULT' && response.ok) {
        btn.textContent = 'Opening build…';
        setTimeout(() => window.close(), 800);
      } else {
        btn.textContent = 'Failed — retry';
        btn.disabled = false;
      }
    });
  });

  optionsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PS_OPEN_OPTIONS' } satisfies ExtensionMessage);
  });
}

void init();
