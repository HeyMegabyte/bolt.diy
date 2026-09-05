/**
 * @file Data tab — the open project's REAL site data, live.
 *
 * @remarks
 * The embedded editor has no cross-origin projectsites session, so it can't call
 * the authed data API directly. It asks the admin parent frame via the PS_ bridge
 * (`PS_DATA_REQUEST` → admin runs `GET /api/sites/:id/data-overview[/:table]` →
 * `PS_DATA_RESPONSE`), exactly like the publish flow. Shows the site's real
 * platform tables (visitor events, form submissions, snapshots, MCP connections,
 * content store) with live row counts, and browses recent rows on click.
 * Standalone bolt.diy (not embedded) has no site context → a clear prompt.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { isEmbedded, postToParent, onParentMessage } from '~/lib/embed/embedded-mode';
import type { DataOverviewTable, ParentToChildMessage } from '~/lib/embed/embedded-mode';
import {
  iconForTable,
  formatCellValue,
  summarizeTables,
  newCorrelationId,
  columnLabel,
} from './data-panel-logic';
import { classNames } from '~/utils/classNames';

type Status = 'loading' | 'ready' | 'error' | 'standalone';
const REQUEST_TIMEOUT_MS = 12_000;

export const DataPanel = memo(() => {
  const [status, setStatus] = useState<Status>(isEmbedded ? 'loading' : 'standalone');
  const [tables, setTables] = useState<DataOverviewTable[]>([]);
  const [overviewError, setOverviewError] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');

  const overviewCid = useRef<string | null>(null);
  const browseCid = useRef<string | null>(null);
  const overviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestOverview = useCallback(() => {
    if (!isEmbedded) return;
    setStatus('loading');
    setOverviewError('');
    const cid = newCorrelationId();
    overviewCid.current = cid;
    if (overviewTimer.current) clearTimeout(overviewTimer.current);
    overviewTimer.current = setTimeout(() => {
      if (overviewCid.current === cid) {
        setOverviewError('The editor bridge did not respond. Open this project from the projectsites.dev admin.');
        setStatus('error');
      }
    }, REQUEST_TIMEOUT_MS);
    postToParent({ type: 'PS_DATA_REQUEST', correlationId: cid });
  }, []);

  const openTable = useCallback((key: string) => {
    setActive(key);
    setRows([]);
    setColumns([]);
    setBrowseError('');
    setBrowseLoading(true);
    const cid = newCorrelationId(key);
    browseCid.current = cid;
    if (browseTimer.current) clearTimeout(browseTimer.current);
    browseTimer.current = setTimeout(() => {
      if (browseCid.current === cid) {
        setBrowseError('Timed out loading rows.');
        setBrowseLoading(false);
      }
    }, REQUEST_TIMEOUT_MS);
    postToParent({ type: 'PS_DATA_REQUEST', table: key, correlationId: cid });
  }, []);

  // Subscribe to PS_DATA_RESPONSE from the admin parent.
  useEffect(() => {
    if (!isEmbedded) return;
    const off = onParentMessage((msg: ParentToChildMessage) => {
      if (msg.type !== 'PS_DATA_RESPONSE') return;

      // Overview reply (no `table`).
      if (!msg.table && msg.correlationId === overviewCid.current) {
        if (overviewTimer.current) clearTimeout(overviewTimer.current);
        overviewCid.current = null;
        if (msg.error) {
          setOverviewError(msg.error);
          setStatus('error');
          return;
        }
        setTables(msg.data?.tables ?? []);
        setStatus('ready');
        return;
      }

      // Browse reply (matching `table`).
      if (msg.table && msg.correlationId === browseCid.current) {
        if (browseTimer.current) clearTimeout(browseTimer.current);
        browseCid.current = null;
        setBrowseLoading(false);
        if (msg.error) {
          setBrowseError(msg.error);
          return;
        }
        setColumns(msg.data?.columns ?? []);
        setRows(msg.data?.rows ?? []);
      }
    });
    return off;
  }, []);

  // Kick off the first overview request on mount.
  useEffect(() => {
    requestOverview();
    return () => {
      if (overviewTimer.current) clearTimeout(overviewTimer.current);
      if (browseTimer.current) clearTimeout(browseTimer.current);
    };
  }, [requestOverview]);

  const summary = summarizeTables(tables);
  const activeTable = tables.find((t) => t.key === active) ?? null;

  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-1 overflow-y-auto modern-scrollbar">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-bolt-elements-borderColor">
        <div className="i-ph:database-duotone text-xl text-bolt-elements-textSecondary" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Data</h2>
          <p className="text-[10px] text-bolt-elements-textTertiary">
            {status === 'ready'
              ? `${summary.total} tables · ${summary.populated} with data`
              : status === 'loading'
                ? 'Loading live data…'
                : status === 'standalone'
                  ? 'Open from the admin to view live data'
                  : 'Data unavailable'}
          </p>
        </div>
        {status === 'ready' && (
          <button
            type="button"
            onClick={requestOverview}
            className="text-[10px] text-bolt-elements-item-contentAccent hover:underline cursor-pointer flex items-center gap-1"
            title="Refresh"
          >
            <div className="i-ph:arrow-clockwise" /> Refresh
          </button>
        )}
      </div>

      {/* Standalone (not embedded) */}
      {status === 'standalone' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
          <div className="i-ph:plugs text-3xl text-bolt-elements-textTertiary" />
          <p className="text-sm text-bolt-elements-textSecondary">Live data lives with your site</p>
          <p className="text-[11px] text-bolt-elements-textTertiary max-w-xs">
            Open this project from your projectsites.dev admin dashboard to browse its real visitor
            events, form submissions, snapshots and more.
          </p>
        </div>
      )}

      {/* Loading */}
      {status === 'loading' && (
        <div className="p-3 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-14 rounded-lg bg-bolt-elements-background-depth-2 animate-pulse border border-bolt-elements-borderColor/40"
            />
          ))}
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="i-ph:warning-circle-duotone text-3xl text-red-400" />
          <p className="text-sm text-bolt-elements-textSecondary">{overviewError || 'Could not load data.'}</p>
          <button
            type="button"
            onClick={requestOverview}
            className="px-3 py-1.5 rounded-md text-xs bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 cursor-pointer flex items-center gap-1.5"
          >
            <div className="i-ph:arrow-clockwise" /> Try again
          </button>
        </div>
      )}

      {/* Overview — table cards */}
      {status === 'ready' && !active && (
        <div className="p-3 space-y-2">
          {tables.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => t.browsable && openTable(t.key)}
              disabled={!t.browsable}
              className={classNames(
                'w-full text-left border border-bolt-elements-borderColor/50 rounded-lg bg-bolt-elements-background-depth-2 px-3 py-2.5 flex items-center gap-3 transition-colors',
                t.browsable
                  ? 'hover:border-bolt-elements-item-contentAccent/40 hover:bg-bolt-elements-background-depth-3 cursor-pointer'
                  : 'opacity-70 cursor-default',
              )}
            >
              <div className={classNames(iconForTable(t.key), 'text-xl text-bolt-elements-textSecondary')} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-bolt-elements-textPrimary">{t.label}</div>
                <div className="text-[10px] text-bolt-elements-textTertiary truncate">{t.description}</div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={classNames(
                    'px-1.5 py-px rounded-full text-[10px] font-medium tabular-nums border',
                    t.row_count > 0
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-bolt-elements-background-depth-1 text-bolt-elements-textTertiary border-bolt-elements-borderColor',
                  )}
                >
                  {t.row_count.toLocaleString()} {t.row_count === 1 ? 'row' : 'rows'}
                </span>
                {t.browsable && t.row_count > 0 && (
                  <div className="i-ph:caret-right text-bolt-elements-textTertiary" />
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Browse — one table's recent rows */}
      {status === 'ready' && active && activeTable && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor/50">
            <button
              type="button"
              onClick={() => setActive(null)}
              className="text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary cursor-pointer flex items-center gap-1 text-xs"
              title="Back to tables"
            >
              <div className="i-ph:arrow-left" /> Tables
            </button>
            <span className="text-sm font-medium text-bolt-elements-textPrimary">{activeTable.label}</span>
            <span className="text-[10px] text-bolt-elements-textTertiary">
              {activeTable.row_count.toLocaleString()} total · showing latest {Math.min(activeTable.row_count, 25)}
            </span>
          </div>

          {browseLoading && (
            <div className="p-3 space-y-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-7 rounded bg-bolt-elements-background-depth-2 animate-pulse" />
              ))}
            </div>
          )}

          {!browseLoading && browseError && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <div className="i-ph:warning-circle-duotone text-2xl text-red-400" />
              <p className="text-xs text-bolt-elements-textSecondary">{browseError}</p>
              <button
                type="button"
                onClick={() => openTable(active)}
                className="text-[11px] text-bolt-elements-item-contentAccent hover:underline cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {!browseLoading && !browseError && rows.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <div className={classNames(iconForTable(active), 'text-2xl text-bolt-elements-textTertiary')} />
              <p className="text-xs text-bolt-elements-textSecondary">No rows yet</p>
              <p className="text-[10px] text-bolt-elements-textTertiary">
                Rows appear here as your site collects {activeTable.label.toLowerCase()}.
              </p>
            </div>
          )}

          {!browseLoading && !browseError && rows.length > 0 && (
            <div className="flex-1 overflow-auto modern-scrollbar">
              <table className="w-full text-[11px] border-collapse">
                <thead className="sticky top-0 bg-bolt-elements-background-depth-2">
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c}
                        className="text-left font-medium text-bolt-elements-textTertiary px-3 py-1.5 border-b border-bolt-elements-borderColor/50 whitespace-nowrap"
                      >
                        {columnLabel(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      className="border-b border-bolt-elements-borderColor/20 hover:bg-bolt-elements-background-depth-2/50"
                    >
                      {columns.map((c) => (
                        <td
                          key={c}
                          className="px-3 py-1.5 text-bolt-elements-textSecondary align-top max-w-[220px] truncate"
                          title={formatCellValue(r[c])}
                        >
                          {formatCellValue(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

DataPanel.displayName = 'DataPanel';
