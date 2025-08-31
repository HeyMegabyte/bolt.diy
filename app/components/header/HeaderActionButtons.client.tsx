import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { useState, useCallback } from 'react';
import { streamingState } from '~/lib/stores/streaming';
import { ExportChatButton } from '~/components/chat/chatExportAndImport/ExportChatButton';
import { useChatHistory } from '~/lib/persistence';
import { DeployButton } from '~/components/deploy/DeployButton';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface HeaderActionButtonsProps {
  chatStarted: boolean;
}

export function HeaderActionButtons({ chatStarted }: HeaderActionButtonsProps) {
  const [activePreviewIndex] = useState(0);
  const previews = useStore(workbenchStore.previews);
  const activePreview = previews[activePreviewIndex];
  const isStreaming = useStore(streamingState);
  const { exportChat } = useChatHistory();
  const [isSyncing, setIsSyncing] = useState(false);

  const shouldShowButtons = !isStreaming && activePreview;

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
    <div className="flex items-center gap-1">
      {/* Export Chat Button */}
      {chatStarted && shouldShowButtons && <ExportChatButton exportChat={exportChat} />}

      {/* Sync Button */}
      {shouldShowButtons && (
        <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden text-sm">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              disabled={isSyncing}
              className="rounded-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-accent-500 text-white hover:text-bolt-elements-item-contentAccent [&:not(:disabled,.disabled)]:hover:bg-bolt-elements-button-primary-backgroundHover outline-accent-500 flex gap-1.7"
            >
              {isSyncing ? 'Syncing...' : 'Sync'}
              <span className={classNames('i-ph:caret-down transition-transform')} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              className={classNames(
                'min-w-[240px] z-[250]',
                'bg-white dark:bg-[#141414]',
                'rounded-lg shadow-lg',
                'border border-gray-200/50 dark:border-gray-800/50',
                'animate-in fade-in-0 zoom-in-95',
                'py-1',
              )}
              sideOffset={5}
              align="end"
            >
              <DropdownMenu.Item
                className={classNames(
                  'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive gap-2 rounded-md group relative',
                )}
                onClick={handleSyncFiles}
                disabled={isSyncing}
              >
                <div className="flex items-center gap-2">
                  {isSyncing ? <div className="i-ph:spinner" /> : <div className="i-ph:cloud-arrow-down" />}
                  <span>{isSyncing ? 'Syncing...' : 'Sync Files'}</span>
                </div>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      )}

      {/* Deploy Button */}
      {shouldShowButtons && <DeployButton />}

      {/* Bug Report Button */}
      {shouldShowButtons && (
        <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden text-sm">
          <button
            onClick={() =>
              window.open('https://github.com/stackblitz-labs/bolt.diy/issues/new?template=bug_report.yml', '_blank')
            }
            className="rounded-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-accent-500 text-white hover:text-bolt-elements-item-contentAccent [&:not(:disabled,.disabled)]:hover:bg-bolt-elements-button-primary-backgroundHover outline-accent-500 flex gap-1.5"
            title="Report Bug"
          >
            <div className="i-ph:bug" />
            <span>Report Bug</span>
          </button>
        </div>
      )}
    </div>
  );
}
