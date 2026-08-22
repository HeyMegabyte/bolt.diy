import { useStore } from '@nanostores/react';
import { motion, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'react-toastify';

import type { FileHistory } from '~/types/actions';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { DataPanel } from './DataPanel';
import { EditorPanel } from './EditorPanel';
import { FunctionsPanel } from './FunctionsPanel';
import { Preview } from './Preview';
import { StatusBar } from './StatusBar.client';
import { QuickJumpPalette, ShortcutsOverlay, openInStackBlitz, useEditorHotkeys } from './EditorOverlays.client';
import useViewport from '~/lib/hooks';

import { usePreviewStore } from '~/lib/stores/previews';
import { chatStore } from '~/lib/stores/chat';
import type { ElementInfo } from './Inspector';
import { useChatHistory } from '~/lib/persistence';
import { streamingState } from '~/lib/stores/streaming';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
  metadata?: {
    gitUrl?: string;
  };
  updateChatMestaData?: (metadata: any) => void;
  setSelectedElement?: (element: ElementInfo | null) => void;
  /** Chat content rendered as a nested tab panel on tablet/mobile (<1024px) —
   * the SAME instance BaseChat docks on desktop, so it stays in sync. */
  mobileChatPanel?: ReactNode;
}

/** Top editor tabs — order drives the tab strip left-to-right. */
const TOP_TABS: { value: WorkbenchViewType; text: string; icon: string }[] = [
  { value: 'code', text: 'Code', icon: 'i-ph:code-duotone' },
  { value: 'preview', text: 'Preview', icon: 'i-ph:eye-duotone' },
  { value: 'functions', text: 'Functions', icon: 'i-ph:lightning-duotone' },
  { value: 'data', text: 'Data', icon: 'i-ph:chart-bar-duotone' },
];

