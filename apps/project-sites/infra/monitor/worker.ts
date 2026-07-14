/**
 * Site Health Auto-Rebuild Worker
 *
 * Cron-triggered health monitor for all published ProjectSites.
 * Checks each site via HTTP, tracks consecutive failures in D1,
 * and triggers auto-rebuild after 3 consecutive failures.
 *
 * Cost: ~1 D1 read/site × N sites per check × 288 checks/day (every 5 min)
 *       At 500 sites: 500 reads × 288 = 144K reads/day → well within 5M free tier ~$0.14/mo
 *       HTTP health checks: 500 fetches × 288 = 144K req/day → 4.3M/mo → within free tier ~$0
 *       Total: ~$0.00/mo on free tier, ~$0.40/mo at 1000 sites
 *
 * Deploy: wrangler deploy (scheduled Worker, no routes needed)
 *
 * @module site-health-worker
 */
interface Env {
  DB: D1Database;
  SITE_WORKFLOW: Workflow;
  RESEND_API_KEY?: string;
  ADMIN_EMAIL: string;
  HEALTH_CHECK_USER_AGENT: string;
}

interface SiteRow {
  id: string;
  slug: string;
  primary_hostname: string | null;
  status: string;
}

interface HealthRecord {
  site_id: string;
  consecutive_failures: number;
  last_checked_at: string;
  last_failure_at: string | null;
  last_status_code: number | null;
}

const FAILURE_THRESHOLD = 3;
const CHECK_TIMEOUT_MS = 10_000;

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Cost: ~N D1 reads where N = published sites. At 500 sites = 500 reads/run × 288/day
    const { results: sites } = await env.DB.prepare(
      `SELECT id, slug, primary_hostname, status
       FROM sites
       WHERE status = 'published'
         AND deleted_at IS NULL`
    ).all<SiteRow>();

    console.log(JSON.stringify({
      level: 'info',
      message: `Health check starting for ${sites?.length ?? 0} published sites`,
      siteCount: sites?.length ?? 0,
    }));

    if (!sites?.length) return;

    let failuresTriggered = 0;

    for (const site of sites) {
      const hostname = site.primary_hostname ?? `${site.slug}.projectsites.dev`;
      const url = `https://${hostname}/`;

      let statusCode: number | null = null;
      let checkOk = false;

      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': env.HEALTH_CHECK_USER_AGENT ?? 'ProjectSites-HealthCheck/1.0' },
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
          redirect: 'follow',
        });
        statusCode = res.status;
        checkOk = res.ok; // 200-299
      } catch {
        statusCode = null;
        checkOk = false;
      }

      // Upsert health record
      const existing = await env.DB.prepare(
        `SELECT consecutive_failures FROM site_health WHERE site_id = ?`
      ).bind(site.id).first<{ consecutive_failures: number }>();

      const consecutiveFailures = checkOk ? 0 : (existing?.consecutive_failures ?? 0) + 1;

      await env.DB.prepare(
        `INSERT INTO site_health (site_id, consecutive_failures, last_checked_at, last_failure_at, last_status_code)
         VALUES (?, ?, datetime('now'), ?, ?)
         ON CONFLICT(site_id) DO UPDATE SET
           consecutive_failures = excluded.consecutive_failures,
           last_checked_at = excluded.last_checked_at,
           last_failure_at = excluded.last_failure_at,
           last_status_code = excluded.last_status_code`
      ).bind(
        site.id,
        consecutiveFailures,
        checkOk ? null : new Date().toISOString(),
        statusCode,
      ).run();

      // Auto-rebuild trigger
      if (consecutiveFailures >= FAILURE_THRESHOLD && consecutiveFailures === FAILURE_THRESHOLD) {
        // Only trigger on the threshold-crossing check (not every subsequent failure)
        await triggerRebuild(env, site, statusCode);
        failuresTriggered++;
      }
    }

    console.log(JSON.stringify({
      level: 'info',
      message: `Health check complete`,
      siteCount: sites?.length ?? 0,
      rebuildsTriggered: failuresTriggered,
    }));
  },
};

async function triggerRebuild(env: Env, site: SiteRow, statusCode: number | null): Promise<void> {
  // Enqueue rebuild via Workflow
  try {
    await env.SITE_WORKFLOW.create({
      id: `health-rebuild-${site.id}-${Date.now()}`,
      params: {
        siteId: site.id,
        slug: site.slug,
        trigger: 'health_check_failure',
        lastStatusCode: statusCode,
        consecutiveFailures: FAILURE_THRESHOLD,
      },
    });

    console.log(JSON.stringify({
      level: 'warn',
      message: `Auto-rebuild triggered for ${site.slug}`,
      siteId: site.id,
      slug: site.slug,
      statusCode,
    }));
  } catch (err) {
    console.log(JSON.stringify({
      level: 'error',
      message: `Failed to enqueue rebuild for ${site.slug}`,
      siteId: site.id,
      error: (err as Error).message,
    }));
  }

  // Notify admin via Resend if configured
  if (env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'ProjectSites <noreply@projectsites.dev>',
          to: env.ADMIN_EMAIL,
          subject: `🔄 Auto-rebuild: ${site.slug}`,
          text: `Site ${site.slug} (${site.id}) has failed health checks ${FAILURE_THRESHOLD} times.\nLast status: ${statusCode ?? 'connection failed'}\nAuto-rebuild triggered.`,
        }),
      });
    } catch {
      // Email failure is non-critical — logged above
    }
  }
}
