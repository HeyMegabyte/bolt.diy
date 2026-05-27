/**
 * @file KvTab — Cloudflare Workers KV namespace + key browser/editor.
 *
 * @remarks
 * Left sidebar lists KV namespaces via
 * `GET /api/bolt-tabs/kv?action=list-namespaces`. Main pane lists keys
 * (`GET /api/bolt-tabs/kv?namespace={id}&prefix={p}`); clicking a key
 * opens the value in a JSON editor with a Save button that POSTs to
 * `/api/bolt-tabs/kv` with `{ namespace_id, key, value }`. Values are
 * stored as raw strings — pretty-print JSON is best-effort.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';

interface KvNamespace {
  id: string;
  title: string;
}

interface KvKey {
  name: string;
  expiration?: number;
  metadata?: unknown;
}

interface NamespaceListResponse {
  namespaces: KvNamespace[];
}

interface KeyListResponse {
  keys: KvKey[];
  list_complete: boolean;
  cursor?: string;
}

interface ValueResponse {
  key: string;
  value: string;
}

function prettyMaybe(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const KvTab = memo(function KvTab() {
  const [namespaces, setNamespaces] = useState<KvNamespace[]>([]);
  const [namespace, setNamespace] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  const [keys, setKeys] = useState<KvKey[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [originalValue, setOriginalValue] = useState('');
  const [loadingNs, setLoadingNs] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [loadingValue, setLoadingValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNamespaces = useCallback(async () => {
    setLoadingNs(true);
    setError(null);
    try {
      const res = await fetch('/api/bolt-tabs/kv?action=list-namespaces');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as NamespaceListResponse;
      setNamespaces(data.namespaces ?? []);
    } catch (err) {
      console.warn('[KvTab] list namespaces failed', err);
      setError(err instanceof Error ? err.message : 'Failed to list namespaces');
    } finally {
      setLoadingNs(false);
    }
  }, []);

  const loadKeys = useCallback(async () => {
    if (!namespace) {
      setKeys([]);
      return;
    }
    setLoadingKeys(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bolt-tabs/kv?namespace=${encodeURIComponent(namespace)}&prefix=${encodeURIComponent(prefix)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as KeyListResponse;
      setKeys(data.keys ?? []);
    } catch (err) {
      console.warn('[KvTab] list keys failed', err);
      setError(err instanceof Error ? err.message : 'Failed to list keys');
    } finally {
      setLoadingKeys(false);
    }
  }, [namespace, prefix]);

  const loadValue = useCallback(
    async (key: string) => {
      if (!namespace) return;
      setLoadingValue(true);
      setActiveKey(key);
      try {
        const res = await fetch(
          `/api/bolt-tabs/kv?namespace=${encodeURIComponent(namespace)}&key=${encodeURIComponent(key)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ValueResponse;
        const pretty = prettyMaybe(data.value);
        setValue(pretty);
        setOriginalValue(pretty);
      } catch (err) {
        console.warn('[KvTab] load value failed', err);
        setError(err instanceof Error ? err.message : 'Failed to load value');
      } finally {
        setLoadingValue(false);
      }
    },
    [namespace],
  );

  const save = useCallback(async () => {
    if (!namespace || !activeKey) return;
    setSaving(true);
    try {
      const res = await fetch('/api/bolt-tabs/kv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace_id: namespace, key: activeKey, value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOriginalValue(value);
    } catch (err) {
      console.warn('[KvTab] save failed', err);
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [namespace, activeKey, value]);

  useEffect(() => {
    loadNamespaces();
  }, [loadNamespaces]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const dirty = value !== originalValue;

  return (
    <div className="flex h-full overflow-hidden bg-bolt-elements-terminals-background">
      <aside className="w-56 flex-shrink-0 border-r border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 flex flex-col">
        <div className="flex items-center gap-2 px-2 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
          <div className="i-ph:key-duotone text-lg text-bolt-elements-textSecondary" />
          <span className="text-xs text-bolt-elements-textSecondary font-medium">Namespaces</span>
          <IconButton className="ml-auto" icon="i-ph:arrow-clockwise" title="Refresh" size="sm" onClick={loadNamespaces} />
        </div>
        <div className="flex-1 overflow-auto">
          {loadingNs && (
            <div className="p-2 space-y-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-7 bg-bolt-elements-background-depth-2 animate-pulse rounded" />
              ))}
            </div>
          )}
          {!loadingNs && namespaces.length === 0 && (
            <div className="p-3 text-xs text-bolt-elements-textTertiary text-center">No namespaces.</div>
          )}
          {namespaces.map((ns) => (
            <button
              key={ns.id}
              onClick={() => {
                setNamespace(ns.id);
                setActiveKey(null);
                setValue('');
                setOriginalValue('');
              }}
              className={classNames(
                'w-full text-left px-3 py-2 text-sm border-b border-bolt-elements-borderColor truncate',
                namespace === ns.id
                  ? 'bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary'
                  : 'text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2',
              )}
              title={ns.id}
            >
              <div className="truncate">{ns.title}</div>
              <div className="font-mono text-[10px] text-bolt-elements-textTertiary truncate">{ns.id}</div>
            </button>
          ))}
        </div>
      </aside>

      <div className="w-64 flex-shrink-0 border-r border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 flex flex-col">
        <div className="flex items-center gap-1 px-2 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="prefix filter"
            className="flex-1 bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary text-xs px-2 py-1 rounded border border-bolt-elements-borderColor focus:outline-none"
          />
          <IconButton icon="i-ph:arrow-clockwise" title="Reload keys" size="sm" onClick={loadKeys} />
        </div>
        <div className="flex-1 overflow-auto">
          {!namespace && <div className="p-3 text-xs text-bolt-elements-textTertiary text-center">Pick a namespace.</div>}
          {loadingKeys && (
            <div className="p-2 space-y-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-6 bg-bolt-elements-background-depth-2 animate-pulse rounded" />
              ))}
            </div>
          )}
          {namespace && !loadingKeys && keys.length === 0 && (
            <div className="p-3 text-xs text-bolt-elements-textTertiary text-center">No keys for prefix.</div>
          )}
          {keys.map((k) => (
            <button
              key={k.name}
              onClick={() => loadValue(k.name)}
              className={classNames(
                'w-full text-left px-3 py-1.5 text-xs font-mono border-b border-bolt-elements-borderColor truncate',
                activeKey === k.name
                  ? 'bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary'
                  : 'text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2',
              )}
            >
              {k.name}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 flex flex-col min-w-0">
        {error && <div className="m-3 p-3 rounded border border-red-400/30 bg-red-400/10 text-red-300 text-sm">{error}</div>}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
          <span className="text-xs text-bolt-elements-textTertiary truncate">
            {activeKey ? <span className="font-mono">{activeKey}</span> : 'Select a key to edit'}
          </span>
          <button
            disabled={!activeKey || !dirty || saving}
            onClick={save}
            className="ml-auto text-xs px-3 py-1.5 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary hover:border-bolt-elements-borderColorActive disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
        {!activeKey && (
          <div className="flex-1 flex flex-col items-center justify-center text-bolt-elements-textTertiary p-6">
            <div className="i-ph:pencil-duotone text-4xl mb-2 opacity-50" />
            <div className="text-sm">Pick a key on the left to view + edit its value.</div>
          </div>
        )}
        {activeKey && loadingValue && <div className="p-3 m-3 h-32 bg-bolt-elements-background-depth-2 animate-pulse rounded" />}
        {activeKey && !loadingValue && (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            className="flex-1 bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary font-mono text-sm p-3 outline-none resize-none"
          />
        )}
      </main>
    </div>
  );
});

export default KvTab;
