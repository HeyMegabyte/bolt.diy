/**
 * @module pages/admin/table-sort-url
 *
 * Encode/decode a TanStack {@link SortingState} to/from a single URL query param
 * (`?sort=<colId>.<asc|desc>`) so admin table sort survives a hard refresh and is
 * shareable/bookmarkable (P3 — URL-synced table state). Single-column sort only —
 * the admin tables sort one column at a time. Decode validates the column id
 * against an allow-list so a hand-edited `?sort=` can never set an unknown/
 * non-sortable column.
 */
import type { SortingState } from '@tanstack/angular-table';

/** `[{ id:'created_at', desc:true }]` → `'created_at.desc'`; `[]` → `null`. */
export function formatSort(sorting: SortingState): string | null {
  const first = sorting[0];
  if (!first) return null;
  return `${first.id}.${first.desc ? 'desc' : 'asc'}`;
}

/**
 * `'created_at.desc'` → `[{ id:'created_at', desc:true }]`. Returns `[]` (no sort)
 * for null/empty, a malformed value, an unknown direction, or an id not in
 * `validIds`. `lastIndexOf('.')` so column ids containing dots still parse.
 */
export function parseSort(raw: string | null | undefined, validIds: readonly string[]): SortingState {
  if (!raw) return [];
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return [];
  const id = raw.slice(0, dot);
  const dir = raw.slice(dot + 1);
  if (!validIds.includes(id) || (dir !== 'asc' && dir !== 'desc')) return [];
  return [{ id, desc: dir === 'desc' }];
}
