/**
 * @file Functions tab — Cloudflare Pages Functions / Workers-for-Platforms manager.
 *
 * @remarks
 * Reads the OPEN project's real `functions/` folder from the workbench file store
 * (nanostore) and renders the route table + bindings derived live by
 * `functions-panel-logic.ts` — one entry per Pages Function
 * (`functions/api/contact.ts` → `/api/contact`), methods parsed from the
 * `onRequest{Get,Post,…}` exports, bindings from `wrangler.jsonc`/`.toml`. NOTHING
 * is mocked — an empty `functions/` folder renders an honest empty state.
 * (Replaced the old hardcoded MOCK_ROUTES/MOCK_BINDINGS — AL-004, 2026-09-05.)
 */
import React, { memo, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import { classNames } from '~/utils/classNames';
import { deriveRoutes, deriveWrangler, hasFunctionsFolder, scaffoldFunction, FUNCTIONS_DIR } from './functions-panel-logic';

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-500 bg-green-500/10',
  POST: 'text-blue-500 bg-blue-500/10',
  PUT: 'text-yellow-500 bg-yellow-500/10',
  PATCH: 'text-orange-500 bg-orange-500/10',
  DELETE: 'text-red-500 bg-red-500/10',
  ALL: 'text-purple-400 bg-purple-500/10',
};

const TYPE_ICONS: Record<string, string> = {
  d1: 'i-ph:database',
  sqlite: 'i-ph:database',
  r2: 'i-ph:cloud',
  kv: 'i-ph:cube',
  redis: 'i-ph:stack',
  secret: 'i-ph:key',
  service: 'i-ph:plugs-connected',
  env: 'i-ph:gear',
};

