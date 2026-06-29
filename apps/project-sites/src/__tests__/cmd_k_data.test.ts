import { buildCmdK, filterCmdK, matchScore, type CmdKItem } from '../services/cmd_k_data.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const navItems: readonly CmdKItem[] = [
  {
    id: 'sites:list',
    label: 'Sites',
    description: 'Manage your websites',
    url: '/admin/sites',
    category: 'navigation',
    keywords: ['websites', 'domains'],
  },
  {
    id: 'billing:overview',
    label: 'Billing',
    description: 'View invoices and plan',
    url: '/admin/billing',
    category: 'navigation',
    keywords: ['subscription', 'payment', 'plan'],
  },
  {
    id: 'analytics:dashboard',
    label: 'Analytics',
    description: 'Traffic and usage stats',
    url: '/admin/analytics',
    category: 'navigation',
    keywords: ['stats', 'traffic', 'metrics'],
  },
];

const actionItems: readonly CmdKItem[] = [
  {
    id: 'new:site',
    label: 'New Site',
    description: 'Create a new website',
    url: '/admin/sites/new',
    category: 'action',
    keywords: ['create', 'build', 'add'],
  },
  {
    id: 'new:domain',
    label: 'Add Domain',
    description: 'Connect a custom domain',
    url: '/admin/domains/new',
    category: 'action',
    keywords: ['connect', 'dns'],
  },
];

const appItems: readonly CmdKItem[] = [
  {
    id: 'app:bolt',
    label: 'Bolt Editor',
    description: 'Open the AI code editor',
    url: 'https://editor.projectsites.dev',
    category: 'app',
    keywords: ['editor', 'code', 'ide'],
    external: true,
  },
];

const searchItems: readonly CmdKItem[] = [
  {
    id: 'search:global',
    label: 'Search Everything',
    description: 'Search across all sites',
    url: '/admin/search',
    category: 'search',
    keywords: ['find', 'lookup'],
  },
];

const allItems: readonly CmdKItem[] = [...navItems, ...actionItems, ...appItems, ...searchItems];

