/** Stateless NL→SQL intent parser. Pure function, no I/O. */
import type { QueryResponse } from './schemas.js';

interface Pattern { regex: RegExp; sql: string; explain: string }

const PATTERNS: Pattern[] = [
  { regex: /how many (sites|projects)/i, sql: "SELECT COUNT(*) as value FROM sites WHERE org_id = ? AND deleted_at IS NULL", explain: "Counting all active sites in your org" },
  { regex: /how many (builds|deploys)/i, sql: "SELECT COUNT(*) as value FROM workflow_jobs WHERE org_id = ? AND job_name='build' AND deleted_at IS NULL", explain: "Counting all builds in your org" },
  { regex: /(builds|deploys) this month/i, sql: "SELECT COUNT(*) as value FROM workflow_jobs WHERE org_id = ? AND job_name='build' AND created_at >= datetime('now','start of month') AND deleted_at IS NULL", explain: "Counting builds created this calendar month" },
  { regex: /most active site/i, sql: "SELECT s.business_name as label, COUNT(w.id) as value FROM sites s LEFT JOIN workflow_jobs w ON w.site_id = s.id AND w.deleted_at IS NULL WHERE s.org_id = ? AND s.deleted_at IS NULL GROUP BY s.id ORDER BY value DESC LIMIT 1", explain: "Finding the site with the most workflow jobs" },
  { regex: /sites by status/i, sql: "SELECT status as label, COUNT(*) as value FROM sites WHERE org_id = ? AND deleted_at IS NULL GROUP BY status ORDER BY value DESC", explain: "Grouping sites by their current status" },
  { regex: /(recent|latest) (builds|activity)/i, sql: "SELECT s.business_name as label, w.job_name as detail, w.created_at as ts FROM workflow_jobs w JOIN sites s ON s.id = w.site_id WHERE s.org_id = ? AND w.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY w.created_at DESC LIMIT 10", explain: "Showing the 10 most recent workflow jobs" },
  { regex: /how many (members|users|team)/i, sql: "SELECT COUNT(*) as value FROM memberships WHERE org_id = ? AND deleted_at IS NULL", explain: "Counting team members in your org" },
];

export function parseQuery(question: string): QueryResponse {
  for (const p of PATTERNS) {
    if (p.regex.test(question)) {
      return { sql: p.sql, explanation: p.explain, question };
    }
  }
  return {
    sql: "SELECT 'Try: how many sites, builds this month, most active site, sites by status, recent builds, or how many members' as hint",
    explanation: "I didn't recognize that question pattern. Here are some things I can answer: site count, build count, recent activity, team size, sites by status.",
    question,
  };
}
