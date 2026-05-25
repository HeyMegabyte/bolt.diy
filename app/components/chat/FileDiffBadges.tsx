import React, { useMemo } from 'react';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

interface FileActionInfo {
  filePath: string;
  content: string;
  lineCount: number;
}

interface FileDiffBadgesProps {
  content: string;
}

const FILE_ACTION_RE = /<boltAction[^>]*type="file"[^>]*filePath="([^"]+)"[^>]*>([\s\S]*?)(?=<\/boltAction>|<boltAction|$)/g;

/**
 * Parses streaming assistant content for `<boltAction type="file" filePath="X">`
 * blocks and renders each as a clickable badge with file path + line-count.
 *
 * @remarks
 *   Renders WHILE streaming — uses a non-greedy regex that also matches
 *   unterminated actions (the closing tag may not have arrived yet).
 */
export const FileDiffBadges: React.FC<FileDiffBadgesProps> = ({ content }) => {
  const files: FileActionInfo[] = useMemo(() => {
    if (!content || !content.includes('<boltAction')) {
      return [];
    }

    const out: FileActionInfo[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    FILE_ACTION_RE.lastIndex = 0;

    while ((match = FILE_ACTION_RE.exec(content)) !== null) {
      const filePath = match[1];
      const body = (match[2] ?? '').replace(/^\s*```\w*\n?/, '').replace(/\n```\s*$/, '');
      const lineCount = body ? body.split('\n').length : 0;

      if (seen.has(filePath)) {
        continue;
      }

      seen.add(filePath);
      out.push({ filePath, content: body, lineCount });
    }

    return out;
  }, [content]);

  if (files.length === 0) {
    return null;
  }

  const open = (path: string) => {
    let p = path;

    if (p.startsWith(WORK_DIR)) {
      p = p.replace(WORK_DIR, '');
    }

    if (p.startsWith('/')) {
      p = p.slice(1);
    }

    workbenchStore.currentView.set('code');
    workbenchStore.setSelectedFile(`${WORK_DIR}/${p}`);
  };

  return (
    <div
      data-testid="file-diff-badges"
      className="flex flex-wrap gap-1.5 mt-2 mb-1 text-xs"
    >
      {files.map((f) => (
        <button
          key={f.filePath}
          type="button"
          onClick={() => open(f.filePath)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor hover:border-bolt-elements-item-contentAccent hover:text-bolt-elements-item-contentAccent text-bolt-elements-textSecondary transition-colors"
          title={`Open ${f.filePath}`}
        >
          <span className="i-ph:file-code text-sm" />
          <span className="font-mono truncate max-w-[28ch]">{f.filePath}</span>
          {f.lineCount > 0 && (
            <span className="px-1 rounded bg-bolt-elements-background-depth-3 text-bolt-elements-textTertiary">
              {f.lineCount} {f.lineCount === 1 ? 'line' : 'lines'}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

/**
 * Computes distinct file paths from a parsed message and returns
 * `{ count, paths }` — used by AssistantMessage to render the
 * "Other files touched" badge (item 17).
 */
export function summarizeTouchedFiles(content: string): { count: number; paths: string[] } {
  if (!content) {
    return { count: 0, paths: [] };
  }

  const re = /<boltAction[^>]*type="file"[^>]*filePath="([^"]+)"/g;
  const paths: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    if (!paths.includes(m[1])) {
      paths.push(m[1]);
    }
  }

  return { count: paths.length, paths };
}
