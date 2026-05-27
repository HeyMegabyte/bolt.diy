/**
 * @file Unified bottom-panel tab router for the bolt.diy editor.
 *
 * @remarks
 * Replaces the legacy `TerminalTabs` component that only hosted xterm
 * terminals. This component renders a horizontal tab strip with the
 * original `Terminal` tab plus 10 new extension tabs (Build Output,
 * Deploy History, Logs, Env Vars, CI/CD, SQL, Storage, KV, API Explorer,
 * Snapshots). Each non-terminal tab is lazy-imported so the editor LCP
 * stays unaffected — the chunk only ships when the user clicks the tab.
 *
 * Wiring:
 * - The whole component is rendered inside a single `<Panel>` from
 *   `react-resizable-panels` (with `id="bottom-panel"` + `order={2}`,
 *   following the 2026-05-25 fix that retired the `:rq:` panel-id race).
 * - The `Terminal` tab content shows the existing `TerminalTabs` body
 *   (re-implemented here to keep the Panel boundary clean — see below).
 *
 * Adding a tab:
 * 1. Implement the body in `extensions/tabs/{Name}Tab.tsx` (no props,
 *    consume stores directly).
 * 2. Add an entry to `EXTENSION_TABS` below with `id/label/icon`.
 *
 * @example
 * <BottomPanelTabs />
 */
import { useStore } from '@nanostores/react';
import React, { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Panel, type ImperativePanelHandle } from 'react-resizable-panels';
import { IconButton } from '~/components/ui/IconButton';
import { shortcutEventEmitter } from '~/lib/hooks';
import { themeStore } from '~/lib/stores/theme';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { createScopedLogger } from '~/utils/logger';
import { Terminal, type TerminalRef } from '../terminal/Terminal';
import { TerminalManager } from '../terminal/TerminalManager';
import type { ExtensionTabDescriptor } from './types';

const logger = createScopedLogger('BottomPanelTabs');

const MAX_TERMINALS = 3;
export const DEFAULT_BOTTOM_PANEL_SIZE = 30;

const BuildOutputTab = lazy(() => import('./tabs/BuildOutputTab'));
const DeployHistoryTab = lazy(() => import('./tabs/DeployHistoryTab'));
const LogsTab = lazy(() => import('./tabs/LogsTab'));
const EnvVarsTab = lazy(() => import('./tabs/EnvVarsTab'));
const CICDTab = lazy(() => import('./tabs/CICDTab'));
const SqlTab = lazy(() => import('./tabs/SqlTab'));
const StorageTab = lazy(() => import('./tabs/StorageTab'));
const KvTab = lazy(() => import('./tabs/KvTab'));
const ApiExplorerTab = lazy(() => import('./tabs/ApiExplorerTab'));
const SnapshotsTab = lazy(() => import('./tabs/SnapshotsTab'));

/**
 * Catalogue of non-terminal extension tabs. Order is significant — it's the
 * order shown in the tab strip after the Terminal slot(s).
 */
const EXTENSION_TABS: readonly ExtensionTabDescriptor[] = [
  { id: 'build', label: 'Build', icon: 'i-ph:hammer-duotone', component: BuildOutputTab, hint: 'Run + watch npm scripts' },
  { id: 'logs', label: 'Logs', icon: 'i-ph:list-bullets-duotone', component: LogsTab, hint: 'Live wrangler tail / vercel logs' },
  { id: 'env', label: 'Env Vars', icon: 'i-ph:key-duotone', component: EnvVarsTab, hint: 'Manage .env files' },
  { id: 'deploy', label: 'Deploys', icon: 'i-ph:rocket-launch-duotone', component: DeployHistoryTab, hint: 'Cloudflare Pages deployments + rollback' },
  { id: 'cicd', label: 'CI/CD', icon: 'i-ph:git-pull-request-duotone', component: CICDTab, hint: 'GitHub Actions runs' },
  { id: 'sql', label: 'SQL', icon: 'i-ph:database-duotone', component: SqlTab, hint: 'D1 query console' },
  { id: 'storage', label: 'Storage', icon: 'i-ph:cloud-arrow-up-duotone', component: StorageTab, hint: 'R2 bucket browser' },
  { id: 'kv', label: 'KV', icon: 'i-ph:cube-duotone', component: KvTab, hint: 'Cloudflare KV namespaces' },
  { id: 'api', label: 'API', icon: 'i-ph:plugs-connected-duotone', component: ApiExplorerTab, hint: 'Test discovered routes' },
  { id: 'snapshots', label: 'Snapshots', icon: 'i-ph:clock-counter-clockwise-duotone', component: SnapshotsTab, hint: 'Point-in-time file-system snapshots' },
];

