/**
 * @file Data tab — high-level resource health overview.
 *
 * @remarks
 * Shows SQLite, Postgres, Redis, KV, and R2/media status at a glance.
 * Links to the relevant bottom-panel tab for detailed management.
 * Never duplicates full database-console functionality here.
 */
import React, { memo, useCallback } from 'react';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

interface ResourceCard {
  id: string;
  name: string;
  type: 'sqlite' | 'postgres' | 'redis' | 'kv' | 'r2';
  mode: 'mock' | 'local' | 'preview' | 'remote';
  status: 'healthy' | 'warning' | 'error' | 'offline';
  detail: string;
  bottomTab: string;
}

const RESOURCES: ResourceCard[] = [
  {
    id: 'bricklabor_sqlite',
    name: 'SQLite / D1',
    type: 'sqlite',
    mode: 'local',
    status: 'healthy',
    detail: '2 tables · bookings, contacts · 0 rows',
    bottomTab: 'SQLite',
  },
  {
    id: 'bricklabor_pg',
    name: 'Postgres (Neon)',
    type: 'postgres',
    mode: 'local',
    status: 'healthy',
    detail: 'Project: jolly-pine-24431114 · pooled',
    bottomTab: 'Postgres',
  },
  {
    id: 'bricklabor_redis',
    name: 'Redis (Upstash)',
    type: 'redis',
    mode: 'local',
    status: 'healthy',
    detail: 'Prefix: bricklabor: · 4 keys',
    bottomTab: 'Redis',
  },
  {
    id: 'bricklabor_kv',
    name: 'KV',
    type: 'kv',
    mode: 'local',
    status: 'healthy',
    detail: '1 namespace · 0 entries',
    bottomTab: 'KV',
  },
  {
    id: 'bricklabor_media',
    name: 'R2 Media',
    type: 'r2',
    mode: 'local',
    status: 'healthy',
    detail: '5 assets · 10.0 MB total',
    bottomTab: '—',
  },
];

const STATUS_COLORS: Record<ResourceCard['status'], string> = {
  healthy: 'bg-green-500/10 text-green-400 border-green-500/20',
  warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  offline: 'bg-bolt-elements-background-depth-2 text-bolt-elements-textTertiary border-bolt-elements-borderColor',
};

const STATUS_ICONS: Record<ResourceCard['status'], string> = {
  healthy: 'i-ph:check-circle',
  warning: 'i-ph:warning',
  error: 'i-ph:x-circle',
  offline: 'i-ph:minus-circle',
};

const TYPE_ICONS: Record<ResourceCard['type'], string> = {
  sqlite: 'i-ph:database-duotone',
  postgres: 'i-ph:cylinder-duotone',
  redis: 'i-ph:stack-duotone',
  kv: 'i-ph:cube-duotone',
  r2: 'i-ph:cloud-duotone',
};

const MODE_LABELS: Record<ResourceCard['mode'], string> = {
  mock: 'Mock',
  local: 'Local',
  preview: 'Preview',
  remote: 'Remote',
};

export const DataPanel = memo(() => {
  const openBottomTab = useCallback((tabLabel: string) => {
    // Open bottom panel — user clicks the target tab
    workbenchStore.toggleTerminal(true);

    // Future: dispatch event to switch to specific bottom tab
    void tabLabel;
  }, []);

  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-1 overflow-y-auto modern-scrollbar">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-bolt-elements-borderColor">
        <div className="i-ph:chart-bar-duotone text-xl text-bolt-elements-textSecondary" />
        <div>
          <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Data Overview</h2>
          <p className="text-[10px] text-bolt-elements-textTertiary">
            {RESOURCES.length} resources · {RESOURCES.filter((r) => r.status === 'healthy').length} healthy
          </p>
        </div>
      </div>

      {/* Resource cards */}
      <div className="p-3 space-y-2">
        {RESOURCES.map((r) => (
          <div
            key={r.id}
            className="border border-bolt-elements-borderColor/50 rounded-lg bg-bolt-elements-background-depth-2 overflow-hidden"
          >
            {/* Card header */}
            <div className="flex items-center gap-3 px-3 py-2.5">
              <div className={classNames(TYPE_ICONS[r.type], 'text-xl text-bolt-elements-textSecondary')} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-bolt-elements-textPrimary">{r.name}</span>
                  <span
                    className={classNames(
                      'px-1.5 py-px rounded-full text-[9px] font-medium border',
                      STATUS_COLORS[r.status],
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      <div className={STATUS_ICONS[r.status]} />
                      {r.status}
                    </span>
                  </span>
                </div>
                <div className="text-[10px] text-bolt-elements-textTertiary mt-0.5">{r.detail}</div>
              </div>
              <span className="text-[10px] text-bolt-elements-textTertiary uppercase tracking-wider">
                {MODE_LABELS[r.mode]}
              </span>
            </div>

            {/* Card footer */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-t border-bolt-elements-borderColor/30 bg-bolt-elements-background-depth-1/50">
              <div className="flex-1 grid grid-cols-3 gap-2 text-[10px]">
                <div>
                  <span className="text-bolt-elements-textTertiary">Migrations: </span>
                  <span className="text-green-400">up to date</span>
                </div>
                <div>
                  <span className="text-bolt-elements-textTertiary">Snapshots: </span>
                  <span className="text-bolt-elements-textSecondary">0 stored</span>
                </div>
                <div>
                  <span className="text-bolt-elements-textTertiary">Exports: </span>
                  <span className="text-bolt-elements-textSecondary">0 stored</span>
                </div>
              </div>
              {r.bottomTab !== '—' && (
                <button
                  type="button"
                  onClick={() => openBottomTab(r.bottomTab)}
                  className="text-[10px] text-bolt-elements-item-contentAccent whitespace-nowrap hover:underline cursor-pointer"
                  title={`Open ${r.bottomTab} in bottom panel`}
                >
                  Open {r.bottomTab} →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Summary footer */}
      <div className="mt-auto border-t border-bolt-elements-borderColor/50 px-4 py-2.5 space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-bolt-elements-textTertiary">Environment mode</span>
          <span className="text-bolt-elements-textPrimary font-mono">local</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-bolt-elements-textTertiary">Binding validation</span>
          <span className="text-green-400 flex items-center gap-1">
            <div className="i-ph:check-circle" /> All valid
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-bolt-elements-textTertiary">Last backup</span>
          <span className="text-bolt-elements-textSecondary">—</span>
        </div>
      </div>
    </div>
  );
});

DataPanel.displayName = 'DataPanel';
