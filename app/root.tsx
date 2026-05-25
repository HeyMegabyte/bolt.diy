import { useStore } from '@nanostores/react';
import type { LinksFunction } from '@remix-run/cloudflare';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';
import tailwindReset from '@unocss/reset/tailwind-compat.css?url';
import { themeStore } from './lib/stores/theme';
import { stripIndents } from './utils/stripIndent';
import { createHead } from 'remix-island';
import { useEffect, useState } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ClientOnly } from 'remix-utils/client-only';
import { cssTransition, ToastContainer } from 'react-toastify';

import reactToastifyStyles from 'react-toastify/dist/ReactToastify.css?url';
import globalStyles from './styles/index.scss?url';
import xtermStyles from '@xterm/xterm/css/xterm.css?url';

import 'virtual:uno.css';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

export const links: LinksFunction = () => [
  {
    rel: 'icon',
    href: '/favicon.svg',
    type: 'image/svg+xml',
  },
  { rel: 'stylesheet', href: reactToastifyStyles },
  { rel: 'stylesheet', href: tailwindReset },
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'stylesheet', href: xtermStyles },
  {
    rel: 'preconnect',
    href: 'https://fonts.googleapis.com',
  },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
];

/**
 * Must run before WebContainer.boot() to override the iframe URL.
 * The default /headless endpoint may 404 with older internal package
 * versions. Setting WEBCONTAINER_API_IFRAME_URL ensures the correct
 * origin is used for the headless runtime.
 */
const webcontainerIframeOverride = stripIndents`
  globalThis.WEBCONTAINER_API_IFRAME_URL = "https://stackblitz.com";
`;

const inlineThemeCode = stripIndents`
  setTutorialKitTheme();

  function setTutorialKitTheme() {
    let theme = localStorage.getItem('bolt_theme');

    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.querySelector('html')?.setAttribute('data-theme', theme);
  }
`;

export const Head = createHead(() => (
  <>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <Meta />
    <Links />
    <script dangerouslySetInnerHTML={{ __html: webcontainerIframeOverride }} />
    <script dangerouslySetInnerHTML={{ __html: inlineThemeCode }} />
  </>
));

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useStore(themeStore);

  useEffect(() => {
    document.querySelector('html')?.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <>
      <ClientOnly>{() => <BootSkeleton />}</ClientOnly>
      <ClientOnly>{() => <DndProvider backend={HTML5Backend}>{children}</DndProvider>}</ClientOnly>
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
        autoClose={3000}
      />
      <ScrollRestoration />
      <Scripts />
    </>
  );
}

import { logStore } from './lib/stores/logs';

/**
 * Item 32 — boot skeleton. Shows "Booting {slug}" until either the
 * WebContainer signals ready OR the chat shell signals ready (in embedded
 * mode where WC never boots). Auto-hides after 30s as a safety net so a
 * stuck environment never leaves the overlay onscreen.
 */