export const FunctionsPanel = memo(() => {
  const files = useStore(workbenchStore.files);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);

  const { routes, bindings, script, compatDate, hasFunctions } = useMemo(() => {
    const wr = deriveWrangler(files);
    const resourceNames = new Set(wr.bindings.map((b) => b.name));
    return {
      routes: deriveRoutes(files, resourceNames),
      bindings: wr.bindings,
      script: wr.script,
      compatDate: wr.compatDate,
      hasFunctions: hasFunctionsFolder(files),
    };
  }, [files]);

  const active = routes.find((r) => r.path === selectedRoute) ?? null;

  // "Create a function" control (item-8 Brian directive): scaffold a real
  // functions/ file via workbenchStore.createFile — the derived route table
  // picks it up live + it deploys with the site. Not a mock/stub.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');

  const submitNewFunction = async () => {
    const result = scaffoldFunction(newName, files);
    if ('error' in result) {
      setCreateError(result.error);
      return;
    }
    const created = await workbenchStore.createFile(result.path, result.content);
    if (!created) {
      setCreateError('Could not create the file — open a project first.');
      return;
    }
    setCreating(false);
    setNewName('');
    setCreateError('');
    setSelectedRoute(result.route); // reveal the new route in the panel
  };

  const cancelNewFunction = () => {
    setCreating(false);
    setNewName('');
    setCreateError('');
  };

  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-1">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-bolt-elements-borderColor">
        <div className="i-ph:lightning-duotone text-xl text-bolt-elements-textSecondary" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Functions</h2>
          <p className="text-[10px] text-bolt-elements-textTertiary truncate">
            {hasFunctions
              ? `${routes.length} route${routes.length === 1 ? '' : 's'} · ${bindings.length} binding${bindings.length === 1 ? '' : 's'}`
              : 'Cloudflare Pages Functions'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {hasFunctions && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">
              {routes.length > 0 ? 'deploy ready' : 'no routes'}
            </span>
          )}
          <button
            type="button"
            onClick={() => (creating ? cancelNewFunction() : (setCreating(true), setCreateError('')))}
            data-testid="functions-new-btn"
            title="Scaffold a new Pages Function"
            className="text-[10px] font-medium px-2 py-1 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-item-contentAccent hover:bg-bolt-elements-background-depth-3 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <div className={classNames('i-ph:plus transition-transform', creating && 'rotate-45')} /> New
          </button>
        </div>
      </div>

      {/* Create-a-function inline form (shown in both empty + populated states). */}
      {creating && (
        <div className="border-b border-bolt-elements-borderColor/50 px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-bolt-elements-textTertiary font-mono shrink-0">functions/</span>
            <input
              autoFocus
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setCreateError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNewFunction();
                if (e.key === 'Escape') cancelNewFunction();
              }}
              placeholder="api/contact"
              data-testid="functions-new-input"
              spellCheck={false}
              className="flex-1 min-w-0 bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor rounded px-2 py-1 text-xs font-mono text-bolt-elements-textPrimary focus:outline-none focus:border-bolt-elements-item-contentAccent"
            />
            <button
              type="button"
              onClick={submitNewFunction}
              data-testid="functions-new-create"
              className="text-[10px] font-medium px-2.5 py-1 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-item-contentAccent hover:bg-bolt-elements-background-depth-3 shrink-0 cursor-pointer"
            >
              Create
            </button>
          </div>
          {createError ? (
            <p className="text-[10px] text-red-400" data-testid="functions-new-error">
              {createError}
            </p>
          ) : (
            <p className="text-[10px] text-bolt-elements-textTertiary">
              Creates <code className="font-mono">functions/….ts</code> with an{' '}
              <code className="font-mono">onRequestGet</code> handler — a live route on deploy.
            </p>
          )}
        </div>
      )}

      {!hasFunctions ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
          <div className="i-ph:lightning text-3xl text-bolt-elements-textTertiary" />
          <p className="text-xs text-bolt-elements-textSecondary">
            No <code className="font-mono">functions/</code> folder yet
          </p>
          <p className="text-[10px] text-bolt-elements-textTertiary max-w-[220px]">
            Add a <code className="font-mono">functions/api/hello.ts</code> exporting{' '}
            <code className="font-mono">onRequestGet</code> — it becomes a live{' '}
            <code className="font-mono">/api/hello</code> endpoint on deploy.
          </p>
          {!creating && (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setCreateError('');
              }}
              data-testid="functions-new-empty-btn"
              className="mt-2 text-[11px] font-medium px-3 py-1.5 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-item-contentAccent hover:bg-bolt-elements-background-depth-3 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <div className="i-ph:plus" /> New function
            </button>
          )}
        </div>
      ) : (
        <>
          {/* WFP metadata — derived from wrangler when present */}
          <div className="grid grid-cols-3 gap-px bg-bolt-elements-borderColor/30 text-[10px]">
            {[
              ['Platform', 'Pages Functions'],
              ['Compat Date', compatDate ?? '—'],
              ['Script', script ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="bg-bolt-elements-background-depth-1 px-3 py-1.5 min-w-0">
                <div className="text-bolt-elements-textTertiary uppercase">{label}</div>
                <div className="text-bolt-elements-textPrimary font-mono truncate">{value}</div>
              </div>
            ))}
          </div>

          {/* Routes */}
          <div className="border-b border-bolt-elements-borderColor/50">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary">
              Routes ({routes.length})
            </div>
            {routes.map((r) => {
              const isActive = selectedRoute === r.path;
              return (
                <button
                  key={r.handlerFile}
                  type="button"
                  onClick={() => setSelectedRoute(isActive ? null : r.path)}
                  className={classNames(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bolt-elements-item-backgroundActive transition-colors text-left',
                    isActive && 'bg-bolt-elements-item-backgroundActive',
                  )}
                >
                  <div className="flex gap-0.5 shrink-0">
                    {r.methods.map((m) => (
                      <span
                        key={m}
                        className={classNames(
                          'px-1 py-px rounded text-[9px] font-mono',
                          METHOD_COLORS[m] ?? 'text-bolt-elements-textTertiary bg-bolt-elements-background-depth-2',
                        )}
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                  <span className="text-bolt-elements-textPrimary font-mono flex-1 truncate">{r.path}</span>
                  {r.usesResources.length > 0 && (
                    <span className="text-bolt-elements-textTertiary text-[9px] shrink-0">
                      {r.usesResources.length} res
                    </span>
                  )}
                  <div
                    className={classNames(
                      'i-ph:caret-down text-bolt-elements-textTertiary transition-transform shrink-0',
                      isActive && 'rotate-180',
                    )}
                  />
                </button>
              );
            })}
          </div>

          {/* Route detail — opens the real handler file in the editor */}
          {active && (
            <div className="border-b border-bolt-elements-borderColor/50 px-4 py-2 space-y-1.5 text-xs">
              <button
                type="button"
                onClick={() => workbenchStore.setSelectedFile(`${WORK_DIR}/${active.handlerFile}`)}
                className="text-bolt-elements-item-contentAccent hover:underline font-mono text-[11px] flex items-center gap-1"
              >
                <div className="i-ph:file-code" /> {active.handlerFile}
              </button>
              <div className="text-bolt-elements-textSecondary">
                <span className="text-bolt-elements-textTertiary">Methods: </span>
                <span className="font-mono">{active.methods.join(', ')}</span>
              </div>
              {active.usesResources.length > 0 && (
                <div>
                  <span className="text-bolt-elements-textTertiary">Uses: </span>
                  {active.usesResources.map((r) => (
                    <span key={r} className="font-mono text-bolt-elements-item-contentAccent">
                      {r}{' '}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bindings */}
          <div className="border-b border-bolt-elements-borderColor/50">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary">
              Bindings ({bindings.length})
            </div>
            {bindings.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-bolt-elements-textTertiary">
                No bindings declared in <code className="font-mono">wrangler.jsonc</code> — Pages bindings may be
                set in the dashboard.
              </div>
            ) : (
              bindings.map((b) => (
                <div
                  key={b.name}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bolt-elements-item-backgroundActive transition-colors"
                >
                  <div className={classNames(TYPE_ICONS[b.type] ?? 'i-ph:plug', 'text-bolt-elements-textTertiary text-sm')} />
                  <span className="text-bolt-elements-textPrimary font-mono">{b.name}</span>
                  <span className="text-bolt-elements-textTertiary text-[10px]">{b.type}</span>
                  <span className="ml-auto text-bolt-elements-textTertiary font-mono text-[10px] truncate max-w-[40%]">
                    {b.target}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Readiness — derived from the real project state */}
          <div className="flex-1 overflow-auto modern-scrollbar p-3 space-y-2 text-xs">
            <div className="text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary mb-1">Readiness</div>
            <div className="space-y-1">
              {[
                { label: `${routes.length} route${routes.length === 1 ? '' : 's'} declared`, ok: routes.length > 0 },
                { label: `_routes.json present`, ok: !!files[`${FUNCTIONS_DIR}/_routes.json`] },
                {
                  label: `wrangler config found`,
                  ok: !!(
                    files[`${WORK_DIR}/wrangler.jsonc`] ||
                    files[`${WORK_DIR}/wrangler.toml`] ||
                    files[`${WORK_DIR}/wrangler.json`]
                  ),
                },
                { label: `${bindings.length} binding${bindings.length === 1 ? '' : 's'} declared`, ok: true },
              ].map(({ label, ok }) => (
                <div key={label} className="flex items-center gap-2 text-xs">
                  <div className={classNames(ok ? 'i-ph:check-circle text-green-500' : 'i-ph:warning text-yellow-500')} />
                  <span className={ok ? 'text-bolt-elements-textSecondary' : 'text-yellow-500'}>{label}</span>
                </div>
              ))}
            </div>

            <div className="text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary mt-3 mb-1">Plan Limits</div>
            {[
              ['CPU', '50ms (free) / 30s (paid)'],
              ['Subrequests', '50 (free) / 1000 (paid)'],
              ['Memory', '128 MB'],
              ['Script Size', '10 MB gzip'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-bolt-elements-textTertiary">{label}</span>
                <span className="text-bolt-elements-textPrimary font-mono text-[11px]">{value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
});

FunctionsPanel.displayName = 'FunctionsPanel';
