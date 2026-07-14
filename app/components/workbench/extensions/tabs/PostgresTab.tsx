/**
 * @file Postgres tab — Neon connection profiles, query console, schema explorer.
 *
 * @remarks
 * Neon-only Postgres management. Connection profiles use Neon project IDs,
 * branch IDs, and pooled connection strings. Credentials are always redacted.
 * Never exports passwords, tokens, or full private connection URLs.
 * Supports local/mock mode now, Neon serverless driver later.
 */
import React, { memo, useState } from 'react';
import { classNames } from '~/utils/classNames';

interface NeonConnectionProfile {
  id: string;
  label: string;
  neonProjectId: string;
  neonBranchId: string;
  database: string;
  role: string;
  pooled: boolean;
  mode: 'mock' | 'local' | 'preview' | 'remote';
}

const MOCK_PROFILES: NeonConnectionProfile[] = [
  {
    id: 'bricklabor-neon',
    label: 'BrickLabor — Neon',
    neonProjectId: 'jolly-pine-24431114',
    neonBranchId: 'br-bricklabor-dev',
    database: 'bricklabor_dev',
    role: 'neondb_owner',
    pooled: true,
    mode: 'local',
  },
];

const PostgresTab = memo(() => {
  const [activeProfile] = useState<NeonConnectionProfile | null>(MOCK_PROFILES[0] ?? null);
  const [sql, setSql] = useState('SELECT 1;');
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [running, setRunning] = useState(false);

  const runQuery = async () => {
    setRunning(true);
    // In mock mode, simulate a query result
    await new Promise((r) => setTimeout(r, 300));
    setResults([{ '?column?': 1 }]);
    setRunning(false);
  };

  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-1">
      {/* Profile bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor text-xs">
        <div className="i-ph:cylinder-duotone text-bolt-elements-textSecondary" />
        <select
          className="bg-transparent text-bolt-elements-textPrimary text-xs border border-bolt-elements-borderColor rounded px-2 py-0.5"
          value={activeProfile?.id ?? ''}
          onChange={() => {}}
        >
          {MOCK_PROFILES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({p.mode})
            </option>
          ))}
        </select>
        <span className="ml-auto text-bolt-elements-textTertiary text-[10px] uppercase tracking-wider">
          {activeProfile?.pooled ? 'pooled' : 'direct'} · {activeProfile?.mode ?? 'mock'}
        </span>
      </div>

      {/* Neon project info */}
      {activeProfile && (
        <div className="flex items-center gap-4 px-3 py-1.5 border-b border-bolt-elements-borderColor/50 text-[10px] text-bolt-elements-textTertiary font-mono">
          <span>Project: {activeProfile.neonProjectId}</span>
          <span>Branch: {activeProfile.neonBranchId}</span>
          <span>Role: {activeProfile.role}</span>
        </div>
      )}

      {/* SQL editor */}
      <div className="px-3 pt-2">
        <textarea
          className="w-full bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary text-xs font-mono border border-bolt-elements-borderColor rounded p-2 resize-none focus:outline-none focus:border-bolt-elements-borderColorActive"
          rows={4}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          spellCheck={false}
        />
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={runQuery}
            disabled={running}
            className={classNames(
              'px-3 py-1 text-xs rounded transition-colors',
              'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent',
              'hover:bg-bolt-elements-item-backgroundActive',
              running && 'opacity-50',
            )}
          >
            {running ? 'Running…' : 'Run Query'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto modern-scrollbar px-3 py-2">
        {results ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-bolt-elements-borderColor">
                  {Object.keys(results[0] ?? {}).map((col) => (
                    <th key={col} className="text-left px-2 py-1 text-bolt-elements-textSecondary font-medium">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((row, i) => (
                  <tr key={i} className="border-b border-bolt-elements-borderColor/50 hover:bg-bolt-elements-item-backgroundActive">
                    {Object.values(row).map((val, j) => (
                      <td key={j} className="px-2 py-1 text-bolt-elements-textPrimary">
                        {String(val)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary text-sm gap-2">
            <div className="i-ph:database-duotone text-3xl" />
            <span>Run a query to see results</span>
            <span className="text-[10px]">Postgres tab — local/mock adapter active</span>
          </div>
        )}
      </div>
    </div>
  );
});

PostgresTab.displayName = 'PostgresTab';

export default PostgresTab;
