/**
 * Map a claimyour.site prefill payload (the worker's `toCreateFormPrefill` output,
 * keyed by ClaimLeadProfile field names) onto the /create component's field names.
 *
 * @remarks
 * Pure — the component fetches `GET /api/claim/:shortlink/profile` then applies
 * this to its `business*` fields. Only non-empty string values map through, so a
 * partial researched profile never blanks a field.
 *
 * @example
 * ```ts
 * const f = mapClaimPrefillToFields(res.data.prefill);
 * if (f.businessName) this.businessName = f.businessName;
 * ```
 */
export interface CreatePrefillFields {
  businessName?: string;
  businessAddress?: string;
  businessPhone?: string;
  businessWebsite?: string;
  businessCategory?: string;
  additionalContext?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

/** A claim build's lifecycle status as seen by the /create page. */
export type ClaimBuildStatus = 'pending' | 'building' | 'completed' | 'failed' | 'unknown';

/** Parsed build state for the claim funnel banner + poll loop. */
export interface ClaimBuildState {
  /** Normalized status; unrecognized/absent values collapse to 'unknown'. */
  status: ClaimBuildStatus;
  /** The live preview URL once the build completes, else null. */
  previewUrl: string | null;
  /** True once the build reached a terminal state → the poll loop can stop. */
  terminal: boolean;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set(['pending', 'building', 'completed', 'failed']);

/**
 * Parse the `data` of a `GET /api/claim/:shortlink/profile` response into the
 * build state the /create funnel renders + polls on. Pure + total — any
 * malformed/absent payload yields `{ status: 'unknown', previewUrl: null,
 * terminal: false }` so a bad response never wedges the poll loop OR shows a
 * preview link that doesn't exist.
 *
 * @param data - The profile response `data` ({ buildStatus?, previewUrl? }).
 * @returns A {@link ClaimBuildState}. `terminal` is true only for completed/failed.
 * @example
 * parseClaimBuildState({ buildStatus: 'building' })
 * // → { status: 'building', previewUrl: null, terminal: false }
 * parseClaimBuildState({ buildStatus: 'completed', previewUrl: 'https://x.projectsites.dev' })
 * // → { status: 'completed', previewUrl: 'https://x.projectsites.dev', terminal: true }
 */
export function parseClaimBuildState(
  data: { buildStatus?: unknown; previewUrl?: unknown } | null | undefined,
): ClaimBuildState {
  const raw = typeof data?.buildStatus === 'string' ? data.buildStatus : '';
  const status: ClaimBuildStatus = KNOWN_STATUSES.has(raw) ? (raw as ClaimBuildStatus) : 'unknown';
  const previewUrl = status === 'completed' ? (str(data?.previewUrl) ?? null) : null;
  const terminal = status === 'completed' || status === 'failed';
  return { status, previewUrl, terminal };
}

/**
 * Translate a claim prefill payload into /create field values.
 *
 * @param prefill - The `data.prefill` object from the claim profile endpoint.
 * @returns Only the fields present as non-empty strings.
 */
export function mapClaimPrefillToFields(prefill: Record<string, unknown>): CreatePrefillFields {
  const out: CreatePrefillFields = {};
  const name = str(prefill['businessName']);
  if (name) out.businessName = name;
  const address = str(prefill['address']);
  if (address) out.businessAddress = address;
  const phone = str(prefill['phone']);
  if (phone) out.businessPhone = phone;
  const website = str(prefill['existingWebsite']) ?? str(prefill['website']);
  if (website) out.businessWebsite = website;
  const category = str(prefill['category']);
  if (category) out.businessCategory = category;
  const context = str(prefill['description']) ?? str(prefill['notes']);
  if (context) out.additionalContext = context;
  return out;
}
