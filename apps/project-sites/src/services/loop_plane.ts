/**
 * @module services/loop_plane
 *
 * @description
 * Converts /loop ledger items and fire reports into Plane issue shapes, so the
 * /loop cron can create real backlog items instead of only markdown files.
 *
 * @remarks
 * PURE + TOTAL + NEVER-THROWS. Every exported function returns safely regardless
 * of input shape; invalid/missing fields coerce to sensible defaults.
 */

/** One row of a /loop ledger. */
export interface LedgerItem {
  /** The raw task description text. */
  line: string;
  /** Whether the item is ticked (done). */
  checked: boolean;
  /** Optional priority or category tag (e.g. `"P1"`, `"bug"`, `"feature"`). */
  tag?: string;
}

/** Summary of a single /loop fire cycle. */
export interface FireReport {
  /** Number of items completed in this fire. */
  tickedCount: number;
  /** Number of items parked (deferred) in this fire. */
  parkedCount: number;
  /** Wall-clock duration of the fire in milliseconds. */
  elapsedMs: number;
}

/** Plane priority values the API accepts. */
export type PlanePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

/** Shape of a Plane issue, ready for `POST /api/v1/issues`. */
export interface PlaneIssue {
  title: string;
  description: string;
  priority: PlanePriority;
  labels: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a Plane priority from a ledger tag.
 *
 * @param tag - Optional tag string (e.g. `"P0"`, `"P1"`, `"bug"`).
 * @param checked - Whether the ledger item is done. Checked items default to
 *   `low` when no P-tag is present.
 * @returns A Plane priority value.
 */
function tagToPriority(tag: string | undefined, checked: boolean): PlanePriority {
  if (!tag) return checked ? 'low' : 'medium';

  const t = tag.trim().toUpperCase();
  if (t === 'P0') return 'urgent';
  if (t === 'P1') return 'high';
  if (t === 'P2') return 'medium';
  if (t === 'P3') return 'low';

  return checked ? 'low' : 'medium';
}

/**
 * Extract labels from a tag string.
 *
 * @param tag - Optional tag (e.g. `"P1,feature"`, `"bug"`).
 * @param checked - Whether the ledger item is done. Adds a `done` label when true.
 * @returns An array of label strings.
 */
function tagToLabels(tag: string | undefined, checked: boolean): string[] {
  const labels: string[] = [];
  if (tag) {
    for (const part of tag.split(',')) {
      const trimmed = part.trim();
      if (trimmed && trimmed.length > 0) {
        labels.push(trimmed);
      }
    }
  }
  if (checked && !labels.includes('done')) {
    labels.push('done');
  }
  return labels;
}

/**
 * Shorten a ledger line to a Plane-issue title (first line, ≤ 100 chars).
 *
 * @param line - The raw ledger line text.
 * @returns A concise title string.
 */
function lineToTitle(line: string): string {
  const firstLine = line.split('\n')[0] ?? '';
  const trimmed = firstLine.trim();
  if (trimmed.length <= 100) return trimmed;
  return `${trimmed.slice(0, 97)}...`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a ledger item to a Plane issue shape for the API.
 *
 * @param item - A parsed ledger row.
 * @returns A Plane-issue-compatible object.
 * @example
 * ```ts
 * const issue = ledgerItemToIssue({ line: 'Deploy new homepage', checked: false, tag: 'P1' });
 * // { title: 'Deploy new homepage', description: 'Deploy new homepage',
 * //   priority: 'high', labels: ['P1'] }
 * ```
 */
export function ledgerItemToIssue(item: LedgerItem): PlaneIssue {
  const line = typeof item?.line === 'string' ? item.line : '';
  const checked = item?.checked === true;
  const tag = typeof item?.tag === 'string' ? item.tag : undefined;

  return {
    description: line || '(empty)',
    labels: tagToLabels(tag, checked),
    priority: tagToPriority(tag, checked),
    title: lineToTitle(line),
  };
}

/**
 * Build a human-readable Plane issue comment from a fire report.
 *
 * @param report - The fire cycle summary.
 * @returns A markdown string suitable as a Plane issue comment.
 * @example
 * ```ts
 * const comment = fireReportToComment({ tickedCount: 5, parkedCount: 2, elapsedMs: 300_000 });
 * // comment is a multi-line markdown string with Ticked/Parked/Duration
 * ```
 */
export function fireReportToComment(report: FireReport): string {
  const ticked = typeof report?.tickedCount === 'number' ? report.tickedCount : 0;
  const parked = typeof report?.parkedCount === 'number' ? report.parkedCount : 0;
  const ms = typeof report?.elapsedMs === 'number' ? report.elapsedMs : 0;

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const duration = minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;

  const lines: string[] = ['**/loop fire**'];
  lines.push(`- Ticked: ${ticked}`);
  lines.push(`- Parked: ${parked}`);
  lines.push(`- Duration: ${duration}`);
  return lines.join('\n');
}

/**
 * Summarize the last N fire reports as a Plane cycle note.
 *
 * @param reports - A readonly array of fire cycle summaries.
 * @returns A markdown string suitable as a Plane cycle note (or a fallback
 *   message when the array is empty).
 * @example
 * ```ts
 * const note = summarizeFires([
 *   { tickedCount: 3, parkedCount: 1, elapsedMs: 120_000 },
 *   { tickedCount: 5, parkedCount: 2, elapsedMs: 300_000 },
 * ]);
 * // note is a markdown summary with totals and averages
 * ```
 */
export function summarizeFires(reports: readonly FireReport[]): string {
  if (!Array.isArray(reports) || reports.length === 0) {
    return 'No fires recorded this cycle.';
  }

  let totalTicked = 0;
  let totalParked = 0;
  let totalMs = 0;

  for (const r of reports) {
    totalTicked += typeof r?.tickedCount === 'number' ? r.tickedCount : 0;
    totalParked += typeof r?.parkedCount === 'number' ? r.parkedCount : 0;
    totalMs += typeof r?.elapsedMs === 'number' ? r.elapsedMs : 0;
  }

  const avgTicked = (totalTicked / reports.length).toFixed(1);
  const avgParked = (totalParked / reports.length).toFixed(1);

  const totalSeconds = Math.floor(totalMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalRemainingSeconds = totalSeconds % 60;
  const totalDuration =
    totalMinutes > 0 ? `${totalMinutes}m ${totalRemainingSeconds}s` : `${totalSeconds}s`;

  const avgSeconds = Math.floor(totalMs / reports.length / 1000);
  const avgMinutes = Math.floor(avgSeconds / 60);
  const avgRemainingSeconds = avgSeconds % 60;
  const avgDuration = avgMinutes > 0 ? `${avgMinutes}m ${avgRemainingSeconds}s` : `${avgSeconds}s`;

  const lines: string[] = [
    '## /loop Cycle Summary',
    '',
    `**Total fires:** ${reports.length}`,
    `**Total ticked:** ${totalTicked}`,
    `**Total parked:** ${totalParked}`,
    `**Total duration:** ${totalDuration}`,
    '',
    `**Avg ticked/fire:** ${avgTicked}`,
    `**Avg parked/fire:** ${avgParked}`,
    `**Avg duration/fire:** ${avgDuration}`,
    `**Throughput:** ${avgTicked} items per fire`,
  ];

  return lines.join('\n');
}
