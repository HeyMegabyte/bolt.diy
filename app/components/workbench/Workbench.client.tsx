import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
// Item 9 (perf): View Transitions API — native browser cross-fade for the
// Code↔Preview slider. Replaces a framer-motion `<motion.div>` per-frame
// JS animation with a CSS-driven `::view-transition-*` pseudo paint. Chrome
// 111+ + Safari 18+ ship natively; Firefox falls back to instant swap.
type StartViewTransition = (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };
function runViewTransition(cb: () => void): void {
  if (typeof document === 'undefined') { cb(); return; }
  const doc = document as Document & { startViewTransition?: StartViewTransition };
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (doc.startViewTransition && !reduced) {
    doc.startViewTransition(cb);
    return;
  }
  cb();
}
import type { FileHistory } from '~/types/actions';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
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
}

const viewTransition = { ease: cubicEasingFn };

const sliderOptions: SliderOptions<WorkbenchViewType> = {
  left: {
    value: 'code',
    text: 'Code',
  },
  right: {
    value: 'preview',
    text: 'Preview',
  },
};

const VIEW_ORDER: WorkbenchViewType[] = ['code', 'preview'];

function getViewX(view: WorkbenchViewType, selectedView: WorkbenchViewType): string {
  const viewIndex = VIEW_ORDER.indexOf(view);
  const selectedIndex = VIEW_ORDER.indexOf(selectedView);

  if (viewIndex < selectedIndex) {
    return '-100%';
  }

  if (viewIndex > selectedIndex) {
    return '100%';
  }

  return '0%';
}

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
    const { showChat } = useStore(chatStore);
    const canHideChat = showWorkbench || !showChat;

    const isSmallViewport = useViewport(1024);
    const streaming = useStore(streamingState);
    const { exportChat } = useChatHistory();
    const [isSyncing, setIsSyncing] = useState(false);

    // Global editor hotkeys — Cmd+P quick-jump + ? shortcuts overlay
    const { paletteOpen, shortcutsOpen, setPaletteOpen, setShortcutsOpen } = useEditorHotkeys();

    const setSelectedView = (view: WorkbenchViewType) => {
      // Item 9: route the Code↔Preview swap through the View Transitions API
      // so the cross-fade is done in the compositor (off main thread) instead
      // of via per-frame JS in framer-motion. The existing `<View>` motion
      // wrappers stay intact for users on browsers that don't support VT —
      // they'll still see the existing slide.
      runViewTransition(() => workbenchStore.currentView.set(view));
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
              'fixed top-[calc(var(--header-height)+1.2rem)] bottom-6 w-[var(--workbench-inner-width)] z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
              {
                'w-full': isSmallViewport,
                'left-0': showWorkbench && isSmallViewport,
                'left-[var(--workbench-left)]': showWorkbench,
                'left-[100%]': !showWorkbench,
              },
            )}
          >
            <div className="absolute inset-0 px-2 lg:px-4">
              <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
                <div className="flex items-center px-3 py-2 border-b border-bolt-elements-borderColor gap-1.5">
                  <button
                    className={`${showChat ? 'i-ph:sidebar-simple-fill' : 'i-ph:sidebar-simple'} text-lg text-bolt-elements-textSecondary mr-1`}
                    disabled={!canHideChat || isSmallViewport}
                    onClick={() => {
                      if (canHideChat) {
                        chatStore.setKey('showChat', !showChat);
                      }
                    }}
                  />
                  <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                  <div className="ml-auto" />
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
                    /*
                     * Unified "more" menu — the workbench used to ship three
                     * separate buttons here (Export → Download Code, Export →
                     * Export Chat, Sync → Sync Files). They competed for
                     * visual weight + crowded the editor toolbar. Consolidated
                     * into one branded ⋯ menu styled to match the projectsites
                     * dark + cyan palette.
                     */
                    <div className="ps-more-wrap">
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger
                          aria-label="Editor actions"
                          title="Editor actions — download code, export chat, sync to disk"
                          className="ps-more-trigger"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                            <circle cx="5" cy="12" r="1.4"/>
                            <circle cx="12" cy="12" r="1.4"/>
                            <circle cx="19" cy="12" r="1.4"/>
                          </svg>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content className="ps-more-menu" sideOffset={6} align="end">
                            <DropdownMenu.Item
                              className="ps-more-item"
                              onClick={() => workbenchStore.downloadZip()}
                            >
                              <span className="ps-more-glyph"><div className="i-ph:file-zip size-4" /></span>
                              <div className="ps-more-text">
                                <div className="ps-more-label">Download code</div>
                                <div className="ps-more-sub">Zip of all files in the workspace</div>
                              </div>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className="ps-more-item"
                              onClick={() => exportChat?.()}
                            >
                              <span className="ps-more-glyph"><div className="i-ph:chat-text size-4" /></span>
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
                                {isSyncing
                                  ? <div className="i-ph:spinner ps-spin size-4" />
                                  : <div className="i-ph:cloud-arrow-down size-4" />}
                              </span>
                              <div className="ps-more-text">
                                <div className="ps-more-label">{isSyncing ? 'Syncing to disk…' : 'Sync to local folder'}</div>
                                <div className="ps-more-sub">Mirror workspace into a chosen directory</div>
                              </div>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                  )}

                  <IconButton
                    icon="i-ph:x-circle"
                    className="-mr-1"
                    size="xl"
                    onClick={() => {
                      workbenchStore.showWorkbench.set(false);
                    }}
                  />
                </div>
                <div className="relative flex-1 overflow-hidden">
                  <View initial={{ x: '0%' }} animate={{ x: getViewX('code', selectedView) }}>
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
                  </View>
                  <View initial={{ x: '100%' }} animate={{ x: getViewX('preview', selectedView) }}>
                    <Preview setSelectedElement={setSelectedElement} />
                  </View>
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

// View component for rendering content with motion transitions
interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});
