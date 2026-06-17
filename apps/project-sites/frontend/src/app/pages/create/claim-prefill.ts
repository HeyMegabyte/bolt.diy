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
