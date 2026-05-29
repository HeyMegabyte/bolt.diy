/**
 * Content script — injects a floating "Clone with ProjectSites" button
 * onto every non-excluded page.
 *
 * Design constraints:
 *   - Never alters host page DOM beyond a single floating button container
 *   - Survives SPA navigation (re-injects on history.pushState)
 *   - Respects prefers-reduced-motion
 *   - High contrast on both light + dark backgrounds via mix-blend-mode
 */
import type { ExtensionMessage } from '../shared/messages.js';

const ROOT_ID = 'ps-clone-fab-root';

function injectFab(): void {
  if (document.getElementById(ROOT_ID)) return;

  const root = document.createElement('div');
  root.id = ROOT_ID;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ps-fab';
  btn.setAttribute('aria-label', 'Clone this site with ProjectSites');
  btn.title = 'Clone this site with ProjectSites';

  const label = document.createElement('span');
  label.textContent = 'Clone with ProjectSites';
  label.className = 'ps-fab__label';

  const dot = document.createElement('span');
  dot.className = 'ps-fab__dot';
  dot.setAttribute('aria-hidden', 'true');

  btn.appendChild(dot);
  btn.appendChild(label);

  btn.addEventListener('click', () => {
    btn.classList.add('ps-fab--loading');
    label.textContent = 'Sending…';
    const msg: ExtensionMessage = {
      type: 'PS_CLONE_REQUEST',
      url: window.location.href,
      page_title: document.title,
      referer: document.referrer,
    };
    chrome.runtime.sendMessage(msg, (response: ExtensionMessage | undefined) => {
      btn.classList.remove('ps-fab--loading');
      if (response?.type === 'PS_CLONE_RESULT' && response.ok) {
        label.textContent = 'Opened ✓';
        setTimeout(() => {
          label.textContent = 'Clone with ProjectSites';
        }, 3000);
      } else {
        label.textContent = 'Try again';
        console.warn(
          '[ProjectSites] clone failed',
          response?.type === 'PS_CLONE_RESULT' ? response.error : 'no response',
        );
      }
    });
  });

  root.appendChild(btn);
  document.body.appendChild(root);
}

// Initial inject.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFab, { once: true });
} else {
  injectFab();
}

// Re-inject on SPA route changes (history.pushState patch).
const origPush = history.pushState.bind(history);
history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
  const ret = origPush.apply(this, args);
  setTimeout(injectFab, 250);
  return ret;
};
window.addEventListener('popstate', () => setTimeout(injectFab, 250));
