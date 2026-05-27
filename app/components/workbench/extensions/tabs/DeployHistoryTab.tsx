/**
 * @file DeployHistoryTab — Cloudflare Workers deploy history + rollback.
 *
 * @remarks
 * Lists the last 20 deployments for a worker/project and lets the user
 * roll back to a prior version. Fetches `GET /api/bolt-tabs/deploy` and
 * POSTs `{ deployment_id, action: 'rollback' }` for rollback. Optimistic
 * UI: rollback row immediately shows a "rolling back…" state then re-syncs
 * with the server response.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';

interface DeployRow {
  id: string;
  version: string;
  environment: string;
  status: 'success' | 'failed' | 'building' | 'rolled_back' | 'rolling_back';
  created_at: string;
  trigger?: string;
}

interface DeployResponse {
  deployments: DeployRow[];
}

const STATUS_TONE: Record<DeployRow['status'], string> = {
  success: 'text-green-400 bg-green-400/10 border-green-400/20',
  failed: 'text-red-400 bg-red-400/10 border-red-400/20',
  building: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  rolled_back: 'text-bolt-elements-textTertiary bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor',
  rolling_back: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
};

function formatWhen(iso: string): string {
  try {
    const date = new Date(iso);
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return date.toLocaleDateString();
  } catch {
    return iso;
  }
}

const DeployHistoryTab = memo(function DeployHistoryTab() {
  const [project, setProject] = useState('');
  const [rows, setRows] = useState<DeployRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!project.trim()) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bolt-tabs/deploy?project=${encodeURIComponent(project.trim())}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DeployResponse;
      setRows(data.deployments ?? []);
    } catch (err) {
      console.warn('[DeployHistoryTab] fetch failed', err);
      setError(err instanceof Error ? err.message : 'Failed to load deploy history');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    if (project.trim()) fetchHistory();
  }, [project, fetchHistory]);

  const rollback = useCallback(
    async (deploymentId: string) => {
      setRows((prev) => prev.map((r) => (r.id === deploymentId ? { ...r, status: 'rolling_back' } : r)));
      try {
        const res = await fetch('/api/bolt-tabs/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deployment_id: deploymentId, action: 'rollback' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchHistory();
      } catch (err) {
        console.warn('[DeployHistoryTab] rollback failed', err);
        setError(err instanceof Error ? err.message : 'Rollback failed');
        await fetchHistory();
      }
    },
    [fetchHistory],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bolt-elements-terminals-background">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
        <div className="i-ph:rocket-launch-duotone text-lg text-bolt-elements-textSecondary" />
        <input
          className="flex-1 max-w-xs bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary text-sm px-2 py-1 rounded border border-bolt-elements-borderColor focus:outline-none focus:border-bolt-elements-borderColorActive"
          placeholder="project / worker name"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchHistory()}
        />
        <IconButton icon="i-ph:arrow-clockwise" title="Refresh" size="md" onClick={fetchHistory} disabled={loading} />
      </div>

      <div className="flex-1 overflow-auto">
        {error && (
          <div className="m-3 p-3 rounded border border-red-400/30 bg-red-400/10 text-red-300 text-sm">{error}</div>
        )}

        {loading && rows.length === 0 && (
          <div className="p-3 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-9 bg-bolt-elements-background-depth-2 animate-pulse rounded" />
            ))}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-bolt-elements-textTertiary p-6">
            <div className="i-ph:rocket-duotone text-4xl mb-2 opacity-50" />
            <div className="text-sm">No deployments yet.</div>
            <div className="text-xs mt-1">Enter a project name above to load its deploy history.</div>
          </div>
        )}

        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bolt-elements-background-depth-2 text-bolt-elements-textTertiary text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Version</th>
                <th className="text-left px-3 py-2 font-medium">Environment</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Created</th>
                <th className="text-right px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-bolt-elements-borderColor hover:bg-bolt-elements-background-depth-1"
                >
                  <td className="px-3 py-2 font-mono text-xs text-bolt-elements-textPrimary">{row.version}</td>
                  <td className="px-3 py-2 text-bolt-elements-textSecondary">{row.environment}</td>
                  <td className="px-3 py-2">
                    <span
                      className={classNames(
                        'inline-block px-2 py-0.5 rounded-full text-xs border',
                        STATUS_TONE[row.status],
                      )}
                    >
                      {row.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-bolt-elements-textTertiary text-xs">{formatWhen(row.created_at)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      disabled={row.status === 'rolling_back' || row.status === 'building'}
                      onClick={() => rollback(row.id)}
                      className="text-xs px-2 py-1 rounded border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:border-bolt-elements-borderColorActive disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Rollback
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});

export default DeployHistoryTab;
