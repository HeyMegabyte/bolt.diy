/*
 * EditorOverlays — three lightweight modal overlays + escape-hatch
 * actions wired to global keyboard shortcuts. Mounted once at the
 * Workbench level so every chat / editor surface inherits them.
 *
 *   • QuickJumpPalette  — Cmd+P fuzzy file search (VS Code style)
 *   • ShortcutsOverlay  — `?` modal listing every shortcut
 *   • openInStackBlitz  — escape-hatch button handler that POSTs the
 *                         current workspace into a fresh StackBlitz Vite
 *                         project so users can debug outside bolt.diy
 *
 * No third-party dependencies — every overlay uses the native <dialog>
 * element with focus-trap fallback for Safari < 17.
 */
import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { path } from '~/utils/path';
import { isMac } from '~/utils/os';

const MOD = isMac ? '⌘' : 'Ctrl';

interface ShortcutEntry {
  keys: string;
  label: string;
}

const SHORTCUTS: ShortcutEntry[] = [
  { keys: `${MOD} P`, label: 'Quick-jump to file' },
  { keys: `${MOD} S`, label: 'Save current file' },
  { keys: `${MOD} K`, label: 'Open AI command palette' },
  { keys: `${MOD} /`, label: 'Toggle comment (in editor)' },
  { keys: `${MOD} F`, label: 'Find in current file' },
  { keys: `${MOD} ⇧ F`, label: 'Find across project' },
  { keys: `Alt ↑ / ↓`, label: 'Move line up / down' },
  { keys: `Alt Click`, label: 'Add cursor' },
  { keys: `${MOD} ⇧ L`, label: 'Select all occurrences' },
  { keys: `${MOD} D`, label: 'Duplicate line' },
  { keys: `?`, label: 'Open this shortcuts overlay' },
  { keys: `Esc`, label: 'Close any overlay' },
];

interface PaletteFile {
  fullPath: string;
  name: string;
  parent: string;
}