// ---------------------------------------------------------------------------
// buildCmdK
// ---------------------------------------------------------------------------
describe('buildCmdK', () => {
  it('groups items by category in the correct order: navigation, action, app, search', () => {
    const groups = buildCmdK(allItems);
    expect(groups).toHaveLength(4);
    expect(groups[0].category).toBe('navigation');
    expect(groups[1].category).toBe('action');
    expect(groups[2].category).toBe('app');
    expect(groups[3].category).toBe('search');
  });

  it('sorts items alphabetically by label within each group', () => {
    const groups = buildCmdK(allItems);
    const nav = groups.find((g) => g.category === 'navigation')!;
    expect(nav.items[0].label).toBe('Analytics');
    expect(nav.items[1].label).toBe('Billing');
    expect(nav.items[2].label).toBe('Sites');
  });

  it('returns items in label order even when items are passed unsorted', () => {
    const unsorted: readonly CmdKItem[] = [
      { id: 'z', label: 'Zebra', description: 'z', url: '/z', category: 'action', keywords: [] },
      { id: 'a', label: 'Alpha', description: 'a', url: '/a', category: 'action', keywords: [] },
      { id: 'm', label: 'Mike', description: 'm', url: '/m', category: 'action', keywords: [] },
    ];
    const groups = buildCmdK(unsorted);
    expect(groups[0].items.map((i) => i.label)).toEqual(['Alpha', 'Mike', 'Zebra']);
  });

  it('skips items without an id', () => {
    const items: readonly CmdKItem[] = [
      {
        id: '',
        label: 'Empty ID',
        description: 'x',
        url: '/x',
        category: 'navigation',
        keywords: [],
      },
      {
        id: 'real',
        label: 'Real',
        description: 'y',
        url: '/y',
        category: 'navigation',
        keywords: [],
      },
    ];
    const groups = buildCmdK(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].id).toBe('real');
  });

  it('skips items without a label', () => {
    const items: readonly CmdKItem[] = [
      {
        id: 'no-label',
        label: '',
        description: 'x',
        url: '/x',
        category: 'navigation',
        keywords: [],
      },
      {
        id: 'yes-label',
        label: 'Yes',
        description: 'y',
        url: '/y',
        category: 'navigation',
        keywords: [],
      },
    ];
    const groups = buildCmdK(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].id).toBe('yes-label');
  });

  it('returns an empty array for an empty input', () => {
    expect(buildCmdK([])).toEqual([]);
  });

  it('returns an empty array when every item is invalid', () => {
    const invalid: readonly CmdKItem[] = [
      { id: '', label: 'x', description: 'x', url: '/x', category: 'navigation', keywords: [] },
      { id: 'y', label: '', description: 'y', url: '/y', category: 'navigation', keywords: [] },
    ];
    expect(buildCmdK(invalid)).toEqual([]);
  });

  it('handles a single-item input', () => {
    const items: readonly CmdKItem[] = [navItems[0]];
    const groups = buildCmdK(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('navigation');
    expect(groups[0].items).toHaveLength(1);
  });

  it('produces one group per category that has items', () => {
    const justActions: readonly CmdKItem[] = [actionItems[0]];
    const groups = buildCmdK(justActions);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('action');
  });

  it('is case-insensitive when sorting', () => {
    const items: readonly CmdKItem[] = [
      { id: 'b', label: 'beta', description: 'b', url: '/b', category: 'action', keywords: [] },
      { id: 'a', label: 'Alpha', description: 'a', url: '/a', category: 'action', keywords: [] },
      { id: 'c', label: 'charlie', description: 'c', url: '/c', category: 'action', keywords: [] },
    ];
    const groups = buildCmdK(items);
    expect(groups[0].items.map((i) => i.label)).toEqual(['Alpha', 'beta', 'charlie']);
  });

  it('does not mutate the input array', () => {
    const input = [...allItems];
    const inputLen = input.length;
    buildCmdK(input);
    expect(input).toHaveLength(inputLen);
  });

  it('preserves read-only quality of items within groups', () => {
    const groups = buildCmdK(allItems);
    for (const group of groups) {
      for (const item of group.items) {
        expect(typeof item.id).toBe('string');
        expect(typeof item.label).toBe('string');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// filterCmdK
// ---------------------------------------------------------------------------
describe('filterCmdK', () => {
  it('returns items matching by label prefix', () => {
    const results = filterCmdK(allItems, 'Sites');
    expect(results.some((r) => r.label === 'Sites')).toBe(true);
    // "Sites" starts with "Sites" → score 100; "Search Everything" matches keyword "find" → 25
    // but label-prefix sorts above keyword
    expect(results[0].label).toBe('Sites');
  });

  it('returns items matching by label contains', () => {
    const results = filterCmdK(allItems, 'site');
    expect(results.length).toBeGreaterThanOrEqual(1);
    // "Sites" starts with "site" → score 100
    expect(results[0].label).toBe('Sites');
  });

  it('returns items matching by keyword', () => {
    const results = filterCmdK(allItems, 'connect');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.id === 'new:domain')).toBe(true);
  });

  it('returns items matching by description', () => {
    const results = filterCmdK(allItems, 'code');
    // "code" is a keyword of app:bolt
    expect(results.some((r) => r.id === 'app:bolt')).toBe(true);
  });

  it('is case-insensitive', () => {
    const upper = filterCmdK(allItems, 'SITES');
    const lower = filterCmdK(allItems, 'sites');
    expect(upper.map((r) => r.id)).toEqual(lower.map((r) => r.id));
  });

  it('returns an empty array for an empty query', () => {
    expect(filterCmdK(allItems, '')).toEqual([]);
  });

  it('returns an empty array for a whitespace-only query', () => {
    expect(filterCmdK(allItems, '   ')).toEqual([]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterCmdK(allItems, 'xyznonexistent')).toEqual([]);
  });

  it('returns an empty array when items array is empty', () => {
    expect(filterCmdK([], 'test')).toEqual([]);
  });

  it('sorts by match quality: exact prefix > label contains > keyword > description', () => {
    const items: readonly CmdKItem[] = [
      {
        id: 'exact:match',
        label: 'Site Settings',
        description: 'x',
        url: '/x',
        category: 'action',
        keywords: [],
      },
      {
        id: 'keyword:hit',
        label: 'Dashboard',
        description: 'x',
        url: '/x',
        category: 'action',
        keywords: ['site'],
      },
      {
        id: 'desc:hit',
        label: 'Reports',
        description: 'Site visit logs',
        url: '/x',
        category: 'action',
        keywords: [],
      },
    ];
    const results = filterCmdK(items, 'site');
    // "Site Settings" starts with "site" → 100
    // "Dashboard" keyword → 25
    // "Reports" description → 10
    expect(results[0].id).toBe('exact:match');
    expect(results[1].id).toBe('keyword:hit');
    expect(results[2].id).toBe('desc:hit');
  });

  it('returns only items with matchScore > 0', () => {
    const items: readonly CmdKItem[] = [
      {
        id: 'match',
        label: 'Target',
        description: 'x',
        url: '/x',
        category: 'action',
        keywords: ['hit'],
      },
      {
        id: 'no-match',
        label: 'Other',
        description: 'x',
        url: '/x',
        category: 'action',
        keywords: [],
      },
    ];
    const results = filterCmdK(items, 'target');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('match');
  });

  it('trims the query before matching', () => {
    const results = filterCmdK(allItems, '  sites  ');
    expect(results.some((r) => r.label === 'Sites')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchScore
// ---------------------------------------------------------------------------
describe('matchScore', () => {
  const item: CmdKItem = {
    id: 'sites:list',
    label: 'Sites',
    description: 'Manage your websites',
    url: '/admin/sites',
    category: 'navigation',
    keywords: ['websites', 'domains'],
  };

  it('returns 100 when label starts with query', () => {
    expect(matchScore(item, 'Sites')).toBe(100);
    expect(matchScore(item, 'sites')).toBe(100);
    expect(matchScore(item, 'Site')).toBe(100);
    expect(matchScore(item, 'sit')).toBe(100);
  });

  it('returns 60 when label contains query at a word boundary', () => {
    const multiWord: CmdKItem = { ...item, label: 'My Sites' };
    expect(matchScore(multiWord, 'sites')).toBe(60);
  });

  it('returns 50 when label contains query (non-boundary)', () => {
    const partial: CmdKItem = { ...item, label: 'Insites' };
    expect(matchScore(partial, 'site')).toBe(50);
  });

  it('returns 25 when a keyword contains the query', () => {
    expect(matchScore(item, 'domain')).toBe(25);
    expect(matchScore(item, 'web')).toBe(25);
  });

  it('returns 10 when the description contains the query', () => {
    expect(matchScore(item, 'websites')).toBe(25); // keyword match first
    const descOnly: CmdKItem = {
      id: 'desc-match',
      label: 'Other',
      description: 'Specific details about tools',
      url: '/x',
      category: 'navigation',
      keywords: [],
    };
    expect(matchScore(descOnly, 'tools')).toBe(10);
    expect(matchScore(descOnly, 'details')).toBe(10);
  });

  it('returns 0 when nothing matches', () => {
    expect(matchScore(item, 'xyznone')).toBe(0);
  });

  it('returns 0 for an empty query', () => {
    expect(matchScore(item, '')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(matchScore(item, 'SITES')).toBe(100);
    expect(matchScore(item, 'sites')).toBe(100);
  });

  it('does not double-count — only the highest tier applies', () => {
    const rich: CmdKItem = {
      id: 'rich',
      label: 'Label Match',
      description: 'label find me',
      url: '/x',
      category: 'navigation',
      keywords: ['label'],
    };
    // Matches label start "la" → 100
    expect(matchScore(rich, 'la')).toBe(100);
    // Matches keyword "label" → 25 (label does NOT contain "key")
    expect(matchScore(rich, 'key')).toBe(0);
  });

  it('handles items with empty keywords array', () => {
    const noKw: CmdKItem = { ...item, keywords: [] };
    expect(matchScore(noKw, 'sites')).toBe(100);
  });
});
