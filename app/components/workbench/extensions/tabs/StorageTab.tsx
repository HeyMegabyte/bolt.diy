/**
 * @file StorageTab — Cloudflare R2 bucket + object browser.
 *
 * @remarks
 * Left sidebar lists R2 buckets via
 * `GET /api/bolt-tabs/storage?action=list-buckets`. Main pane browses
 * objects in the selected bucket with a path breadcrumb. Each row offers
 * Download (opens a signed URL the route emits) and Delete (DELETE on the
 * same endpoint). Prefixes group objects by virtual folder.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';

interface R2Bucket {
  name: string;
  creation_date?: string;
  location?: string;
}

interface R2Object {
  key: string;
  size: number;
  uploaded: string;
  etag?: string;
}

interface ListBucketsResponse {
  buckets: R2Bucket[];
}

interface ListObjectsResponse {
  objects: R2Object[];
  delimited_prefixes: string[];
  download_url_base?: string;
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const StorageTab = memo(function StorageTab() {
  const [buckets, setBuckets] = useState<R2Bucket[]>([]);
  const [bucket, setBucket] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  const [objects, setObjects] = useState<R2Object[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [downloadBase, setDownloadBase] = useState<string | null>(null);
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBuckets = useCallback(async () => {
    setLoadingBuckets(true);
    setError(null);
    try {
      const res = await fetch('/api/bolt-tabs/storage?action=list-buckets');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ListBucketsResponse;
      setBuckets(data.buckets ?? []);
    } catch (err) {
      console.warn('[StorageTab] list buckets failed', err);
      setError(err instanceof Error ? err.message : 'Failed to list buckets');
    } finally {
      setLoadingBuckets(false);
    }
  }, []);

  const loadObjects = useCallback(async () => {
    if (!bucket) {
      setObjects([]);
      setPrefixes([]);
      return;
    }
    setLoadingObjects(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bolt-tabs/storage?bucket=${encodeURIComponent(bucket)}&prefix=${encodeURIComponent(prefix)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ListObjectsResponse;
      setObjects(data.objects ?? []);
      setPrefixes(data.delimited_prefixes ?? []);
      setDownloadBase(data.download_url_base ?? null);
    } catch (err) {
      console.warn('[StorageTab] list objects failed', err);
      setError(err instanceof Error ? err.message : 'Failed to list objects');
    } finally {
      setLoadingObjects(false);
    }
  }, [bucket, prefix]);

  useEffect(() => {
    loadBuckets();
  }, [loadBuckets]);

  useEffect(() => {
    loadObjects();
  }, [loadObjects]);

  const segments = useMemo(() => prefix.split('/').filter(Boolean), [prefix]);

  const goSegment = (idx: number) => {
    const next = segments.slice(0, idx + 1).join('/') + (idx >= 0 ? '/' : '');
    setPrefix(next === '/' ? '' : next);
  };

  const remove = useCallback(
    async (key: string) => {
      if (!bucket || !confirm(`Delete ${key}?`)) return;
      try {
        const res = await fetch(
          `/api/bolt-tabs/storage?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await loadObjects();
      } catch (err) {
        console.warn('[StorageTab] delete failed', err);
        setError(err instanceof Error ? err.message : 'Delete failed');
      }
    },
    [bucket, loadObjects],
  );

  return (
    <div className="flex h-full overflow-hidden bg-bolt-elements-terminals-background">
      <aside className="w-56 flex-shrink-0 border-r border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 flex flex-col">
        <div className="flex items-center gap-2 px-2 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
          <div className="i-ph:cloud-duotone text-lg text-bolt-elements-textSecondary" />
          <span className="text-xs text-bolt-elements-textSecondary font-medium">R2 Buckets</span>
          <IconButton className="ml-auto" icon="i-ph:arrow-clockwise" title="Refresh" size="sm" onClick={loadBuckets} />
        </div>
        <div className="flex-1 overflow-auto">
          {loadingBuckets && (
            <div className="p-2 space-y-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-7 bg-bolt-elements-background-depth-2 animate-pulse rounded" />
              ))}
            </div>
          )}
          {!loadingBuckets && buckets.length === 0 && (
            <div className="p-3 text-xs text-bolt-elements-textTertiary text-center">No buckets.</div>
          )}
          {buckets.map((b) => (
            <button
              key={b.name}
              onClick={() => {
                setBucket(b.name);
                setPrefix('');
              }}
              className={classNames(
                'w-full text-left px-3 py-2 text-sm border-b border-bolt-elements-borderColor truncate',
                bucket === b.name
                  ? 'bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary'
                  : 'text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2',
              )}
            >
              {b.name}
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-xs">
          <button onClick={() => setPrefix('')} className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary">
            {bucket ?? '—'}
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-2">
              <span className="text-bolt-elements-textTertiary">/</span>
              <button
                onClick={() => goSegment(i)}
                className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary truncate max-w-[160px]"
              >
                {seg}
              </button>
            </span>
          ))}
          <IconButton className="ml-auto" icon="i-ph:arrow-clockwise" title="Refresh" size="sm" onClick={loadObjects} />
        </div>

        <div className="flex-1 overflow-auto">
          {error && <div className="m-3 p-3 rounded border border-red-400/30 bg-red-400/10 text-red-300 text-sm">{error}</div>}

          {!bucket && (
            <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary p-6">
              <div className="i-ph:folder-open-duotone text-4xl mb-2 opacity-50" />
              <div className="text-sm">Select a bucket on the left to browse.</div>
            </div>
          )}

          {loadingObjects && (
            <div className="p-3 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-bolt-elements-background-depth-2 animate-pulse rounded" />
              ))}
            </div>
          )}

          {bucket && !loadingObjects && prefixes.length === 0 && objects.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary p-6">
              <div className="i-ph:folder-duotone text-4xl mb-2 opacity-50" />
              <div className="text-sm">This folder is empty.</div>
            </div>
          )}

          {bucket && (prefixes.length > 0 || objects.length > 0) && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bolt-elements-background-depth-2 text-bolt-elements-textTertiary text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Size</th>
                  <th className="text-left px-3 py-2 font-medium">Modified</th>
                  <th className="text-right px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {prefixes.map((p) => {
                  const label = p.replace(prefix, '').replace(/\/$/, '');
                  return (
                    <tr
                      key={p}
                      className="border-t border-bolt-elements-borderColor hover:bg-bolt-elements-background-depth-1 cursor-pointer"
                      onClick={() => setPrefix(p)}
                    >
                      <td className="px-3 py-2 text-bolt-elements-textPrimary flex items-center gap-2">
                        <div className="i-ph:folder-duotone text-yellow-400" />
                        {label}
                      </td>
                      <td className="px-3 py-2 text-bolt-elements-textTertiary text-xs">—</td>
                      <td className="px-3 py-2 text-bolt-elements-textTertiary text-xs">—</td>
                      <td className="px-3 py-2" />
                    </tr>
                  );
                })}
                {objects.map((o) => {
                  const name = o.key.replace(prefix, '');
                  const dl = downloadBase ? `${downloadBase}${encodeURIComponent(o.key)}` : '#';
                  return (
                    <tr key={o.key} className="border-t border-bolt-elements-borderColor hover:bg-bolt-elements-background-depth-1">
                      <td className="px-3 py-2 text-bolt-elements-textPrimary flex items-center gap-2 truncate">
                        <div className="i-ph:file-duotone text-bolt-elements-textTertiary" />
                        {name || o.key}
                      </td>
                      <td className="px-3 py-2 text-bolt-elements-textSecondary text-xs">{fmtSize(o.size)}</td>
                      <td className="px-3 py-2 text-bolt-elements-textTertiary text-xs">{fmtWhen(o.uploaded)}</td>
                      <td className="px-3 py-2 text-right space-x-1">
                        <a
                          href={dl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-1 rounded border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:border-bolt-elements-borderColorActive inline-block"
                        >
                          Download
                        </a>
                        <button
                          onClick={() => remove(o.key)}
                          className="text-xs px-2 py-1 rounded border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-red-400 hover:border-red-400/40"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
});

export default StorageTab;
