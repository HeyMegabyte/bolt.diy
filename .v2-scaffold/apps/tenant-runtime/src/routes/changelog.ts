/**
 * Public per-tenant changelog. Streams D1 `snapshot` rows as Markdown
 * + JSON, so operators (and humans) can read the build history right
 * at the tenant origin.
 *
 * Routes:
 *   - `GET /changelog`        → text/markdown rendering of snapshot history
 *   - `GET /changelog.json`   → same data as JSON (used by the dashboard's
 *                                 `public-changelog.component.ts`)
 *
 * @remarks
 *  Reads are bounded to the last 200 snapshots so a runaway build queue
 *  never blows up the response. `cache-control` is `public, max-age=60,
 *  stale-while-revalidate=600` — fresh enough that a tenant operator
 *  watching a deploy sees their entry within a minute.
 *
 * @see [[website-build-doctrine]] § Phase 2 (maximalist enrichment)
 */
import { Hono } from 'hono';
import type { AppContext } from '../env';

interface SnapshotRow {
  id: string;
  iteration: number;
  ai_description: string | null;
  ai_commit_message: string | null;
  perf: number | null;
  a11y: number | null;
  seo: number | null;
  captured_at: number;
}

const SELECT_SNAPSHOTS = `
  SELECT
    id,
    iteration,
    ai_description,
    ai_commit_message,
    json_extract(lighthouse_scores, '$.performance') AS perf,
    json_extract(lighthouse_scores, '$.accessibility') AS a11y,
    json_extract(lighthouse_scores, '$.seo')           AS seo,
    captured_at
  FROM snapshots
  ORDER BY iteration DESC, captured_at DESC
  LIMIT 200
`;

async function loadSnapshots(c: { env: AppContext['Bindings'] }): Promise<SnapshotRow[]> {
  // D1 binding is optional in development scaffolds. Skip cleanly.
  const db = c.env.SITE_DB;
  if (!db || typeof db.prepare !== 'function') return [];
  try {
    const { results } = await db.prepare(SELECT_SNAPSHOTS).all<SnapshotRow>();
    return results ?? [];
  } catch {
    // Schema not migrated yet — render empty rather than 500.
    return [];
  }
}

/** Render a single row as a Markdown changelog entry. */
function rowToMarkdown(row: SnapshotRow, tenantName: string): string {
  const date = new Date(row.captured_at).toISOString().slice(0, 10);
  const subject = row.ai_commit_message?.trim() || row.ai_description?.trim() || `Snapshot #${row.iteration}`;
  const scoreLine = [
    row.perf !== null ? `perf ${row.perf}` : null,
    row.a11y !== null ? `a11y ${row.a11y}` : null,
    row.seo !== null ? `seo ${row.seo}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const lines = [
    `## ${date} — iteration ${row.iteration}`,
    '',
    subject,
    '',
  ];
  if (scoreLine) lines.push(`_Lighthouse: ${scoreLine}_`, '');
  return lines.join('\n');
}

function renderMarkdown(rows: SnapshotRow[], tenantName: string): string {
  const header = [
    `# ${tenantName} — Changelog`,
    '',
    'Every customer-visible change we ship. Auto-published from build snapshots.',
    '',
  ].join('\n');
  if (rows.length === 0) {
    return `${header}\n_No snapshots yet — entries land here after the first successful build._`;
  }
  return header + rows.map((r) => rowToMarkdown(r, tenantName)).join('\n');
}

const app = new Hono<AppContext>();

app.get('/', async (c) => {
  const rows = await loadSnapshots(c);
  const md = renderMarkdown(rows, c.env.TENANT_NAME);
  return new Response(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=60, stale-while-revalidate=600',
    },
  });
});

app.get('/.json', async (c) => {
  const rows = await loadSnapshots(c);
  return c.json(
    {
      tenant: c.env.TENANT_NAME,
      slug: c.env.TENANT_SLUG,
      entries: rows.map((r) => ({
        id: r.id,
        iteration: r.iteration,
        ai_description: r.ai_description,
        ai_commit_message: r.ai_commit_message,
        lighthouse_scores: {
          performance: r.perf,
          accessibility: r.a11y,
          seo: r.seo,
        },
        captured_at: new Date(r.captured_at).toISOString(),
      })),
    },
    200,
    { 'cache-control': 'public, max-age=60, stale-while-revalidate=600' },
  );
});

export default app;