type ActiveTab = { kind: 'terminal'; index: number } | { kind: 'extension'; id: string };

export const BottomPanelTabs = memo(() => {
  const showTerminal = useStore(workbenchStore.showTerminal);
  const theme = useStore(themeStore);

  const terminalRefs = useRef<Map<number, TerminalRef>>(new Map());
  const panelRef = useRef<ImperativePanelHandle>(null);
  const panelToggledByShortcut = useRef(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>({ kind: 'terminal', index: 0 });
  const [terminalCount, setTerminalCount] = useState(0);

  const addTerminal = useCallback(() => {
    if (terminalCount < MAX_TERMINALS) {
      setTerminalCount((c) => c + 1);
      setActiveTab({ kind: 'terminal', index: terminalCount });
    }
  }, [terminalCount]);

  const closeTerminal = useCallback(
    (index: number) => {
      if (index === 0) return; // can't close Bolt terminal
      const ref = terminalRefs.current.get(index);
      if (ref?.getTerminal) {
        const terminal = ref.getTerminal();
        if (terminal) workbenchStore.detachTerminal(terminal);
      }
      terminalRefs.current.delete(index);
      setTerminalCount((c) => c - 1);
      setActiveTab((prev) => {
        if (prev.kind !== 'terminal') return prev;
        if (prev.index === index) return { kind: 'terminal', index: Math.max(0, index - 1) };
        if (prev.index > index) return { kind: 'terminal', index: prev.index - 1 };
        return prev;
      });
    },
    [],
  );

  // Cleanup detached terminals on unmount.
  useEffect(() => {
    return () => {
      terminalRefs.current.forEach((ref, index) => {
        if (index > 0 && ref?.getTerminal) {
          const terminal = ref.getTerminal();
          if (terminal) workbenchStore.detachTerminal(terminal);
        }
      });
    };
  }, []);

  // Bottom panel collapse/expand mirrors workbenchStore.showTerminal. Defers
  // by one animation frame to avoid the lazy-mount race that produced the
  // historical "Panel size not found for panel :rq:" error.
  useEffect(() => {
    let rafId = 0;
    rafId = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      try {
        const collapsed = panel.isCollapsed();
        if (!showTerminal && !collapsed) {
          panel.collapse();
        } else if (showTerminal && collapsed) {
          panel.resize(DEFAULT_BOTTOM_PANEL_SIZE);
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          logger.warn('BottomPanelTabs: imperative call skipped (panel not registered yet)', err);
        }
      }
      panelToggledByShortcut.current = false;
    });
    return () => cancelAnimationFrame(rafId);
  }, [showTerminal]);

  useEffect(() => {
    const offShortcut = shortcutEventEmitter.on('toggleTerminal', () => {
      panelToggledByShortcut.current = true;
    });
    const offTheme = themeStore.subscribe(() => {
      terminalRefs.current.forEach((ref) => ref?.reloadStyles());
    });
    return () => {
      offShortcut();
      offTheme();
    };
  }, []);

  const isTerminalTab = activeTab.kind === 'terminal';

  return (
    <Panel
      id="bottom-panel"
      order={2}
      ref={panelRef}
      defaultSize={showTerminal ? DEFAULT_BOTTOM_PANEL_SIZE : 0}
      minSize={10}
      collapsible
      onExpand={() => {
        if (!panelToggledByShortcut.current) {
          workbenchStore.toggleTerminal(true);
        }
      }}
      onCollapse={() => {
        if (!panelToggledByShortcut.current) {
          workbenchStore.toggleTerminal(false);
        }
      }}
    >
      <div className="h-full bg-bolt-elements-terminals-background flex flex-col">
        {/* Tab strip */}
        <div className="flex items-center bg-bolt-elements-background-depth-2 border-y border-bolt-elements-borderColor gap-1 min-h-[34px] px-2 overflow-x-auto">
          {/* Terminal tabs (Bolt + user-added) */}
          {Array.from({ length: terminalCount + 1 }, (_, index) => {
            const active = isTerminalTab && (activeTab as { index: number }).index === index;
            return (
              <button
                key={`term-${index}`}
                type="button"
                onClick={() => setActiveTab({ kind: 'terminal', index })}
                className={classNames(
                  'flex items-center text-sm cursor-pointer gap-1.5 px-3 py-1.5 h-7 whitespace-nowrap rounded-full transition-colors',
                  active
                    ? 'bg-bolt-elements-terminals-buttonBackground text-bolt-elements-textPrimary'
                    : 'bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3',
                )}
              >
                <div className="i-ph:terminal-window-duotone text-base" />
                {index === 0 ? 'Bolt Terminal' : terminalCount > 1 ? `Terminal ${index}` : 'Terminal'}
                {index > 0 ? (
                  <button
                    type="button"
                    className="ml-1 text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTerminal(index);
                    }}
                  >
                    <div className="i-ph:x text-xs" />
                  </button>
                ) : null}
              </button>
            );
          })}

          {terminalCount < MAX_TERMINALS ? (
            <IconButton icon="i-ph:plus" size="sm" onClick={addTerminal} title="New terminal" />
          ) : null}

          {/* Separator */}
          <div className="w-px h-5 bg-bolt-elements-borderColor mx-1" />

          {/* Extension tabs */}
          {EXTENSION_TABS.map((tab) => {
            const active = activeTab.kind === 'extension' && activeTab.id === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                title={tab.hint}
                onClick={() => setActiveTab({ kind: 'extension', id: tab.id })}
                className={classNames(
                  'flex items-center text-sm cursor-pointer gap-1.5 px-3 py-1.5 h-7 whitespace-nowrap rounded-full transition-colors',
                  active
                    ? 'bg-bolt-elements-terminals-buttonBackground text-bolt-elements-textPrimary'
                    : 'bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3',
                )}
              >
                <div className={classNames(tab.icon, 'text-base')} />
                {tab.label}
              </button>
            );
          })}

          <IconButton
            className="ml-auto"
            icon="i-ph:caret-down"
            title="Close panel"
            size="md"
            onClick={() => workbenchStore.toggleTerminal(false)}
          />
        </div>

        {/* Tab bodies */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {/* All terminals render together so their xterm refs stay alive
              across tab switches; only the active one is visible. */}
          <div className={classNames('h-full', { hidden: !isTerminalTab })}>
            {Array.from({ length: terminalCount + 1 }, (_, index) => {
              const active = isTerminalTab && (activeTab as { index: number }).index === index;
              const isBolt = index === 0;
              return (
                <React.Fragment key={`terminal-body-${index}`}>
                  <Terminal
                    id={`terminal_${index}`}
                    className={classNames(
                      'h-full overflow-hidden',
                      isBolt ? 'modern-scrollbar-invert' : 'modern-scrollbar',
                      { hidden: !active },
                    )}
                    ref={(ref) => {
                      if (ref) terminalRefs.current.set(index, ref);
                    }}
                    onTerminalReady={(terminal) => {
                      if (isBolt) workbenchStore.attachBoltTerminal(terminal);
                      else workbenchStore.attachTerminal(terminal);
                    }}
                    onTerminalResize={(cols, rows) => workbenchStore.onTerminalResize(cols, rows)}
                    theme={theme}
                  />
                  {active ? (
                    <TerminalManager
                      terminal={terminalRefs.current.get(index)?.getTerminal() || null}
                      isActive={active}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
          </div>

          {/* Lazy-mount the active extension tab. Suspense fallback is a
              quiet skeleton so the chunk swap is invisible. */}
          {EXTENSION_TABS.map((tab) => {
            const active = activeTab.kind === 'extension' && activeTab.id === tab.id;
            if (!active) return null;
            const TabBody = tab.component;
            return (
              <div key={tab.id} className="h-full">
                <Suspense
                  fallback={
                    <div className="h-full flex items-center justify-center text-bolt-elements-textTertiary text-sm">
                      <div className="i-svg-spinners:3-dots-fade text-2xl" />
                      <span className="ml-2">Loading {tab.label}…</span>
                    </div>
                  }
                >
                  <TabBody />
                </Suspense>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
});

BottomPanelTabs.displayName = 'BottomPanelTabs';
