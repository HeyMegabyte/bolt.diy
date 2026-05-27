/**
 * @file CICDTab — GitHub Actions runs viewer with re-run / cancel.
 *
 * @remarks
 * Lists the last 20 workflow runs for an `owner/repo` via
 * `GET /api/bolt-tabs/cicd`. Re-run + cancel buttons POST to the same
 * endpoint with `{ run_id, action: 're-run' | 'cancel' }`. Status badge
 * colors mirror GitHub's conclusion palette.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';

type RunStatus = 'queued' | 'in_progress' | 'completed';
type RunConclusion = 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral' | null;

interface RunRow {
  id: number;
  workflow_name: string;
  run_number: number;
  branch: string;
  status: RunStatus;
  conclusion: RunConclusion;
  trigger: string;
  duration_seconds: number | null;
  created_at: string;
}

interface CICDResponse {
  runs: RunRow[];
}

const CONCLUSION_TONE: Record<string, string> = {
  success: 'text-green-400 bg-green-400/10 border-green-400/20',
  failure: 'text-red-400 bg-red-400/10 border-red-400/20',
  cancelled: 'text-bolt-elements-textTertiary bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor',
  skipped: 'text-bolt-elements-textTertiary bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor',
  neutral: 'text-bolt-elements-textSecondary bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor',
  queued: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  in_progress: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
};

function formatDuration(s: number | null): string {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function formatWhen(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

const CICDTab = memo(function CICDTab() {
  const [slug, setSlug] = useState('');
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const { owner, repo } = useMemo(() => {
    const [o = '', r = ''] = slug.trim().split('/');
    return { owner: o, repo: r };
  }, [slug]);

  const fetchRuns = useCallback(async () => {
    if (!owner || !repo) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bolt-tabs/cicd?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CICDResponse;
      setRows(data.runs ?? []);
    } catch (err) {
      console.warn('[CICDTab] fetch failed', err);
      setError(err instanceof Error ? err.message : 'Failed to load workflow runs');
    } finally {
      setLoading(false);
    }
  }, [owner, repo]);

  useEffect(() => {
    if (owner && repo) fetchRuns();
  }, [owner, repo, fetchRuns]);

  const act = useCallback(
    async (runId: number, action: 're-run' | 'cancel') => {
      setBusyIds((p) => new Set(p).add(runId));
      try {
        const res = await fetch('/api/bolt-tabs/cicd', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ owner, repo, run_id: runId, action }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchRuns();
      } catch (err) {
        console.warn(`[CICDTab] ${action} failed`, err);
        setError(err instanceof Error ? err.message : `${action} failed`);
      } finally {
        setBusyIds((p) => {
          const n = new Set(p);
          n.delete(runId);
          return n;
        });
      }
    },
    [owner, repo, fetchRuns],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bolt-elements-terminals-background">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
        <div className="i-ph:git-branch-duotone text-lg text-bolt-elements-textSecondary" />
        <input
          className="flex-1 max-w-sm bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary text-sm px-2 py-1 rounded border border-bolt-elements-borderColor focus:outline-none focus:border-bolt-elements-borderColorActive"
          placeholder="owner/repo"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchRuns()}
        />
        <IconButton icon="i-ph:arrow-clockwise" title="Refresh" size="md" onClick={fetchRuns} disabled={loading} />
      </div>

      <div className="flex-1 overflow-auto">
        {error && <div className="m-3 p-3 rounded border border-red-400/30 bg-red-400/10 text-red-300 text-sm">{error}</div>}

        {loading && rows.length === 0 && (
          <div className="p-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 bg-bolt-elements-background-depth-2 animate-pulse rounded" />
            ))}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-bolt-elements-textTertiary p-6">
            <div className="i-ph:git-pull-request-duotone text-4xl mb-2 opacity-50" />
            <div className="text-sm">No workflow runs.</div>
            <div className="text-xs mt-1">Enter an `owner/repo` slug to see GitHub Actions.</div>
          </div>
        )}

        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bolt-elements-background-depth-2 text-bolt-elements-textTertiary text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Workflow</th>
                <th className="text-left px-3 py-2 font-medium">Run</th>
                <th className="text-left px-3 py-2 font-medium">Branch</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Trigger</th>
                <th className="text-left px-3 py-2 font-medium">Duration</th>
                <th className="text-left px-3 py-2 font-medium">Created</th>
                <th className="text-right px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const badge = r.status === 'completed' && r.conclusion ? r.conclusion : r.status;
                const busy = busyIds.has(r.id);
                return (
                  <tr key={r.id} className="border-t border-bolt-elements-borderColor hover:bg-bolt-elements-background-depth-1">
                    <td className="px-3 py-2 text-bolt-elements-textPrimary">{r.workflow_name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-bolt-elements-textSecondary">#{r.run_number}</td>
                    <td className="px-3 py-2 text-bolt-elements-textSecondary">{r.branch}</td>
                    <td className="px-3 py-2">
                      <span className={classNames('inline-block px-2 py-0.5 rounded-full text-xs border', CONCLUSION_TONE[badge] ?? CONCLUSION_TONE.neutral)}>
                        {badge.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-bolt-elements-textTertiary text-xs">{r.trigger}</td>
                    <td className="px-3 py-2 text-bolt-elements-textTertiary text-xs">{formatDuration(r.duration_seconds)}</td>
                    <td className="px-3 py-2 text-bolt-elements-textTertiary text-xs">{formatWhen(r.created_at)}</td>
                    <td className="px-3 py-2 text-right space-x-1">
                      <button
                        disabled={busy || r.status === 'in_progress'}
                        onClick={() => act(r.id, 're-run')}
                        className="text-xs px-2 py-1 rounded border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:border-bolt-elements-borderColorActive disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Re-run
                      </button>
                      <button
                        disabled={busy || r.status === 'completed'}
                        onClick={() => act(r.id, 'cancel')}
                        className="text-xs px-2 py-1 rounded border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-red-400 hover:border-red-400/40 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});

export default CICDTab;