const workbenchVariants = {
  closed: {
    width: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 'var(--workbench-width)',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

export const Workbench = memo(
  ({
    chatStarted,
    isStreaming,
    metadata: _metadata,
    updateChatMestaData: _updateChatMestaData,
    setSelectedElement,
    mobileChatPanel,
  }: WorkspaceProps) => {
    renderLogger.trace('Workbench');

    const [fileHistory] = useState<Record<string, FileHistory>>({});

    // const modifiedFiles = Array.from(useStore(workbenchStore.unsavedFiles).keys());

    const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
    const showWorkbench = useStore(workbenchStore.showWorkbench);
    const selectedFile = useStore(workbenchStore.selectedFile);
    const currentDocument = useStore(workbenchStore.currentDocument);
    const unsavedFiles = useStore(workbenchStore.unsavedFiles);
    const files = useStore(workbenchStore.files);
    const selectedView = useStore(workbenchStore.currentView);
    const { showChat, mobileChatOpen } = useStore(chatStore);
    const canHideChat = showWorkbench || !showChat;

    const isSmallViewport = useViewport(1024);
    const streaming = useStore(streamingState);
    const { exportChat } = useChatHistory();
    const [isSyncing, setIsSyncing] = useState(false);

    // Global editor hotkeys — Cmd+P quick-jump + ? shortcuts overlay
    const { paletteOpen, shortcutsOpen, setPaletteOpen, setShortcutsOpen } = useEditorHotkeys();

    const setSelectedView = (view: WorkbenchViewType) => {
      /*
       * Just set the view — the panels stay MOUNTED and cross-fade via the
       * PanelLayer opacity transition below. NO View-Transitions snapshot here:
       * VT snapshots the whole workbench, and because the old design also
       * unmounted/remounted the panel on every swap (reloading the Preview
       * iframe, re-initing the editor) that snapshot captured a blank frame —
       * the flash Brian saw. Keeping panels alive + a pure opacity fade is smooth.
       */
      workbenchStore.currentView.set(view);
    };

    useEffect(() => {
      if (hasPreview) {
        setSelectedView('preview');
      }
    }, [hasPreview]);

    useEffect(() => {
      workbenchStore.setDocuments(files);
    }, [files]);

    const onEditorChange = useCallback<OnEditorChange>((update) => {
      workbenchStore.setCurrentDocumentContent(update.content);
    }, []);

    const onEditorScroll = useCallback<OnEditorScroll>((position) => {
      workbenchStore.setCurrentDocumentScrollPosition(position);
    }, []);

    const onFileSelect = useCallback((filePath: string | undefined) => {
      workbenchStore.setSelectedFile(filePath);
    }, []);

    const onFileSave = useCallback(() => {
      workbenchStore
        .saveCurrentDocument()
        .then(() => {
          // Explicitly refresh all previews after a file save
          const previewStore = usePreviewStore();
          previewStore.refreshAllPreviews();
        })
        .catch(() => {
          toast.error('Failed to update file content');
        });
    }, []);

    const onFileReset = useCallback(() => {
      workbenchStore.resetCurrentDocument();
    }, []);

    const handleSyncFiles = useCallback(async () => {
      setIsSyncing(true);

      try {
        const directoryHandle = await window.showDirectoryPicker();
        await workbenchStore.syncFiles(directoryHandle);
        toast.success('Files synced successfully');
      } catch (error) {
        console.error('Error syncing files:', error);
        toast.error('Failed to sync files');
      } finally {
        setIsSyncing(false);
      }
    }, []);

    // ── Draggable chat|workbench divider (Brian 2026-08-21) ──
    // Restore the persisted split on mount; default stays 50/50.
    useEffect(() => {
      try {
        const saved = localStorage.getItem('ps_workbench_split');

        if (saved) {
          document.documentElement.style.setProperty('--workbench-split', saved);
        }
      } catch {
        // localStorage unavailable (private mode) — keep the CSS default
      }
    }, []);

    const setSplit = useCallback((pct: number) => {
      const clamped = Math.min(80, Math.max(25, pct));
      document.documentElement.style.setProperty('--workbench-split', `${clamped}%`);

      try {
        localStorage.setItem('ps_workbench_split', `${clamped}%`);
      } catch {
        // ignore persistence failure
      }
    }, []);

    // `true` only while the divider is being dragged — the workbench drops its
    // left/width transition so it tracks the cursor instantly (Brian 2026-08-21).
    const [isWorkbenchResizing, setIsWorkbenchResizing] = useState(false);

    const startWorkbenchResize = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsWorkbenchResizing(true);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';

        const onMove = (ev: PointerEvent) => {
          document.documentElement.style.setProperty(
            '--workbench-split',
            `${Math.min(80, Math.max(25, (ev.clientX / window.innerWidth) * 100))}%`,
          );
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          setIsWorkbenchResizing(false);
          document.body.style.userSelect = '';
          document.body.style.cursor = '';

          const split = document.documentElement.style.getPropertyValue('--workbench-split').trim();

          try {
            if (split) {
              localStorage.setItem('ps_workbench_split', split);
            }
          } catch {
            // ignore persistence failure
          }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      },
      [],
    );

    return (
      chatStarted && (
        <>
          <QuickJumpPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
          <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
          <motion.div
            initial="closed"
            animate={showWorkbench ? 'open' : 'closed'}
            variants={workbenchVariants}
            className="z-workbench"
          >
            <div
              className={classNames(
                'fixed top-[var(--header-height)] bottom-0 w-[var(--workbench-inner-width)] z-0',
                // Drop the left/width transition WHILE dragging so the divider tracks
                // the cursor instantly; keep it for the open/close slide (Brian 2026-08-21).
                isWorkbenchResizing ? '' : 'transition-[left,width] duration-200 bolt-ease-cubic-bezier',
                {
                  'w-full': isSmallViewport,
                  'left-0': showWorkbench && isSmallViewport,
                  'left-[var(--workbench-left)]': showWorkbench,
                  'left-[100%]': !showWorkbench,
                },
              )}
            >
              {/* Drag divider — resize chat|workbench; keyboard-operable (Brian 2026-08-21) */}
              {showWorkbench && !isSmallViewport && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Drag to resize chat and workbench"
                  tabIndex={0}
                  onPointerDown={startWorkbenchResize}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
                      return;
                    }

                    e.preventDefault();

                    const cur =
                      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--workbench-split')) || 50;
                    setSplit(cur + (e.key === 'ArrowLeft' ? -2 : 2));
                  }}
                  data-dragging={isWorkbenchResizing ? 'true' : undefined}
                  className="ps-wb-resize-handle absolute left-0 top-0 bottom-0 z-20 w-1.5 -translate-x-1/2 cursor-col-resize focus:outline-none"
                />
              )}
              <div className="absolute inset-0">
                <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border-x border-b border-bolt-elements-borderColor shadow-sm overflow-hidden">
                  <div className="flex items-center px-2 py-1.5 border-b border-bolt-elements-borderColor gap-1">
                    <button
                      className={`${showChat ? 'i-ph:sidebar-simple-fill' : 'i-ph:sidebar-simple'} text-lg text-bolt-elements-textSecondary mr-1`}
                      disabled={!canHideChat || isSmallViewport}
                      onClick={() => {
                        if (canHideChat) {
                          chatStore.setKey('showChat', !showChat);
                        }
                      }}
                    />
                    {/* Top tab strip — Code | Preview | Functions | Data (+ Chat on mobile) */}
                    <div className="flex items-center gap-0.5 flex-1 overflow-x-auto">
                      {/* Chat tab — LEFTMOST tab (Brian 2026-08-21). Below 1024px
                          the chat panel NESTS under this tab strip; tapping opens
                          it, tapping any sibling tab closes it + shows that panel. */}
                      {isSmallViewport && (
                        <button
                          type="button"
                          onClick={() => chatStore.setKey('mobileChatOpen', !chatStore.get().mobileChatOpen)}
                          aria-pressed={chatStore.get().mobileChatOpen}
                          data-testid="workbench-chat-tab"
                          className={classNames(
                            'ps-tab relative flex items-center gap-1.5 text-sm cursor-pointer px-2.5 py-1 h-7 whitespace-nowrap rounded-md transition-colors',
                            chatStore.get().mobileChatOpen
                              ? 'ps-tab-active bg-bolt-elements-terminals-buttonBackground text-bolt-elements-textPrimary'
                              : 'bg-transparent text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3',
                          )}
                        >
                          <div className="i-ph:chat-circle-dots text-base" />
                          Chat
                        </button>
                      )}
                      {TOP_TABS.map((tab) => {
                        const active = selectedView === tab.value;
                        return (
                          <button
                            key={tab.value}
                            type="button"
                            onClick={() => {
                              setSelectedView(tab.value);
                              // Selecting a real panel closes the mobile chat so the
                              // tabs behave like one mutually-exclusive tab strip.
                              chatStore.setKey('mobileChatOpen', false);
                            }}
                            aria-pressed={active}
                            className={classNames(
                              'ps-tab relative flex items-center gap-1.5 text-sm cursor-pointer px-2.5 py-1 h-7 whitespace-nowrap rounded-md transition-colors',
                              active
                                ? 'ps-tab-active bg-bolt-elements-terminals-buttonBackground text-bolt-elements-textPrimary'
                                : 'bg-transparent text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3',
                            )}
                          >
                            <div className={classNames(tab.icon, 'text-base')} />
                            {tab.text}
                          </button>
                        );
                      })}
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      {selectedView === 'code' && (
                        <>
                          <IconButton
                            icon="i-ph:magnifying-glass"
                            size="xl"
                            title="Quick-jump to file (Cmd+P / Ctrl+P)"
                            onClick={() => setPaletteOpen(true)}
                          />
                          <IconButton
                            icon="i-ph:lightning"
                            size="xl"
                            title="Open in StackBlitz"
                            onClick={openInStackBlitz}
                          />
                          <IconButton
                            icon="i-ph:keyboard"
                            size="xl"
                            title="Keyboard shortcuts (?)"
                            onClick={() => setShortcutsOpen(true)}
                          />
                        </>
                      )}
                      {selectedView === 'code' && (
                        <div className="ps-more-wrap">
                          {/*
                           * Unified "more" menu — the workbench used to ship three
                           * separate buttons here (Export → Download Code, Export →
                           * Export Chat, Sync → Sync Files). They competed for
                           * visual weight + crowded the editor toolbar. Consolidated
                           * into one branded ⋯ menu styled to match the projectsites
                           * dark + cyan palette.
                           */}
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger
                              aria-label="Editor actions"
                              title="Editor actions — download code, export chat, sync to disk"
                              className="ps-more-trigger"
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={1.8}
                                strokeLinecap="round"
                                aria-hidden="true"
                              >
                                <circle cx="5" cy="12" r="1.4" />
                                <circle cx="12" cy="12" r="1.4" />
                                <circle cx="19" cy="12" r="1.4" />
                              </svg>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content className="ps-more-menu" sideOffset={6} align="end">
                                <DropdownMenu.Item
                                  className="ps-more-item"
                                  onClick={() => workbenchStore.downloadZip()}
                                >
                                  <span className="ps-more-glyph">
                                    <div className="i-ph:file-zip size-4" />
                                  </span>
                                  <div className="ps-more-text">
                                    <div className="ps-more-label">Download code</div>
                                    <div className="ps-more-sub">Zip of all files in the workspace</div>
                                  </div>
                                </DropdownMenu.Item>
                                <DropdownMenu.Item className="ps-more-item" onClick={() => exportChat?.()}>
                                  <span className="ps-more-glyph">
                                    <div className="i-ph:chat-text size-4" />
                                  </span>
                                  <div className="ps-more-text">
                                    <div className="ps-more-label">Export chat</div>
                                    <div className="ps-more-sub">JSON transcript of every message</div>
                                  </div>
                                </DropdownMenu.Item>
                                <DropdownMenu.Item
                                  className={classNames('ps-more-item', { 'is-disabled': isSyncing || streaming })}
                                  onClick={handleSyncFiles}
                                  disabled={isSyncing || streaming}
                                >
                                  <span className="ps-more-glyph">
                                    {isSyncing ? (
                                      <div className="i-ph:spinner ps-spin size-4" />
                                    ) : (
                                      <div className="i-ph:cloud-arrow-down size-4" />
                                    )}
                                  </span>
                                  <div className="ps-more-text">
                                    <div className="ps-more-label">
                                      {isSyncing ? 'Syncing to disk…' : 'Sync to local folder'}
                                    </div>
                                    <div className="ps-more-sub">Mirror workspace into a chosen directory</div>
                                  </div>
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="relative flex-1 overflow-hidden">
                    {/* All four panels stay MOUNTED and cross-fade via opacity —
                        switching tabs never unmounts/remounts, so the Preview
                        iframe never reloads and the editor never re-inits (no
                        flash). Active panel is interactive + on top; the rest are
                        opacity-0 + pointer-events-none but alive. (Brian 2026-08-21) */}
                    <PanelLayer active={selectedView === 'code'}>
                      <EditorPanel
                        editorDocument={currentDocument}
                        isStreaming={isStreaming}
                        selectedFile={selectedFile}
                        files={files}
                        unsavedFiles={unsavedFiles}
                        fileHistory={fileHistory}
                        onFileSelect={onFileSelect}
                        onEditorScroll={onEditorScroll}
                        onEditorChange={onEditorChange}
                        onFileSave={onFileSave}
                        onFileReset={onFileReset}
                      />
                    </PanelLayer>
                    <PanelLayer active={selectedView === 'preview'}>
                      <Preview setSelectedElement={setSelectedElement} />
                    </PanelLayer>
                    <PanelLayer active={selectedView === 'functions'}>
                      <FunctionsPanel />
                    </PanelLayer>
                    <PanelLayer active={selectedView === 'data'}>
                      <DataPanel />
                    </PanelLayer>
                    {/* Chat as a nested tab panel — tablet/mobile only (<1024px).
                        The SAME chat instance BaseChat docks on desktop (passed via
                        mobileChatPanel), so it stays in sync. Active when the
                        leftmost "Chat" tab is open; no separate full-screen chat. */}
                    {mobileChatPanel && (
                      <PanelLayer active={isSmallViewport && mobileChatOpen}>
                        <div className="h-full w-full overflow-hidden">{mobileChatPanel}</div>
                      </PanelLayer>
                    )}
                  </div>
                  {/* Item 36 — StatusBar pinned to the bottom of the workbench */}
                  <StatusBar />
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )
    );
  },
);

// Panel layer — keeps its child mounted at all times and cross-fades via opacity.
// Inactive panels stay alive (the Preview iframe never reloads, the editor never
// re-inits) but go non-interactive + transparent. Honors prefers-reduced-motion.
const PanelLayer = memo(({ active, children }: { active: boolean; children: JSX.Element }) => (
  <div
    aria-hidden={!active}
    className={classNames(
      'absolute inset-0 transition-opacity duration-300 ease-out motion-reduce:transition-none',
      active ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0',
    )}
  >
    {children}
  </div>
));
