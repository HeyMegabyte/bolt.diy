/**
 * @file SqlTab — D1 SQL console (database list + ad-hoc query runner).
 *
 * @remarks
 * Left sidebar lists D1 databases for the current account via
 * `GET /api/bolt-tabs/sql?account=...`. Selecting one populates the right
 * pane: a textarea editor + Run button + results panel below. POSTs
 * `{ database_id, sql }` to `/api/bolt-tabs/sql`. SELECT-shaped results
 * render as a table; non-SELECT shows a status line (rows_written /
 * rows_read / duration).
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';

interface D1Database {
  uuid: string;
  name: string;
  version?: string;
}

interface DatabaseListResponse {
  databases: D1Database[];
}

interface SqlSuccess {
  ok: true;
  results?: Record<string, unknown>[];
  meta?: {
    rows_read?: number;
    rows_written?: number;
    duration?: number;
    changed_db?: boolean;
  };
}

interface SqlFailure {
  ok: false;
  error: string;
}

type SqlResponse = SqlSuccess | SqlFailure;

const SqlTab = memo(function SqlTab() {
  const [account, setAccount] = useState('');
  const [databases, setDatabases] = useState<D1Database[]>([]);
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [sql, setSql] = useState('SELECT name FROM sqlite_master WHERE type = \'table\' LIMIT 50;');
  const [result, setResult] = useState<SqlResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDatabases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = account.trim() ? `?account=${encodeURIComponent(account.trim())}` : '';
      const res = await fetch(`/api/bolt-tabs/sql${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DatabaseListResponse;
      setDatabases(data.databases ?? []);
    } catch (err) {
      console.warn('[SqlTab] list databases failed', err);
      setError(err instanceof Error ? err.message : 'Failed to load databases');
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    loadDatabases();
  }, [loadDatabases]);

  const runQuery = useCallback(async () => {
    if (!selectedDb || !sql.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/bolt-tabs/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database_id: selectedDb, sql }),
      });
      const data = (await res.json()) as SqlResponse;
      setResult(data);
    } catch (err) {
      console.warn('[SqlTab] run query failed', err);
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    } finally {
      setRunning(false);
    }
  }, [selectedDb, sql]);

  const columns = useMemo<string[]>(() => {
    if (!result || !result.ok || !result.results || result.results.length === 0) return [];
    return Object.keys(result.results[0]);
  }, [result]);

  return (
    <div className="flex h-full overflow-hidden bg-bolt-elements-terminals-background">
      <aside className="w-64 flex-shrink-0 border-r border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 flex flex-col">
        <div className="flex items-center gap-2 px-2 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
          <div className="i-ph:database-duotone text-lg text-bolt-elements-textSecondary" />
          <input
            className="flex-1 bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary text-xs px-2 py-1 rounded border border-bolt-elements-borderColor focus:outline-none"
            placeholder="account id (optional)"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
          <IconButton icon="i-ph:arrow-clockwise" title="Refresh" size="sm" onClick={loadDatabases} />
        </div>
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="p-2 space-y-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-7 bg-bolt-elements-background-depth-2 animate-pulse rounded" />
              ))}
            </div>
          )}
          {!loading && databases.length === 0 && !error && (
            <div className="p-3 text-xs text-bolt-elements-textTertiary text-center">No D1 databases found.</div>
          )}
          {databases.map((db) => (
            <button
              key={db.uuid}
              onClick={() => setSelectedDb(db.uuid)}
              className={classNames(
                'w-full text-left px-3 py-2 text-sm border-b border-bolt-elements-borderColor truncate',
                selectedDb === db.uuid
                  ? 'bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary'
                  : 'text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2',
              )}
              title={db.uuid}
            >
              <div className="truncate">{db.name}</div>
              <div className="font-mono text-[10px] text-bolt-elements-textTertiary truncate">{db.uuid}</div>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        {error && (
          <div className="m-3 p-3 rounded border border-red-400/30 bg-red-400/10 text-red-300 text-sm">{error}</div>
        )}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
          <span className="text-xs text-bolt-elements-textTertiary">
            {selectedDb ? `Database: ${selectedDb.slice(0, 8)}…` : 'Select a database to begin'}
          </span>
          <button
            onClick={runQuery}
            disabled={!selectedDb || running || !sql.trim()}
            className="ml-auto text-xs px-3 py-1.5 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary hover:border-bolt-elements-borderColorActive disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <div className={classNames('i-ph:play-duotone', running && 'animate-pulse')} />
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          spellCheck={false}
          className="h-40 resize-none bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary font-mono text-sm p-3 outline-none border-b border-bolt-elements-borderColor"
          placeholder="SELECT * FROM ..."
        />
        <div className="flex-1 overflow-auto">
          {!result && (
            <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary p-6">
              <div className="i-ph:table-duotone text-4xl mb-2 opacity-50" />
              <div className="text-sm">Run a query to see results.</div>
            </div>
          )}
          {result && !result.ok && (
            <div className="m-3 p-3 rounded border border-red-400/30 bg-red-400/10 text-red-300 text-sm whitespace-pre-wrap font-mono">
              {result.error}
            </div>
          )}
          {result && result.ok && columns.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bolt-elements-background-depth-2 text-bolt-elements-textTertiary uppercase tracking-wide">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="text-left px-3 py-2 font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.results!.map((row, i) => (
                  <tr key={i} className="border-t border-bolt-elements-borderColor">
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-1.5 font-mono text-bolt-elements-textSecondary">{String(row[c] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result && result.ok && columns.length === 0 && (
            <div className="m-3 p-3 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-bolt-elements-textSecondary text-sm font-mono">
              OK — rows_read={result.meta?.rows_read ?? 0} · rows_written={result.meta?.rows_written ?? 0} · {result.meta?.duration ?? 0}ms
            </div>
          )}
        </div>
      </main>
    </div>
  );
});

export default SqlTab;
