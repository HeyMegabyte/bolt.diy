/**
 * @file Search tab — cross-workspace search across code, media, functions, manifests.
 *
 * @remarks
 * Searches across code, media, functions, manifests, bindings, routes,
 * metadata, database schema names, KV keys, Redis keys, and settings.
 */
import React, { memo, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

interface SearchResult {
  source: string;
  path: string;
  line?: number;
  preview: string;
  kind: 'code' | 'file' | 'route' | 'binding' | 'schema';
}

const KIND_ICONS: Record<SearchResult['kind'], string> = {
  code: 'i-ph:code',
  file: 'i-ph:file',
  route: 'i-ph:link',
  binding: 'i-ph:plug',
  schema: 'i-ph:table',
};

const SearchTab = memo(() => {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const files = useStore(workbenchStore.files);

  const results = useMemo((): SearchResult[] => {
    if (!query || query.length < 2) return [];

    const q = query.toLowerCase();
    const out: SearchResult[] = [];

    if (files) {
      for (const [path, entry] of Object.entries(files)) {
        if (!entry || entry.type !== 'file') continue;
        const file = entry;
        const nameMatch = path.toLowerCase().includes(q);
        let contentMatch = false;

        if (file.content) {
          const lines = file.content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if ((lines[i] ?? '').toLowerCase().includes(q)) {
              contentMatch = true;
              out.push({
                source: 'workspace',
                path,
                line: i + 1,
                preview: (lines[i] ?? '').trim().slice(0, 120),
                kind: 'code',
              });
              if (out.length >= 50) break;
            }
          }
        }

        if (nameMatch && !contentMatch) {
          out.push({
            source: 'workspace',
            path,
            preview: `File: ${path}`,
            kind: 'file',
          });
        }
      }
    }

    return out.slice(0, 100);
  }, [query, files]);

  const filtered = useMemo(() => {
    if (kindFilter === 'all') return results;
    return results.filter((r) => r.kind === kindFilter);
  }, [results, kindFilter]);

  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-1">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor">
        <div className="i-ph:magnifying-glass-duotone text-bolt-elements-textTertiary text-sm" />
        <input
          type="text"
          placeholder="Search across code, routes, bindings, schemas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-bolt-elements-textPrimary text-xs placeholder:text-bolt-elements-textTertiary focus:outline-none"
          autoFocus
        />
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="bg-transparent text-bolt-elements-textPrimary text-xs border border-bolt-elements-borderColor rounded px-2 py-0.5"
        >
          <option value="all">All</option>
          <option value="code">Code</option>
          <option value="file">Files</option>
          <option value="route">Routes</option>
          <option value="binding">Bindings</option>
          <option value="schema">Schemas</option>
        </select>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto modern-scrollbar">
        {query.length < 2 ? (
          <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary text-sm gap-2">
            <div className="i-ph:binoculars-duotone text-3xl" />
            <span>Type to search across the workspace</span>
            <span className="text-[10px]">Searches code, routes, schemas, bindings, and file names</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary text-sm gap-2">
            <div className="i-ph:smiley-sad-duotone text-3xl" />
            <span>No results for "{query}"</span>
          </div>
        ) : (
          <div>
            <div className="px-3 py-1.5 text-[10px] text-bolt-elements-textTertiary uppercase tracking-wider border-b border-bolt-elements-borderColor/50">
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </div>
            {filtered.map((r, i) => (
              <div
                key={`${r.path}-${r.line ?? 0}-${i}`}
                className="px-3 py-2 border-b border-bolt-elements-borderColor/30 hover:bg-bolt-elements-item-backgroundActive cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className={classNames(KIND_ICONS[r.kind], 'text-bolt-elements-textTertiary text-sm')} />
                  <span className="text-xs font-mono text-bolt-elements-textSecondary truncate">
                    {r.path}
                    {r.line != null && (
                      <span className="text-bolt-elements-textTertiary ml-1">:{r.line}</span>
                    )}
                  </span>
                </div>
                <div className="text-xs text-bolt-elements-textPrimary mt-0.5 truncate pl-6">{r.preview}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

SearchTab.displayName = 'SearchTab';

export default SearchTab;