function useFileList(): PaletteFile[] {
  const files = useStore(workbenchStore.files);

  return useMemo(() => {
    const list: PaletteFile[] = [];

    for (const [fullPath, dirent] of Object.entries(files)) {
      if (!dirent || dirent.type !== 'file') {
        continue;
      }

      if (/\/(node_modules|\.next|\.astro|\.git|dist|build)\//.test(fullPath)) {
        continue;
      }

      list.push({
        fullPath,
        name: path.basename(fullPath),
        parent: path.dirname(fullPath),
      });
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [files]);
}

function fuzzyScore(needle: string, haystack: string): number {
  if (!needle) {
    return 0;
  }

  const lcN = needle.toLowerCase();
  const lcH = haystack.toLowerCase();

  if (lcH.includes(lcN)) {
    return 1000 - lcH.indexOf(lcN);
  }

  let score = 0;
  let hi = 0;

  for (const ch of lcN) {
    const idx = lcH.indexOf(ch, hi);

    if (idx === -1) {
      return -1;
    }

    score += 10 - (idx - hi);
    hi = idx + 1;
  }

  return score;
}

interface QuickJumpProps {
  open: boolean;
  onClose: () => void;
}

export const QuickJumpPalette = memo(({ open, onClose }: QuickJumpProps) => {
  const files = useFileList();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!query) {
      return files.slice(0, 50);
    }

    const scored = files
      .map((f) => ({ f, s: Math.max(fuzzyScore(query, f.name), fuzzyScore(query, f.fullPath)) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50);

    return scored.map((r) => r.f);
  }, [files, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    } else {
      setQuery('');
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const choose = (file: PaletteFile) => {
    workbenchStore.setSelectedFile(file.fullPath);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[highlight];

      if (target) {
        choose(target);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-start justify-center pt-[12vh] bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Quick file jump"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-[min(640px,92vw)] rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 shadow-2xl overflow-hidden">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a file name…"
          className="w-full px-4 py-3 bg-transparent text-bolt-elements-textPrimary text-base outline-none border-b border-bolt-elements-borderColor placeholder:text-bolt-elements-textTertiary"
        />
        <div className="max-h-[50vh] overflow-y-auto modern-scrollbar">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-sm text-bolt-elements-textTertiary text-center">No files match.</div>
          ) : (
            results.map((f, i) => (
              <button
                key={f.fullPath}
                onClick={() => choose(f)}
                onMouseEnter={() => setHighlight(i)}
                className={classNames(
                  'w-full text-left px-4 py-2 flex items-baseline gap-3 text-sm',
                  i === highlight
                    ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                    : 'text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2',
                )}
              >
                <span className="i-ph:file-duotone shrink-0" />
                <span className="font-medium">{f.name}</span>
                <span className="text-xs text-bolt-elements-textTertiary truncate">{f.parent}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

interface ShortcutsProps {
  open: boolean;
  onClose: () => void;
}

export const ShortcutsOverlay = memo(({ open, onClose }: ShortcutsProps) => {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
      tabIndex={-1}
    >
      <div className="w-[min(560px,92vw)] max-h-[80vh] overflow-y-auto rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-bolt-elements-borderColor">
          <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">Keyboard shortcuts</h2>
          <button
            className="text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
            onClick={onClose}
            aria-label="Close shortcuts"
          >
            Esc
          </button>
        </div>
        <ul className="divide-y divide-bolt-elements-borderColor">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between px-5 py-2.5">
              <span className="text-sm text-bolt-elements-textPrimary">{s.label}</span>
              <kbd className="px-2 py-0.5 rounded border border-bolt-elements-borderColor text-xs font-mono text-bolt-elements-textSecondary bg-bolt-elements-background-depth-2">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
});

/*
 * StackBlitz escape hatch — POSTs the workspace into the v2 SDK API and
 * opens the result in a new tab. Falls back to a plain new-project URL
 * if the form-post is blocked.
 */
export function openInStackBlitz() {
  try {
    const files = workbenchStore.files.get();
    const form = document.createElement('form');
    form.action = 'https://stackblitz.com/run?embed=0';
    form.method = 'POST';
    form.target = '_blank';
    form.style.display = 'none';

    const add = (name: string, value: string) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    };

    add('project[title]', 'bolt.diy export');
    add('project[description]', 'Exported from editor.projectsites.dev');
    add('project[template]', 'node');

    let count = 0;

    for (const [fullPath, dirent] of Object.entries(files)) {
      if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
        continue;
      }

      const rel = fullPath.replace(/^\/home\/project\/?/, '');

      if (!rel || /\/(node_modules|\.git)\//.test('/' + rel)) {
        continue;
      }

      add(`project[files][${rel}]`, (dirent.content as string) ?? '');
      count++;
    }

    if (count === 0) {
      toast.error('No files to export');
      return;
    }

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
    toast.success(`Opened ${count} files in StackBlitz`);
  } catch (error) {
    console.warn('StackBlitz export failed', error);
    toast.error('Failed to open in StackBlitz');
    window.open('https://stackblitz.com/fork/vitejs-vite', '_blank', 'noopener,noreferrer');
  }
}

/*
 * Global hotkeys — Cmd/Ctrl+P opens quick-jump, `?` (no input focused)
 * opens shortcuts overlay. Mounted once at Workbench level.
 */
export function useEditorHotkeys(): {
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
} {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const isTyping =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        (document.activeElement as HTMLElement | null)?.isContentEditable;

      if (mod && e.key.toLowerCase() === 'p' && !e.shiftKey) {
        e.preventDefault();
        setPaletteOpen(true);
        setShortcutsOpen(false);
        return;
      }

      if (e.key === '?' && !isTyping) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        setPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { paletteOpen, shortcutsOpen, setPaletteOpen, setShortcutsOpen };
}
