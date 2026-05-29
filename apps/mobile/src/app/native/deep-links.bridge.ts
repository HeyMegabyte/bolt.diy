import { App, type URLOpenListenerEvent } from '@capacitor/app';

/**
 * Wires Universal Links (iOS) + App Links (Android) into the webview.
 *
 * Schemes registered:
 *   - https://projectsites.dev/admin/* — opens the admin SPA at the route
 *   - projectsites://site/<slug>      — deep links to a specific site
 */
export function wireDeepLinkHandler(): void {
  App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    try {
      const url = new URL(event.url);
      if (
        url.protocol === 'projectsites:' &&
        url.hostname === 'site' &&
        url.pathname
      ) {
        const slug = url.pathname.replace(/^\//, '');
        window.location.assign(
          `https://projectsites.dev/admin/sites/${slug}`,
        );
        return;
      }
      if (url.hostname === 'projectsites.dev') {
        window.location.assign(url.toString());
      }
    } catch (err) {
      console.warn('[ps-mobile] invalid deep link', event.url, err);
    }
  });
}
