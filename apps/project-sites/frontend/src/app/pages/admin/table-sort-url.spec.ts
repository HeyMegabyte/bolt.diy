import { formatSort, parseSort } from './table-sort-url';

/**
 * Guards the URL-synced table-sort contract (P3). A hand-edited / shared `?sort=`
 * must never set an unknown or non-sortable column — `parseSort` allow-lists ids.
 */
describe('table-sort-url', () => {
  const IDS = ['name', 'created_at', 'last_used_at'] as const;

  it('formats a sort to "<id>.<dir>"', () => {
    expect(formatSort([{ id: 'created_at', desc: true }])).toBe('created_at.desc');
    expect(formatSort([{ id: 'name', desc: false }])).toBe('name.asc');
  });

  it('formats an empty sort to null', () => {
    expect(formatSort([])).toBeNull();
  });

  it('parses a valid param', () => {
    expect(parseSort('created_at.desc', IDS)).toEqual([{ id: 'created_at', desc: true }]);
    expect(parseSort('name.asc', IDS)).toEqual([{ id: 'name', desc: false }]);
  });

  it('rejects an unknown column id (allow-list) → no sort', () => {
    expect(parseSort('password.desc', IDS)).toEqual([]);
    expect(parseSort('drop_table.asc', IDS)).toEqual([]);
  });

  it('rejects a malformed / empty / unknown-direction value → no sort', () => {
    expect(parseSort(null, IDS)).toEqual([]);
    expect(parseSort('', IDS)).toEqual([]);
    expect(parseSort('created_at', IDS)).toEqual([]);
    expect(parseSort('.desc', IDS)).toEqual([]);
    expect(parseSort('created_at.sideways', IDS)).toEqual([]);
  });

  it('round-trips format → parse', () => {
    const s = [{ id: 'last_used_at', desc: true }];
    expect(parseSort(formatSort(s), IDS)).toEqual(s);
  });
});
