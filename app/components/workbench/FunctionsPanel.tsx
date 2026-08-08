/**
 * @file Functions tab — Workers for Platforms manager.
 *
 * @remarks
 * Shows routes, handlers, middleware, bindings, and WFP deploy readiness.
 * One site Worker with internal routes by default. Route-to-resource graph.
 */
import React, { memo, useState } from 'react';
import { classNames } from '~/utils/classNames';

interface RouteEntry {
  path: string;
  methods: string[];
  handlerFile: string;
  usesResources: string[];
}

interface BindingEntry {
  name: string;
  type: string;
  target: string;
}

const MOCK_ROUTES: RouteEntry[] = [
  { path: '/', methods: ['GET'], handlerFile: 'routes/home.ts', usesResources: [] },
  {
    path: '/api/booking',
    methods: ['GET', 'POST'],
    handlerFile: 'routes/booking.ts',
    usesResources: ['bricklabor_sqlite'],
  },
  { path: '/api/contact', methods: ['POST'], handlerFile: 'routes/contact.ts', usesResources: [] },
  { path: '/api/health', methods: ['GET'], handlerFile: 'routes/health.ts', usesResources: [] },
];

const MOCK_BINDINGS: BindingEntry[] = [
  { name: 'DB', type: 'sqlite', target: 'bricklabor_db' },
  { name: 'BUCKET', type: 'r2', target: 'bricklabor_media' },
  { name: 'TURNSTILE_SECRET_KEY', type: 'secret', target: 'wrangler secret' },
];

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-500 bg-green-500/10',
  POST: 'text-blue-500 bg-blue-500/10',
  PUT: 'text-yellow-500 bg-yellow-500/10',
  PATCH: 'text-orange-500 bg-orange-500/10',
  DELETE: 'text-red-500 bg-red-500/10',
};

const TYPE_ICONS: Record<string, string> = {
  sqlite: 'i-ph:database',
  r2: 'i-ph:cloud',
  kv: 'i-ph:cube',
  redis: 'i-ph:stack',
  secret: 'i-ph:key',
  env: 'i-ph:gear',
};

export const FunctionsPanel = memo(() => {
  const [selectedRoute, setSelectedRoute] = useState<RouteEntry | null>(null);

  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-1">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-bolt-elements-borderColor">
        <div className="i-ph:lightning-duotone text-xl text-bolt-elements-textSecondary" />
        <div>
          <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Functions</h2>
          <p className="text-[10px] text-bolt-elements-textTertiary">
            1 Worker · {MOCK_ROUTES.length} routes · {MOCK_BINDINGS.length} bindings
          </p>
        </div>
        <span className="ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">
          deploy ready
        </span>
      </div>

      {/* WFP metadata */}
      <div className="grid grid-cols-3 gap-px bg-bolt-elements-borderColor/30 text-[10px]">
        {[
          ['Dispatch NS', 'production'],
          ['Compat Date', '2026-06-30'],
          ['Script', 'bricklabor-site-worker'],
        ].map(([label, value]) => (
          <div key={label} className="bg-bolt-elements-background-depth-1 px-3 py-1.5">
            <div className="text-bolt-elements-textTertiary uppercase">{label}</div>
            <div className="text-bolt-elements-textPrimary font-mono truncate">{value}</div>
          </div>
        ))}
      </div>

      {/* Routes */}
      <div className="border-b border-bolt-elements-borderColor/50">
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary">Routes</div>
        {MOCK_ROUTES.map((r) => {
          const active = selectedRoute?.path === r.path;
          return (
            <button
              key={r.path}
              type="button"
              onClick={() => setSelectedRoute(active ? null : r)}
              className={classNames(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bolt-elements-item-backgroundActive transition-colors text-left',
                active && 'bg-bolt-elements-item-backgroundActive',
              )}
            >
              <div className="flex gap-0.5">
                {r.methods.map((m) => (
                  <span
                    key={m}
                    className={classNames(
                      'px-1 py-px rounded text-[9px] font-mono',
                      METHOD_COLORS[m] ?? 'text-bolt-elements-textTertiary',
                    )}
                  >
                    {m}
                  </span>
                ))}
              </div>
              <span className="text-bolt-elements-textPrimary font-mono flex-1 truncate">{r.path}</span>
              {r.usesResources.length > 0 && (
                <span className="text-bolt-elements-textTertiary text-[9px]">{r.usesResources.length} resources</span>
              )}
              <div
                className={classNames(
                  'i-ph:caret-down text-bolt-elements-textTertiary transition-transform',
                  active && 'rotate-180',
                )}
              />
            </button>
          );
        })}
      </div>

      {/* Route detail */}
      {selectedRoute && (
        <div className="border-b border-bolt-elements-borderColor/50 px-4 py-2 space-y-1.5 text-xs">
          <div className="text-bolt-elements-textSecondary">
            <span className="text-bolt-elements-textTertiary">Handler: </span>
            <span className="font-mono">{selectedRoute.handlerFile}</span>
          </div>
          {selectedRoute.usesResources.length > 0 && (
            <div>
              <span className="text-bolt-elements-textTertiary">Resources: </span>
              {selectedRoute.usesResources.map((r) => (
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
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary">Bindings</div>
        {MOCK_BINDINGS.map((b) => (
          <div
            key={b.name}
            className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bolt-elements-item-backgroundActive transition-colors"
          >
            <div className={classNames(TYPE_ICONS[b.type] ?? 'i-ph:plug', 'text-bolt-elements-textTertiary text-sm')} />
            <span className="text-bolt-elements-textPrimary font-mono">{b.name}</span>
            <span className="text-bolt-elements-textTertiary text-[10px]">{b.type}</span>
            <span className="ml-auto text-bolt-elements-textTertiary font-mono text-[10px]">{b.target}</span>
          </div>
        ))}
      </div>

      {/* Limits + warnings */}
      <div className="flex-1 overflow-auto modern-scrollbar p-3 space-y-2 text-xs">
        <div className="text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary mb-1">Plan Limits</div>
        {[
          ['CPU', '50ms (free tier)'],
          ['Subrequests', '50 per request'],
          ['Memory', '128 MB'],
          ['Script Size', '1 MB'],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <span className="text-bolt-elements-textTertiary">{label}</span>
            <span className="text-bolt-elements-textPrimary font-mono text-[11px]">{value}</span>
          </div>
        ))}

        <div className="text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary mt-3 mb-1">Readiness</div>
        <div className="space-y-1">
          {[
            { label: 'Routes declared', ok: true },
            { label: 'Bindings match wrangler.jsonc', ok: true },
            { label: 'Compatibility date valid', ok: true },
            { label: 'Dispatch namespace set', ok: true },
            { label: 'No unsupported WFP features', ok: true },
            { label: 'Secrets provisioned', ok: false },
          ].map(({ label, ok }) => (
            <div key={label} className="flex items-center gap-2 text-xs">
              <div className={classNames(ok ? 'i-ph:check-circle text-green-500' : 'i-ph:warning text-yellow-500')} />
              <span className={ok ? 'text-bolt-elements-textSecondary' : 'text-yellow-500'}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

FunctionsPanel.displayName = 'FunctionsPanel';
