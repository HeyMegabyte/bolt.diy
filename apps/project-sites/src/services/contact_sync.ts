/**
 * @module services/contact_sync
 * @description Cross-app contact sync merger for Listmonk↔Twenty and
 * ProjectSites contacts. Pure functions — zero I/O, zero side-effects.
 *
 * Three operations:
 * - {@link mergeContacts} — newer `lastUpdated` wins, attribs deep-merged.
 * - {@link dedupeContacts} — deduplicate an array by email, most-recent-wins.
 * - {@link diffContacts} — compute add/update/remove sets between two arrays.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Contact shape
// ---------------------------------------------------------------------------

/**
 * A unified contact record across Listmonk, Twenty, and ProjectSites.
 *
 * @remarks
 * `lastUpdated` is a Unix-ms timestamp used as the conflict-resolution key.
 * `attribs` carry per-source metadata (listmonk list IDs, twenty record IDs,
 * tags, custom fields). Sources: `'listmonk' | 'twenty' | 'projectsites'`.
 *
 * @example
 * ```ts
 * const a: Contact = {
 *   email: 'alice@example.com',
 *   name: 'Alice',
 *   source: 'listmonk',
 *   lastUpdated: 1719000000000,
 *   attribs: { list_id: '3', city: 'Newark' },
 * };
 * ```
 */
export interface Contact {
  email: string;
  name: string;
  source: 'listmonk' | 'twenty' | 'projectsites';
  lastUpdated: number;
  attribs: Record<string, string>;
}

// ---------------------------------------------------------------------------
// mergeContacts
// ---------------------------------------------------------------------------

/**
 * Merge two {@link Contact} records for the same person (same email).
 *
 * @remarks
 * Newer `lastUpdated` wins the top-level fields. `attribs` are shallow-merged
 * with the WINNER's values preferred on key collision (newer record's attrs
 * are authoritative). The returned `lastUpdated` is the max of both inputs.
 *
 * @param a - First contact record
 * @param b - Second contact record
 * @returns A new Contact combining both inputs
 *
 * @example
 * ```ts
 * const merged = mergeContacts(a, b);
 * // merged.email === 'alice@example.com'
 * // merged.name === 'Alice' (newer wins)
 * // merged.attribs === { ...b.attribs, ...a.attribs } (if a is newer)
 * ```
 */
export function mergeContacts(a: Contact, b: Contact): Contact {
  const [newer, older] = a.lastUpdated >= b.lastUpdated ? [a, b] : [b, a];

  return {
    attribs: { ...older.attribs, ...newer.attribs },
    email: a.email,
    lastUpdated: Math.max(a.lastUpdated, b.lastUpdated),
    name: newer.name,
    source: newer.source,
  };
}

// ---------------------------------------------------------------------------
// dedupeContacts
// ---------------------------------------------------------------------------

/**
 * Deduplicate an array of contacts by email, keeping the most-recently-updated
 * record per email and merging attributes from discarded duplicates.
 *
 * @remarks
 * When two records share an email, {@link mergeContacts} resolves the conflict
 * (newer `lastUpdated` wins). The input array is not mutated. Order is
 * preserved by first-occurrence of each email.
 *
 * @param contacts - Input contact list
 * @returns Deduplicated contact array
 *
 * @example
 * ```ts
 * const deduped = dedupeContacts([a, sameEmailAsA, b]);
 * // deduped.length === 2
 * // deduped[0] is the merged result for sameEmailAsA's email
 * ```
 */
export function dedupeContacts(contacts: readonly Contact[]): Contact[] {
  const seen = new Map<string, Contact>();

  for (const c of contacts) {
    const existing = seen.get(c.email);
    seen.set(c.email, existing ? mergeContacts(existing, c) : c);
  }

  // Preserve insertion order
  const result: Contact[] = [];
  for (const c of contacts) {
    const stored = seen.get(c.email);
    if (stored && !result.includes(stored)) {
      result.push(stored);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// diffContacts
// ---------------------------------------------------------------------------

/**
 * Compute the add/update/remove sets to bring `source` in sync with `target`.
 *
 * @remarks
 * - **add**: contacts in `target` that have no email match in `source`.
 * - **update**: contacts in `target` whose email exists in `source` but
 *   `lastUpdated` differs — returned as the TARGET's record (what source
 *   should become).
 * - **remove**: emails present in `source` but absent from `target`.
 *
 * The diff is one-directional: it tells you what to do to `source` given
 * `target`. Run in both directions to bi-sync.
 *
 * @param source - Current contact set (e.g. Listmonk)
 * @param target - Desired contact set (e.g. Twenty)
 * @returns Three disjoint arrays: add, update, remove (emails)
 *
 * @example
 * ```ts
 * const { add, update, remove } = diffContacts(listmonkContacts, twentyContacts);
 * // `add` — create these in source
 * // `update` — overwrite these in source
 * // `remove` — delete these emails from source
 * ```
 */
export function diffContacts(
  source: readonly Contact[],
  target: readonly Contact[],
): { add: Contact[]; update: Contact[]; remove: string[] } {
  const sourceByEmail = new Map<string, Contact>();
  for (const c of source) {
    sourceByEmail.set(c.email, c);
  }

  const add: Contact[] = [];
  const update: Contact[] = [];
  const remove: string[] = [];

  // Build a set of all emails in target for fast removal detection
  const targetEmails = new Set<string>();
  for (const c of target) {
    targetEmails.add(c.email);

    const match = sourceByEmail.get(c.email);
    if (!match) {
      add.push(c);
    } else if (match.lastUpdated !== c.lastUpdated) {
      update.push(c);
    }
  }

  for (const c of source) {
    if (!targetEmails.has(c.email)) {
      remove.push(c.email);
    }
  }

  return { add, remove, update };
}
