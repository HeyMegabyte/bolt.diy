/**
 * @file SnapshotsTab — capture and restore in-memory snapshots of the
 * current `workbenchStore.files` FileMap, persisted in `localStorage`
 * under the `bolt-snapshots` key.
 *
 * @remarks
 * No backend: snapshots are pure JSON serializations of the live
 * nanostore FileMap. Restoring re-hydrates the store's keys via
 * `files.setKey`, which propagates to the editor and WebContainer
 * write-through layer (`FilesStore.saveFile`).
 *
 * @example
 * import SnapshotsTab from '~/components/workbench/extensions/tabs/SnapshotsTab';
 * // render inside the BottomPanelTabs body
 */
import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { workbenchStore } from '~/lib/stores/workbench';
import type { FileMap } from '~/lib/stores/files';
import { classNames } from '~/utils/classNames';

interface Snapshot {
  id: string;
  label: string;
  takenAt: number;
  fileCount: number;
  byteSize: number;
  files: FileMap;
}

const STORAGE_KEY = 'bolt-snapshots';

function loadSnapshots(): Snapshot[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Snapshot[]) : [];
  } catch (err) {
    console.warn('SnapshotsTab: failed to parse stored snapshots', err);
    return [];
  }
}

function persistSnapshots(list: Snapshot[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('SnapshotsTab: failed to persist snapshots', err);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function SnapshotsTab(): JSX.Element {
  const files = useStore(workbenchStore.files);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    setSnapshots(loadSnapshots());
  }, []);

  const liveFileCount = Object.values(files).filter((d) => d?.type === 'file').length;

  const takeSnapshot = useCallback(() => {
    const label = window.prompt('Snapshot label', `Snapshot ${new Date().toLocaleTimeString()}`);
    if (label === null) {
      return;
    }
    const payload = JSON.stringify(files);
    const snap: Snapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: label.trim() || 'Untitled snapshot',
      takenAt: Date.now(),
      fileCount: Object.values(files).filter((d) => d?.type === 'file').length,
      byteSize: new Blob([payload]).size,
      files,
    };
    const next = [snap, ...snapshots];
    setSnapshots(next);
    persistSnapshots(next);
  }, [files, snapshots]);

  const restoreSnapshot = useCallback((snap: Snapshot) => {
    if (!window.confirm(`Restore "${snap.label}"? This overwrites current files in the editor store.`)) {
      return;
    }
    const current = workbenchStore.files.get();
    for (const path of Object.keys(current)) {
      workbenchStore.files.setKey(path, undefined);
    }
    for (const [path, dirent] of Object.entries(snap.files)) {
      if (dirent) {
        workbenchStore.files.setKey(path, dirent);
      }
    }
  }, []);

  const deleteSnapshot = useCallback(
    (id: string) => {
      const next = snapshots.filter((s) => s.id !== id);
      setSnapshots(next);
      persistSnapshots(next);
    },
    [snapshots],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bolt-elements-background-depth-1">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
        <div className="i-ph:camera-duotone text-lg text-bolt-elements-textSecondary" />
        <span className="text-sm text-bolt-elements-textPrimary font-medium">Snapshots</span>
        <span className="text-xs text-bolt-elements-textTertiary ml-1">
          {snapshots.length} stored · {liveFileCount} live files
        </span>
        <button
          type="button"
          onClick={takeSnapshot}
          className={classNames(
            'ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md',
            'bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover',
            'text-bolt-elements-button-primary-text text-xs font-medium',
          )}
        >
          <div className="i-ph:plus text-sm" />
          Take Snapshot
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {snapshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary text-sm gap-2">
            <div className="i-ph:camera-slash-duotone text-3xl" />
            <span>No snapshots yet — take one to capture the current workspace.</span>
          </div>
        ) : (
          <ul className="divide-y divide-bolt-elements-borderColor">
            {snapshots.map((snap) => (
              <li
                key={snap.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-bolt-elements-background-depth-2 group"
              >
                <div className="i-ph:camera-duotone text-lg text-bolt-elements-textSecondary" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm text-bolt-elements-textPrimary truncate">{snap.label}</span>
                  <span className="text-xs text-bolt-elements-textTertiary">
                    {formatTime(snap.takenAt)} · {snap.fileCount} files · {formatBytes(snap.byteSize)}
                  </span>
                </div>
                <IconButton
                  icon="i-ph:arrow-counter-clockwise"
                  size="md"
                  title="Restore this snapshot"
                  onClick={() => restoreSnapshot(snap)}
                />
                <IconButton
                  icon="i-ph:trash"
                  size="md"
                  title="Delete this snapshot"
                  onClick={() => deleteSnapshot(snap.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default memo(SnapshotsTab);