function BootSkeleton() {
  const [ready, setReady] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    setSlug(params.get('slug'));

    const markReady = () => setReady(true);

    // Poll for the WebContainer context loaded flag (every 200ms).
    const interval = window.setInterval(async () => {
      try {
        const mod = await import('~/lib/webcontainer');
        if (mod.webcontainerContext.loaded) {
          markReady();
          window.clearInterval(interval);
        }
      } catch {
        // ignore — fall back to ready-by-text path below
      }
    }, 200);

    // Embedded mode never boots WC — listen for the chat-ready text probe.
    const READY_TEXT = 'Build a professional website for';
    const probe = () =>
      document.body?.innerText?.includes(READY_TEXT) ||
      !!document.querySelector(`[placeholder*="${READY_TEXT}"]`);
    const textInterval = window.setInterval(() => {
      if (probe()) {
        markReady();
        window.clearInterval(textInterval);
        window.clearInterval(interval);
      }
    }, 300);

    const timeout = window.setTimeout(markReady, 30_000);

    return () => {
      window.clearInterval(interval);
      window.clearInterval(textInterval);
      window.clearTimeout(timeout);
    };
  }, []);

  if (ready) return null;

  return (
    <div className="ps-boot-skeleton" aria-live="polite" aria-busy="true">
      <div className="ps-boot-skeleton__inner">
        <img src="/favicon.svg" alt="" width={28} height={28} className="ps-boot-skeleton__favicon" />
        <div className="ps-boot-skeleton__text">
          <div className="ps-boot-skeleton__title">Booting {slug ?? 'workspace'}</div>
          <div className="ps-boot-skeleton__bar"><span /></div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const theme = useStore(themeStore);

  useEffect(() => {
    logStore.logSystem('Application initialized', {
      theme,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    });

    // Initialize debug logging with improved error handling
    import('./utils/debugLogger')
      .then(({ debugLogger }) => {
        /*
         * The debug logger initializes itself and starts disabled by default
         * It will only start capturing when enableDebugMode() is called
         */
        const status = debugLogger.getStatus();
        logStore.logSystem('Debug logging ready', {
          initialized: status.initialized,
          capturing: status.capturing,
          enabled: status.enabled,
        });
      })
      .catch((error) => {
        logStore.logError('Failed to initialize debug logging', error);
      });

    /*
     * Cross-iframe handshake with the projectsites.dev admin shell.
     * - PS_CURSOR: forward every pointermove (throttled to RAF) so the
     *   admin's circular cursor follower keeps tracking even when the
     *   user's pointer is over our iframe (iframes normally swallow
     *   parent mouseevents).
     * - PS_BOLT_CHAT_READY: post once when the chat input placeholder
     *   "Build a professional website for" has painted, so the admin
     *   can dismiss its loading overlay.
     */
    if (typeof window === 'undefined' || window.parent === window) return;

    const PARENT_ORIGIN = 'https://projectsites.dev';
    const INTERACTIVE = 'a, button, input, textarea, select, [role="button"], [data-tooltip]';
    let pendingFrame = 0;
    let lastX = 0;
    let lastY = 0;
    let lastHover = false;

    const send = () => {
      pendingFrame = 0;
      window.parent.postMessage({ type: 'PS_CURSOR', x: lastX, y: lastY, hover: lastHover }, PARENT_ORIGIN);
    };

    const onMove = (ev: PointerEvent | MouseEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      lastHover = !!(ev.target as HTMLElement | null)?.closest?.(INTERACTIVE);
      if (!pendingFrame) pendingFrame = requestAnimationFrame(send);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('mousemove', onMove, { passive: true });

    /*
     * Watch for the chat placeholder text to mount. The chat textarea uses
     * a dynamic placeholder ending in "Build a professional website for…",
     * so once any element on the page carries that string we know the
     * editor shell is up enough to invite input.
     */
    const READY_TEXT = 'Build a professional website for';
    const fireReady = () => {
      window.parent.postMessage({ type: 'PS_BOLT_CHAT_READY' }, PARENT_ORIGIN);
      // Item 48: editor.boot_done — second event in the PostHog funnel,
      // fires the moment the chat placeholder paints (the same signal the
      // admin uses to dismiss its loading overlay).
      window.parent.postMessage(
        { type: 'PS_TELEMETRY', event: 'editor.boot_done', props: { embedded: true } },
        PARENT_ORIGIN,
      );
    };
    const probe = () => document.body?.innerText?.includes(READY_TEXT) ||
                        !!document.querySelector(`[placeholder*="${READY_TEXT}"]`);

    if (probe()) {
      fireReady();
    } else {
      const observer = new MutationObserver(() => {
        if (probe()) {
          fireReady();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder'] });
      // Safety net — fire after 25s even if we never spot the string.
      setTimeout(() => {
        fireReady();
        observer.disconnect();
      }, 25_000);
    }
  }, []);

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
