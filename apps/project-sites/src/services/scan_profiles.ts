/**
 * Scan profiles — the editable "what to hunt" config for the automatic Lead
 * Scanner (top-14 #5). An operator edits a profile's geo / categories / providers
 * / filters / cadence (the "change the scanner verbiage" controller) and the cron
 * geo-sweep iterates the due profiles, running each bbox through the orchestrator.
 *
 * @remarks
 * Pure + Zod-validated (no env/I/O). The schema is the SSOT; the cron reads
 * `listDueProfiles` and expands `profile.bboxes` into orchestrator runs. Storage
 * (D1 or a Twenty custom object) and the cron live in the route/scheduler layer.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Discovery providers a profile may use. */
export const ScanProviderSchema = z.enum(['osm', 'places', 'sos']);
export type ScanProvider = z.infer<typeof ScanProviderSchema>;

/** A bounding box [south, west, north, east]. */
export const BBoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type BBox = z.infer<typeof BBoxSchema>;

/** The editable scan profile. */
export const ScanProfileConfigSchema = z
  .object({
    id: z.string().min(1),
    /** Human name, e.g. "Newark trades — weekly". */
    name: z.string().min(1).max(120),
    /** Off by default — a profile only runs when explicitly enabled. */
    enabled: z.boolean().default(false),
    /** Bounding boxes to sweep (one orchestrator run each). */
    bboxes: z.array(BBoxSchema).min(1).max(500),
    /** OSM/Places category keys to hunt. */
    categories: z.array(z.string().min(1)).max(24).default([]),
    /** Providers, in preference order. */
    providers: z.array(ScanProviderSchema).min(1).default(['osm']),
    /**
     * Free-text operator intent (e.g. "businesses incorporated in the last 6
     * months", "rating >= 4"). The editable VERBIAGE — surfaced to the provider
     * query builder + recorded on the lead for traceability.
     */
    filters: z.string().max(500).default(''),
    /** Provenance label written to the CRM. */
    source: z.string().min(1).default('osm'),
    /** Max leads sunk per bbox run (cost guard). */
    maxLeadsPerRun: z.number().int().min(1).max(500).default(50),
    /** How often to run (minutes). 0/absent → manual-only. */
    intervalMinutes: z.number().int().min(0).max(43200).default(0),
    /** Last successful run (epoch ms), null when never run. */
    lastRunAt: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();

export type ScanProfileConfig = z.infer<typeof ScanProfileConfigSchema>;

/**
 * Validate raw profile input. Returns the parsed config or a flat error map.
 *
 * @param raw - Untrusted profile object (from the admin form / storage).
 * @returns `{ ok: true, profile }` or `{ ok: false, errors }`.
 */
export function validateScanProfile(
  raw: unknown,
):
  | { ok: true; profile: ScanProfileConfig }
  | { ok: false; errors: Record<string, string[]> } {
  const parsed = ScanProfileConfigSchema.safeParse(raw);
  if (parsed.success) return { ok: true, profile: parsed.data };
  return { ok: false, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
}

/**
 * Whether a profile is due to run now.
 *
 * @remarks A profile is due when enabled AND has a positive interval AND
 * (never run OR `nowMs - lastRunAt >= intervalMinutes`). Manual-only profiles
 * (`intervalMinutes === 0`) are never auto-due.
 *
 * @param profile - The profile.
 * @param nowMs - Current time (epoch ms; injected for determinism).
 * @returns true when the cron should run it.
 */
export function isProfileDue(profile: ScanProfileConfig, nowMs: number): boolean {
  if (!profile.enabled || profile.intervalMinutes <= 0) return false;
  if (profile.lastRunAt == null) return true;
  return nowMs - profile.lastRunAt >= profile.intervalMinutes * 60_000;
}

/**
 * Filter a set of profiles to the ones due now (stable order).
 *
 * @param profiles - All profiles.
 * @param nowMs - Current time (epoch ms).
 * @returns The due profiles.
 */
export function listDueProfiles(
  profiles: readonly ScanProfileConfig[],
  nowMs: number,
): ScanProfileConfig[] {
  return profiles.filter((p) => isProfileDue(p, nowMs));
}

/**
 * Expand a profile into per-bbox orchestrator inputs (source + addressSource +
 * maxLeads + the bbox/categories the route's discover closure consumes).
 *
 * @param profile - The scan profile.
 * @returns One run spec per bbox.
 */
export function profileToRunSpecs(profile: ScanProfileConfig): Array<{
  source: string;
  bbox: BBox;
  categories: string[];
  maxLeads: number;
}> {
  return profile.bboxes.map((bbox) => ({
    source: profile.source,
    bbox,
    categories: profile.categories,
    maxLeads: profile.maxLeadsPerRun,
  }));
}

/** A starter profile (disabled) the admin UI can clone. */
export function defaultScanProfile(id: string): ScanProfileConfig {
  return ScanProfileConfigSchema.parse({
    id,
    name: 'New scan profile',
    enabled: false,
    bboxes: [[40.69, -74.27, 40.79, -74.13]], // Newark, NJ sample
    categories: ['shop', 'craft', 'office'],
    providers: ['osm'],
    filters: '',
    source: 'osm',
    maxLeadsPerRun: 50,
    intervalMinutes: 0,
    lastRunAt: null,
  });
}
