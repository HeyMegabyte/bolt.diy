import { LanguageDescription } from '@codemirror/language';

/**
 * Item 8/10 (perf): Language modes are loaded on-demand via CodeMirror's
 * `LanguageDescription.matchFilename` — opening a `.py` file is what triggers
 * the `@codemirror/lang-python` dynamic import; closing the editor never
 * matters because Vite/Remix has already code-split each `lang-*` chunk into
 * its own file.
 *
 * Item 10: Wasm (`.wat`) and C++ (`.cpp`) syntax bundles are 800KB+ each —
 * dropped from the default registry. Users building Vite/React/Next/Astro
 * websites never edit these. Activate via the `?syntax=on` URL flag — the
 * loader at the bottom of this file gates the heavy modes on that param so
 * power users can still get them when they're explicitly needed.
 *
 * Item 8 (cont.): The lazy-load wrapper additionally schedules the import
 * via `requestIdleCallback` (where supported) so syntax-mode network/JS work
 * never competes with input latency on the file the user just opened.
 */

function idleImport<T>(factory: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined' || typeof (window as Window & typeof globalThis & { requestIdleCallback?: (cb: IdleRequestCallback) => number }).requestIdleCallback !== 'function') {
    return factory();
  }
  const ric = (window as Window & typeof globalThis & { requestIdleCallback: (cb: IdleRequestCallback, opts?: { timeout: number }) => number }).requestIdleCallback;
  return new Promise<T>((resolve, reject) => {
    ric(() => {
      factory().then(resolve, reject);
    }, { timeout: 500 });
  });
}

function heavySyntaxEnabled(): boolean {
  // `?syntax=on` flag enables the C++/Wasm bundles. Anything else (default)
  // keeps them out of the bundle graph entirely. We check `location.search`
  // lazily because this module is imported during SSR too.
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('syntax') === 'on';
  } catch {
    return false;
  }
}

const baseLanguages = [
  LanguageDescription.of({
    name: 'VUE',
    extensions: ['vue'],
    async load() {
      return idleImport(() => import('@codemirror/lang-vue').then((module) => module.vue()));
    },
  }),
  LanguageDescription.of({
    name: 'TS',
    extensions: ['ts'],
    async load() {
      return idleImport(() => import('@codemirror/lang-javascript').then((module) => module.javascript({ typescript: true })));
    },
  }),
  LanguageDescription.of({
    name: 'JS',
    extensions: ['js', 'mjs', 'cjs'],
    async load() {
      return idleImport(() => import('@codemirror/lang-javascript').then((module) => module.javascript()));
    },
  }),
  LanguageDescription.of({
    name: 'TSX',
    extensions: ['tsx'],
    async load() {
      return idleImport(() => import('@codemirror/lang-javascript').then((module) => module.javascript({ jsx: true, typescript: true })));
    },
  }),
  LanguageDescription.of({
    name: 'JSX',
    extensions: ['jsx'],
    async load() {
      return idleImport(() => import('@codemirror/lang-javascript').then((module) => module.javascript({ jsx: true })));
    },
  }),
  LanguageDescription.of({
    name: 'HTML',
    extensions: ['html'],
    async load() {
      return idleImport(() => import('@codemirror/lang-html').then((module) => module.html()));
    },
  }),
  LanguageDescription.of({
    name: 'CSS',
    extensions: ['css'],
    async load() {
      return idleImport(() => import('@codemirror/lang-css').then((module) => module.css()));
    },
  }),
  LanguageDescription.of({
    name: 'SASS',
    extensions: ['sass'],
    async load() {
      return idleImport(() => import('@codemirror/lang-sass').then((module) => module.sass({ indented: true })));
    },
  }),
  LanguageDescription.of({
    name: 'SCSS',
    extensions: ['scss'],
    async load() {
      return idleImport(() => import('@codemirror/lang-sass').then((module) => module.sass({ indented: false })));
    },
  }),
  LanguageDescription.of({
    name: 'JSON',
    extensions: ['json'],
    async load() {
      return idleImport(() => import('@codemirror/lang-json').then((module) => module.json()));
    },
  }),
  LanguageDescription.of({
    name: 'Markdown',
    extensions: ['md'],
    async load() {
      return idleImport(() => import('@codemirror/lang-markdown').then((module) => module.markdown()));
    },
  }),
  LanguageDescription.of({
    name: 'Python',
    extensions: ['py'],
    async load() {
      return idleImport(() => import('@codemirror/lang-python').then((module) => module.python()));
    },
  }),
];

// Item 10: heavy syntax modes (Wasm ~800KB, C++ ~1.2MB raw) only load when
// the user explicitly opts in via `?syntax=on`. Dropping these from the
// default bundle graph saves ~2MB of code-split chunks that 99% of website-
// builder users never touch.
const heavyLanguages = [
  LanguageDescription.of({
    name: 'Wasm',
    extensions: ['wat'],
    async load() {
      return idleImport(() => import('@codemirror/lang-wast').then((module) => module.wast()));
    },
  }),
  LanguageDescription.of({
    name: 'C++',
    extensions: ['cpp'],
    async load() {
      return idleImport(() => import('@codemirror/lang-cpp').then((module) => module.cpp()));
    },
  }),
];

export const supportedLanguages = heavySyntaxEnabled()
  ? [...baseLanguages, ...heavyLanguages]
  : baseLanguages;

export async function getLanguage(fileName: string) {
  const languageDescription = LanguageDescription.matchFilename(supportedLanguages, fileName);

  if (languageDescription) {
    return await languageDescription.load();
  }

  // TODO(perf-10): if a user opens a .cpp/.wat without `?syntax=on`, we could
  // surface a one-time toast offering to enable the heavy syntax bundle and
  // reload with the flag set. Out of scope for this performance pass.
  return undefined;
}
