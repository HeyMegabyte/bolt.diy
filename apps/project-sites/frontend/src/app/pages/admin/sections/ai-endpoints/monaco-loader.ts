/**
 * Lazy loader for the Monaco editor.
 *
 * @remarks
 * Monaco ships as a ~3-5 MB bundle including its web workers. We never want
 * that weight in the initial Angular chunk — only in the lazy chunk that
 * powers the "Open IDE" fullscreen overlay. This module loads Monaco's AMD
 * `loader.js` once on demand, configures `MonacoEnvironment.baseUrl` so the
 * editor + language workers resolve relative to `/assets/monaco/vs/`, and
 * returns the global `monaco` namespace from `window`.
 *
 * The `assets/monaco/vs/**` tree is copied at build time by the angular.json
 * `assets` array entry (see `angular.json` → `architect.build.options.assets`).
 *
 * @example
 * ```ts
 * const monaco = await loadMonaco();
 * monaco.editor.create(host, { value: 'hello', language: 'typescript' });
 * ```
 */

// Minimal façade — we only consume the bits the IDE component uses, but the
// returned value IS the real `monaco` namespace at runtime.
export type MonacoNamespace = typeof import('monaco-editor');

/** Singleton — successive callers share the in-flight promise. */
let cached: Promise<MonacoNamespace> | null = null;

/** Absolute base where the Monaco AMD bundle lives in production. */
const MONACO_BASE = '/assets/monaco/vs';

/**
 * Returns the global `monaco` namespace, dynamically loading the AMD bundle
 * the first time it's called. Safe to call from any number of components —
 * the promise is cached so workers and tokenizers only initialize once.
 */
export function loadMonaco(): Promise<MonacoNamespace> {
  if (cached) return cached;
  cached = bootstrap();
  return cached;
}

function bootstrap(): Promise<MonacoNamespace> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Monaco can only be loaded in a browser context.'));
      return;
    }

    const w = window as unknown as {
      monaco?: MonacoNamespace;
      require?: { config: (cfg: Record<string, unknown>) => void } & ((deps: string[], cb: () => void) => void);
      MonacoEnvironment?: { baseUrl?: string; getWorkerUrl?: (workerId: string, label: string) => string };
    };

    // Already loaded by a prior caller (shouldn't happen because of `cached`,
    // but defensive).
    if (w.monaco) {
      resolve(w.monaco);
      return;
    }

    // Resolve worker URLs through the AMD loader's baseUrl so language
    // workers (ts.worker, json.worker, etc.) come from the same vendored
    // tree as the main editor.
    w.MonacoEnvironment = {
      baseUrl: MONACO_BASE,
      getWorkerUrl(_moduleId: string, label: string): string {
        return monacoWorkerProxy(label);
      },
    };

    const loaderUrl = `${MONACO_BASE}/loader.js`;
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-monaco-loader="1"]`,
    );

    const onLoaderReady = (): void => {
      if (!w.require) {
        reject(new Error('Monaco AMD loader did not expose `window.require`.'));
        return;
      }
      w.require.config({ paths: { vs: MONACO_BASE } });
      w.require(['vs/editor/editor.main'], () => {
        if (!w.monaco) {
          reject(new Error('Monaco editor failed to attach `window.monaco`.'));
          return;
        }
        resolve(w.monaco);
      });
    };

    if (existing) {
      // Loader already requested by a concurrent caller; wait for it.
      existing.addEventListener('load', onLoaderReady, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Monaco AMD loader.')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = loaderUrl;
    script.async = true;
    script.defer = true;
    script.dataset['monacoLoader'] = '1';
    script.addEventListener('load', onLoaderReady, { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error(`Failed to load Monaco AMD loader from ${loaderUrl}.`)),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

/**
 * Build a same-origin Blob worker that bootstraps the real Monaco worker via
 * `importScripts`. This sidesteps the cross-origin worker restriction that
 * appears when Monaco's worker URL doesn't match the page origin (e.g. when
 * served from a CDN subdomain).
 *
 * For the workers that Monaco ships:
 * - `editor`/default → `editor.worker.js`
 * - `typescript`/`javascript` → `language/typescript/ts.worker.js`
 * - `json` → `language/json/json.worker.js`
 * - `css`/`scss`/`less` → `language/css/css.worker.js`
 * - `html`/`handlebars`/`razor` → `language/html/html.worker.js`
 */
function monacoWorkerProxy(label: string): string {
  const path = workerPathFor(label);
  const absolute = new URL(`${MONACO_BASE}/${path}`, window.location.origin).toString();
  const blob = new Blob(
    [
      `self.MonacoEnvironment = { baseUrl: ${JSON.stringify(`${window.location.origin}${MONACO_BASE}/`)} };\n` +
        `importScripts(${JSON.stringify(absolute)});\n`,
    ],
    { type: 'application/javascript' },
  );
  return URL.createObjectURL(blob);
}

function workerPathFor(label: string): string {
  switch (label) {
    case 'typescript':
    case 'javascript':
      return 'language/typescript/ts.worker.js';
    case 'json':
      return 'language/json/json.worker.js';
    case 'css':
    case 'scss':
    case 'less':
      return 'language/css/css.worker.js';
    case 'html':
    case 'handlebars':
    case 'razor':
      return 'language/html/html.worker.js';
    default:
      return 'editor/editor.worker.js';
  }
}
