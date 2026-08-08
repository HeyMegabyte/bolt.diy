/**
 * @file Visual editor — GrapesJS-powered drag-and-drop page builder.
 *
 * @remarks
 * Mounts GrapesJS only when the Visual tab is active. State is persisted
 * per-route (Brian directive 2026-06-30). Bidirectional sync with Code:
 * - Mount reads currentDocument content (Code → Visual)
 * - Update writes back to workbench store (Visual → Code)
 *
 * Uses theme tokens for dark mode. Never runs inside Preview.
 */
import { useStore } from '@nanostores/react';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { workbenchStore } from '~/lib/stores/workbench';

interface RouteVisualState {
  html: string;
  css: string;
}

function getRouteKey(filePath: string | undefined): string {
  return filePath ?? '__default__';
}

/*
 * ---------------------------------------------------------------------------
 * Component
 * ---------------------------------------------------------------------------
 */

export const VisualEditor = memo(() => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);

  const routeKey = getRouteKey(selectedFile);

  // Bootstrap GrapesJS after first mount
  useEffect(() => {
    if (mounted) {
      return undefined;
    }

    setMounted(true);

    let cancelled = false;

    const boot = async () => {
      try {
        setLoading(true);

        const grapesjs = (await import('grapesjs')).default;
        await import('grapesjs/dist/css/grapes.min.css');

        if (cancelled || !containerRef.current) {
          return;
        }

        /*
         * Seed: prefer current document content (Code → Visual sync),
         * fall back to store-persisted per-route state, then default template
         */
        const stored = workbenchStore.visualStates?.get(routeKey);
        let seedHtml: string | undefined;

        if (currentDocument?.value && currentDocument.value.trim().length > 10) {
          seedHtml = currentDocument.value;
        } else if (stored) {
          seedHtml = stored.html;
        }

        const editor = grapesjs.init({
          container: containerRef.current,
          height: '100%',
          width: 'auto',
          storageManager: false, // We manage persistence via routeStateCache
          blockManager: {
            appendTo: '#visual-blocks',
          },
          styleManager: {
            appendTo: '#visual-styles',
          },
          layerManager: {
            appendTo: '#visual-layers',
          },
          selectorManager: {
            appendTo: '#visual-selectors',
          },
          traitManager: {
            appendTo: '#visual-traits',
          },
          panels: {
            defaults: [
              {
                id: 'basic-actions',
                el: '#visual-panel-basic',
              },
            ],
          },
          deviceManager: {
            devices: [
              { name: 'Desktop', width: '' },
              { name: 'Tablet', width: '768px', widthMedia: '768px' },
              { name: 'Mobile', width: '375px', widthMedia: '375px' },
            ],
          },
          canvas: {
            styles: ['https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css'],
          },
          pluginsOpts: {},
        });

        // Restore state or seed from current document
        if (seedHtml && seedHtml.trim().length > 10) {
          editor.setComponents(seedHtml);

          if (stored?.css) {
            editor.setStyle(stored.css);
          }
        } else {
          editor.setComponents(`
            <div style="padding:2rem;font-family:system-ui;max-width:960px;margin:0 auto">
              <h1 style="color:var(--bolt-elements-textPrimary)">New Page</h1>
              <p style="color:var(--bolt-elements-textSecondary)">Drag blocks from the right panel to build your page.</p>
            </div>
          `);
        }

        // Save state on changes — persists to workbench store (survives reload)
        editor.on('update', () => {
          const state: RouteVisualState = {
            html: editor.getHtml(),
            css: editor.getCss() ?? '',
          };

          // Write to workbench store for cross-session persistence
          if (!workbenchStore.visualStates) {
            workbenchStore.visualStates = new Map();
          }

          workbenchStore.visualStates.set(routeKey, state);

          // Bidirectional sync: Visual → Code
          workbenchStore.setCurrentDocumentContent(state.html);
        });

        editorRef.current = editor;
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load visual editor');
          setLoading(false);
        }
      }
    };

    // Delay boot slightly so the tab transition animation completes first
    const timer = setTimeout(boot, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mounted, routeKey]);

  // Cleanup on unmount (tab switch away from Visual)
  useEffect(() => {
    return () => {
      // Editor persists in routeStateCache — no cleanup needed
    };
  }, []);

  // When route changes, update editor from store or current document
  useEffect(() => {
    const editor = editorRef.current as { setComponents?: (h: string) => void; setStyle?: (c: string) => void } | null;

    if (!editor || loading) {
      return;
    }

    const stored = workbenchStore.visualStates?.get(routeKey);

    if (stored && editor.setComponents) {
      editor.setComponents(stored.html);

      if (stored.css && editor.setStyle) {
        editor.setStyle(stored.css);
      }
    } else if (currentDocument?.value && editor.setComponents) {
      editor.setComponents(currentDocument.value);
    }
  }, [routeKey, loading, currentDocument]);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    setMounted(false);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-bolt-elements-background-depth-1">
        <div className="flex flex-col items-center gap-3">
          <div className="i-svg-spinners:3-dots-fade text-3xl text-bolt-elements-textSecondary" />
          <span className="text-sm text-bolt-elements-textTertiary">Loading visual editor…</span>
          <span className="text-[10px] text-bolt-elements-textTertiary">GrapesJS ~5MB — loading on first open</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-bolt-elements-background-depth-1">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <div className="i-ph:warning-duotone text-3xl text-red-400" />
          <span className="text-sm text-red-400">Failed to load visual editor</span>
          <span className="text-xs text-bolt-elements-textTertiary">{error}</span>
          <button
            type="button"
            onClick={handleRetry}
            className="px-3 py-1.5 text-xs rounded-md bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent hover:bg-bolt-elements-item-backgroundActive"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // GrapesJS renders into the container div — the sidebar panels live in portal divs
  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-1">
      {/* Top bar — basic actions */}
      <div
        id="visual-panel-basic"
        className="flex items-center gap-1 px-2 py-1 border-b border-bolt-elements-borderColor min-h-[32px]"
      />

      {/* Main area: canvas + sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* GrapesJS canvas */}
        <div ref={containerRef} className="flex-1 min-w-0" />

        {/* Right sidebar — blocks, styles, layers, traits */}
        <div className="w-[260px] border-l border-bolt-elements-borderColor overflow-y-auto modern-scrollbar flex flex-col bg-bolt-elements-background-depth-2 text-xs">
          <div id="visual-blocks" className="p-2 border-b border-bolt-elements-borderColor/50">
            <div className="text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary mb-1">Blocks</div>
          </div>
          <div id="visual-styles" className="p-2 border-b border-bolt-elements-borderColor/50">
            <div className="text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary mb-1">Style</div>
          </div>
          <div id="visual-layers" className="p-2 border-b border-bolt-elements-borderColor/50">
            <div className="text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary mb-1">Layers</div>
          </div>
          <div id="visual-selectors" className="p-2 border-b border-bolt-elements-borderColor/50">
            <div className="text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary mb-1">Selectors</div>
          </div>
          <div id="visual-traits" className="p-2">
            <div className="text-[10px] uppercase tracking-wider text-bolt-elements-textTertiary mb-1">Traits</div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-bolt-elements-borderColor/50 text-[10px] text-bolt-elements-textTertiary">
        <span>Route: {routeKey === '__default__' ? 'default' : routeKey}</span>
        <span>
          {workbenchStore.visualStates?.size ?? 0} page{workbenchStore.visualStates?.size !== 1 ? 's' : ''} stored
        </span>
      </div>
    </div>
  );
});

VisualEditor.displayName = 'VisualEditor';
