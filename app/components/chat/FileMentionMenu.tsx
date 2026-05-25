import React, { useEffect, useMemo, useRef, useState } from 'react';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

interface FileMentionMenuProps {
  query: string | null;
  onSelect: (path: string) => void;
  onClose: () => void;
}

function listFiles(): string[] {
  const map = workbenchStore.files.get();
  const out: string[] = [];

  for (const [path, dirent] of Object.entries(map)) {
    if (dirent && dirent.type === 'file') {
      const rel = path.startsWith(WORK_DIR) ? path.slice(WORK_DIR.length).replace(/^\//, '') : path;
      out.push(rel);
    }
  }

  return out;
}

function fuzzyRank(files: string[], query: string): string[] {
  if (!query) {
    return files.slice(0, 10);
  }

  const q = query.toLowerCase();
  const scored: { path: string; score: number }[] = [];

  for (const path of files) {
    const lower = path.toLowerCase();
    let score = 0;

    if (lower === q) {
      score = 1000;
    } else if (lower.endsWith('/' + q) || lower.endsWith(q)) {
      score = 500;
    } else if (lower.includes(q)) {
      score = 300 - lower.indexOf(q);
    } else {
      // Subsequence match
      let qi = 0;

      for (let i = 0; i < lower.length && qi < q.length; i++) {
        if (lower[i] === q[qi]) {
          qi += 1;
        }
      }

      if (qi === q.length) {
        score = 100 - (lower.length - q.length);
      }
    }

    if (score > 0) {
      scored.push({ path, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((s) => s.path);
}

/**
 * Floating menu shown above the chat textarea when the user types `@`.
 * Fuzzy-ranks files from the WebContainer file tree and inserts the
 * full path back into the input on Enter/click.
 */
export const FileMentionMenu: React.FC<FileMentionMenuProps> = ({ query, onSelect, onClose }) => {
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (query === null) {
      return [];
    }

    const all = listFiles();
    return fuzzyRank(all, query.trim());
  }, [query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (query === null || results.length === 0) {
      return;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(results.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        onSelect(results[activeIdx]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [query, results, activeIdx, onSelect, onClose]);

  if (query === null || results.length === 0) {
    return null;
  }

  return (
    <div
      ref={ref}
      data-testid="file-mention-menu"
      className="absolute bottom-full left-0 mb-2 max-w-md w-full bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor rounded-lg shadow-lg overflow-hidden z-50"
    >
      <div className="text-[10px] uppercase tracking-wider px-3 py-1.5 text-bolt-elements-textTertiary border-b border-bolt-elements-borderColor">
        Files matching @{query || '...'}
      </div>
      <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
        {results.map((path, idx) => (
          <li
            key={path}
            role="option"
            aria-selected={idx === activeIdx}
            onMouseEnter={() => setActiveIdx(idx)}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(path);
            }}
            className={
              'px-3 py-1.5 text-sm cursor-pointer flex items-center gap-2 ' +
              (idx === activeIdx
                ? 'bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary'
                : 'text-bolt-elements-textSecondary')
            }
          >
            <span className="i-ph:file-code text-base shrink-0" />
            <span className="font-mono truncate">{path}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
