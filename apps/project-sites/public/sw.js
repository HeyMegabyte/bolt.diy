// @ts-nocheck
/**
 * Item 6 (perf): Workbox-style service worker — precache + route-level
 * runtime strategies. Replaces the prior kill-switch stub with:
 *
 *   - **App shell precache** — install-time bulk fetch of `/`, favicons,
 *     manifest, logo so cold offline reloads paint instantly.
 *   - **Navigation cache** — stale-while-revalidate on the SPA shell (always
 *     return cached `/` for fast paint, revalidate in background).
 *   - **Static asset cache** — cache-first with 30-day TTL for hashed JS/CSS
 *     (Angular emits content-hashed names — once cached they NEVER change).
 *   - **Image cache** — cache-first with 7-day TTL for /images/, /assets/,
 *     favicons; capped at 60 entries to bound storage.
 *   - **Editor host bypass** — never touch editor.projectsites.dev iframe
 *     requests (cross-origin, owned by bolt.diy's own SW).
 *   - **API + webhook bypass** — never cache; backend is source of truth.
 *
 * No Workbox runtime dep — we hand-roll the patterns in ~120 lines instead
 * of pulling in 60KB of Workbox just for four strategies.
 */

const VERSION = 'v4-2026-05-24';
const SHELL_CACHE = `ps-shell-${VERSION}`;
const STATIC_CACHE = `ps-static-${VERSION}`;
const IMAGE_CACHE = `ps-images-${VERSION}`;

// Bumping VERSION evicts every prior cache. Anything not in this allow-list
// is deleted on activate.
const CURRENT_CACHES = new Set([SHELL_CACHE, STATIC_CACHE, IMAGE_CACHE]);

const SHELL_ASSETS = [
  '/',
  '/logo-header.png',
  '/logo-icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/site.webmanifest',
  '/favicon.ico',
];

const STATIC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const IMAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_MAX_ENTRIES = 60;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // `addAll` is atomic — if ANY shell asset 404s the whole install fails
      // and the SW never activates. That's the right default for the shell;
      // anything missing means the build is broken.
      cache.addAll(SHELL_ASSETS),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !CURRENT_CACHES.has(k)).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

function isStaticAsset(url) {
  return /\.(js|mjs|css|woff2?|ttf|otf)$/i.test(url.pathname);
}

function isImage(url) {
  return /\.(png|jpg|jpeg|webp|avif|svg|gif|ico)$/i.test(url.pathname);
}

function isApi(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/');
}

function isEditorOrigin(url) {
  // The bolt.diy editor lives on its own origin and ships its own SW —
  // never proxy its traffic through this one. Cross-origin POSTs to the
  // editor's iframe must pass straight through.
  return url.hostname === 'editor.projectsites.dev'
    || url.hostname.endsWith('.stackblitz.io')
    || url.hostname.endsWith('.webcontainer-api.io')
    || url.hostname.endsWith('.webcontainer.io');
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  // FIFO eviction — oldest first. Keys are insertion-ordered per spec.
  const overflow = keys.length - maxEntries;
  for (let i = 0; i < overflow; i++) {
    await cache.delete(keys[i]);
  }
}

async function staleWhileRevalidate(cacheName, request, fallbackKey) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(fallbackKey || request);
  const fetchPromise = fetch(request).then((response) => {
    if (response && response.ok) {
      cache.put(fallbackKey || request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function cacheFirst(cacheName, request, maxAgeMs) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // TTL check via the cached response's `date` header. If stale, refetch
    // in the background but still serve cached so latency stays flat.
    const dateHdr = cached.headers.get('date');
    if (dateHdr && Date.now() - new Date(dateHdr).getTime() > maxAgeMs) {
      fetch(request).then((r) => {
        if (r && r.ok) cache.put(request, r.clone()).catch(() => {});
      }).catch(() => {});
    }
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok && request.method === 'GET') {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Cross-origin bypasses — never touch editor / WebContainer traffic.
  if (isEditorOrigin(url)) return;
  if (url.origin !== self.location.origin) return;

  // API + webhooks always hit the network.
  if (isApi(url)) return;

  // SPA navigations: SWR on `/` (Angular hash-routes everything from index).
  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(SHELL_CACHE, request, '/'));
    return;
  }

  // Hashed static assets: cache-first, 30d TTL.
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(STATIC_CACHE, request, STATIC_MAX_AGE_MS));
    return;
  }

  // Images: cache-first with bounded entries (60 max) + 7d TTL.
  if (isImage(url)) {
    event.respondWith(
      cacheFirst(IMAGE_CACHE, request, IMAGE_MAX_AGE_MS).then((response) => {
        trimCache(IMAGE_CACHE, IMAGE_MAX_ENTRIES).catch(() => {});
        return response;
      }),
    );
    return;
  }

  // Default: network-first, fall back to cache if offline.
  event.respondWith(
    fetch(request).catch(() => caches.match(request)),
  );
});

// Kill-switch escape hatch — POST a message `{type:'unregister'}` from the
// page to nuke every cache + unregister the SW. Lets us recover without a
// hard-refresh + clear-site-data on any user with a bad cache.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'unregister') {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister()),
    );
  }
});
