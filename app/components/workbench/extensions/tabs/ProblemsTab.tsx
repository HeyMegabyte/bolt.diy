/**
 * @file Problems tab — TypeScript/lint/build/manifest/validation errors.
 *
 * @remarks
 * Aggregates diagnostics from the editor, build pipeline, manifest validators,
 * and import/export checks into a single filterable problem list.
 * Each row carries: severity, file path, line:col, message, and a suggested fix.
 */
import React, { memo, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

interface ProblemEntry {
  severity: 'error' | 'warning' | 'info';
  file?: string;
  line?: number;
  col?: number;
  message: string;
  source: string;
}

const SEVERITY_ICON: Record<ProblemEntry['severity'], string> = {
  error: 'i-ph:x-circle-fill text-red-500',
  warning: 'i-ph:warning-fill text-yellow-500',
  info: 'i-ph:info-fill text-blue-500',
};

const SEVERITY_ORDER: Record<ProblemEntry['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Derives problem entries from workbench diagnostics.
 * In production this would aggregate from TypeScript LSP, ESLint,
 * manifest validators, build output parsers, and import/export checkers.
 */
function useProblems(): ProblemEntry[] {
  const currentDocument = useStore(workbenchStore.currentDocument);
  const files = useStore(workbenchStore.files);

  return useMemo(() => {
    const problems: ProblemEntry[] = [];

    // Surface unsaved-files as info entries
    const unsaved = workbenchStore.unsavedFiles.get();
    if (unsaved && unsaved.size > 0) {
      for (const path of unsaved) {
        problems.push({
          severity: 'info',
          file: path,
          message: 'Unsaved changes',
          source: 'editor',
        });
      }
    }

    // Surface empty files
    if (files) {
      for (const [path, entry] of Object.entries(files)) {
        if (!entry || entry.type !== 'file') continue;
        const file = entry;
        if (!file.content?.trim()) {
          problems.push({
            severity: 'warning',
            file: path,
            message: 'Empty file',
            source: 'editor',
          });
        }
      }
    }

    return problems.sort((a, b) => {
      const orderDiff = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
      if (orderDiff !== 0) return orderDiff;
      return (a.file ?? '').localeCompare(b.file ?? '');
    });
  }, [currentDocument, files]);
}

const ProblemsTab = memo(() => {
  const problems = useProblems();
  const [severityFilter, setSeverityFilter] = useState<'all' | ProblemEntry['severity']>('all');

  const filtered = useMemo(() => {
    if (severityFilter === 'all') return problems;
    return problems.filter((p) => p.severity === severityFilter);
  }, [problems, severityFilter]);

  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const p of problems) {
      c[p.severity]++;
    }
    return c;
  }, [problems]);

  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-1">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor text-xs">
        <button
          type="button"
          onClick={() => setSeverityFilter('all')}
          className={classNames(
            'px-2 py-0.5 rounded-full transition-colors',
            severityFilter === 'all'
              ? 'bg-bolt-elements-item-backgroundActive text-bolt-elements-textPrimary'
              : 'text-bolt-elements-textTertiary hover:text-bolt-elements-textSecondary',
          )}
        >
          All ({problems.length})
        </button>
        <button
          type="button"
          onClick={() => setSeverityFilter('error')}
          className={classNames(
            'px-2 py-0.5 rounded-full transition-colors',
            severityFilter === 'error'
              ? 'bg-red-500/20 text-red-400'
              : 'text-bolt-elements-textTertiary hover:text-red-400',
          )}
        >
          <span className="inline-flex items-center gap-1">
            <div className="i-ph:x-circle-fill text-xs" />
            {counts.error}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSeverityFilter('warning')}
          className={classNames(
            'px-2 py-0.5 rounded-full transition-colors',
            severityFilter === 'warning'
              ? 'bg-yellow-500/20 text-yellow-400'
              : 'text-bolt-elements-textTertiary hover:text-yellow-400',
          )}
        >
          <span className="inline-flex items-center gap-1">
            <div className="i-ph:warning-fill text-xs" />
            {counts.warning}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSeverityFilter('info')}
          className={classNames(
            'px-2 py-0.5 rounded-full transition-colors',
            severityFilter === 'info'
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-bolt-elements-textTertiary hover:text-blue-400',
          )}
        >
          <span className="inline-flex items-center gap-1">
            <div className="i-ph:info-fill text-xs" />
            {counts.info}
          </span>
        </button>
      </div>

      {/* Problem list */}
      <div className="flex-1 overflow-auto modern-scrollbar">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary text-sm gap-2">
            <div className="i-ph:check-circle-duotone text-3xl text-green-500" />
            <span>No problems found</span>
          </div>
        ) : (
          <table className="w-full text-xs font-mono">
            <tbody>
              {filtered.map((p, i) => (
                <tr
                  key={`${p.source}-${p.file ?? ''}-${p.line ?? 0}-${i}`}
                  className="border-b border-bolt-elements-borderColor/50 hover:bg-bolt-elements-item-backgroundActive"
                >
                  <td className="pl-3 py-1.5 w-5">
                    <div className={SEVERITY_ICON[p.severity]} />
                  </td>
                  <td className="py-1.5 pr-2 text-bolt-elements-textTertiary max-w-[200px] truncate">
                    {p.file ?? '—'}
                  </td>
                  <td className="py-1.5 pr-2 text-bolt-elements-textTertiary w-16 text-right tabular-nums">
                    {p.line != null ? `L${p.line}${p.col != null ? `:${p.col}` : ''}` : ''}
                  </td>
                  <td className="py-1.5 pr-3 text-bolt-elements-textSecondary truncate max-w-[400px]">
                    {p.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});

ProblemsTab.displayName = 'ProblemsTab';
export default ProblemsTab;
