/**
 * Offline edit queue (webview-side).
 *
 * Authoritative store: IndexedDB `ps-edit-queue` database, `pending`
 * object store. Each entry: { id, site_id, payload, attempts, created_at }.
 *
 * The Angular admin SPA's `ApiService` interceptor catches 5xx/network
 * errors on PATCH/POST mutations against `/api/sites/*` and enqueues
 * them here instead of toasting "Save failed". A background timer
 * retries every 30s when navigator.onLine is true.
 *
 * After every enqueue/dequeue we emit `queue:update` so the Rust side
 * can mirror the pending count for the tray icon badge.
 */
import { emit } from '@tauri-apps/api/event';

const DB_NAME = 'ps-edit-queue';
const STORE = 'pending';
const DB_VERSION = 1;

export interface QueueEntry {
  id: string;
  site_id: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  body: string;
  attempts: number;
  created_at: number;
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(entry: Omit<QueueEntry, 'id' | 'attempts' | 'created_at'>): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({
      ...entry,
      id: crypto.randomUUID(),
      attempts: 0,
      created_at: Date.now(),
    } satisfies QueueEntry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await notifyCount();
}

export async function count(): Promise<number> {
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function drain(): Promise<void> {
  if (!navigator.onLine) return;
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const req = store.getAll();
  await new Promise<void>((resolve) => (req.onsuccess = () => resolve()));
  for (const entry of req.result as QueueEntry[]) {
    try {
      const res = await fetch(entry.url, {
        method: entry.method,
        headers: { 'content-type': 'application/json' },
        body: entry.body,
        credentials: 'include',
      });
      if (res.ok) {
        store.delete(entry.id);
      } else if (entry.attempts >= 5) {
        store.delete(entry.id);
      } else {
        store.put({ ...entry, attempts: entry.attempts + 1 } satisfies QueueEntry);
      }
    } catch {
      store.put({ ...entry, attempts: entry.attempts + 1 } satisfies QueueEntry);
    }
  }
  await notifyCount();
}

async function notifyCount(): Promise<void> {
  const pending = await count();
  await emit('queue:update', { pending });
}

// Auto-drain when we go online.
window.addEventListener('online', () => void drain());
// Periodic drain — every 30s.
setInterval(() => void drain(), 30_000);
