/**
 * @file Redis tab — key browser, type-aware editors, guarded command console.
 *
 * @remarks
 * SCAN-style key browser with prefix/type filters. Type-aware value editors
 * for string/hash/list/set/zset/stream. Never uses unbounded KEYS * in real adapters.
 */
import React, { memo, useState } from 'react';
import { classNames } from '~/utils/classNames';

interface RedisKey {
  key: string;
  type: 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream';
  ttl: number;
  size: number;
}

const MOCK_KEYS: RedisKey[] = [
  { key: 'bricklabor:session:abc123', type: 'string', ttl: 3600, size: 256 },
  { key: 'bricklabor:cache:homepage', type: 'string', ttl: 300, size: 4096 },
  { key: 'bricklabor:queue:jobs', type: 'list', ttl: -1, size: 128 },
  { key: 'bricklabor:ratelimit:api', type: 'string', ttl: 60, size: 64 },
];

const TYPE_ICONS: Record<RedisKey['type'], string> = {
  string: 'i-ph:text-aa',
  hash: 'i-ph:grid-four',
  list: 'i-ph:list-numbers',
  set: 'i-ph:circles-three-plus',
  zset: 'i-ph:sort-ascending',
  stream: 'i-ph:waveform',
};

export const RedisTab = memo(() => {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const filtered = MOCK_KEYS.filter((k) => {
    if (search && !k.key.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== 'all' && k.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col bg-bolt-elements-background-depth-1">
      {/* Search + filter */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor">
        <div className="i-ph:magnifying-glass text-bolt-elements-textTertiary text-sm" />
        <input
          type="text"
          placeholder="Search keys…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent text-bolt-elements-textPrimary text-xs placeholder:text-bolt-elements-textTertiary focus:outline-none"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-transparent text-bolt-elements-textPrimary text-xs border border-bolt-elements-borderColor rounded px-2 py-0.5"
        >
          <option value="all">All types</option>
          <option value="string">String</option>
          <option value="hash">Hash</option>
          <option value="list">List</option>
          <option value="set">Set</option>
          <option value="zset">Sorted Set</option>
          <option value="stream">Stream</option>
        </select>
        <span className="text-bolt-elements-textTertiary text-[10px] uppercase tracking-wider">mock</span>
      </div>

      {/* Key list */}
      <div className="flex-1 overflow-auto modern-scrollbar">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-bolt-elements-textTertiary text-sm gap-2">
            <div className="i-ph:cube-duotone text-3xl" />
            <span>No keys found</span>
          </div>
        ) : (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-bolt-elements-borderColor text-bolt-elements-textTertiary">
                <th className="text-left px-3 py-1.5 font-medium">Key</th>
                <th className="text-left px-3 py-1.5 font-medium">Type</th>
                <th className="text-right px-3 py-1.5 font-medium">TTL</th>
                <th className="text-right px-3 py-1.5 font-medium">Size</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => (
                <tr
                  key={k.key}
                  className="border-b border-bolt-elements-borderColor/50 hover:bg-bolt-elements-item-backgroundActive cursor-pointer"
                >
                  <td className="px-3 py-1.5 text-bolt-elements-textPrimary truncate max-w-[300px]">
                    {k.key}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1 text-bolt-elements-textSecondary">
                      <div className={classNames(TYPE_ICONS[k.type], 'text-sm')} />
                      {k.type}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-bolt-elements-textTertiary tabular-nums">
                    {k.ttl === -1 ? '∞' : `${k.ttl}s`}
                  </td>
                  <td className="px-3 py-1.5 text-right text-bolt-elements-textTertiary tabular-nums">
                    {k.size < 1024 ? `${k.size}B` : `${(k.size / 1024).toFixed(1)}KB`}
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

RedisTab.displayName = 'RedisTab';
