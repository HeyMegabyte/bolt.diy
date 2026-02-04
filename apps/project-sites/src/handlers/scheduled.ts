/**
 * Scheduled (cron) handler
 */
import type { CronContext } from '../types.js';
import { createClient } from '@supabase/supabase-js';

export async function handleScheduled(context: CronContext): Promise<void> {
  const { env, cron } = context;

  console.log(`Running scheduled job: ${cron}`);

  // Create Supabase client
  const db = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    // Run all scheduled tasks
    await Promise.allSettled([
      verifyPendingHostnames(env, db),
      processDunning(env, db),
      cleanupExpiredSessions(db),
      rollupAnalytics(env, db),
      checkCaps(env, db),
    ]);
  } catch (error) {
    console.error('Scheduled job error:', error);
  }
}

async function verifyPendingHostnames(env: any, db: any): Promise<void> {
  console.log('Verifying pending hostnames...');

  const { data: hostnames, error } = await db
    .from('hostnames')
    .select('id, hostname, cf_hostname_id')
    .eq('state', 'pending')
    .is('deleted_at', null)
    .limit(50);

  if (error || !hostnames?.length) {
    return;
  }

  for (const hostname of hostnames) {
    if (!hostname.cf_hostname_id) continue;

    try {
      // Check Cloudflare hostname status
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/custom_hostnames/${hostname.cf_hostname_id}`,
        {
          headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
        }
      );

      const data = await response.json() as { result: any };
      const result = data.result;

      const isActive = result.status === 'active' && result.ssl?.status === 'active';

      await db
        .from('hostnames')
        .update({
          state: isActive ? 'active' : 'pending',
          ssl_status: result.ssl?.status,
          last_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', hostname.id);

      // Cache active hostname
      if (isActive) {
        await env.CACHE_KV.put(
          `host:${hostname.hostname}`,
          hostname.site_id,
          { expirationTtl: 3600 }
        );
      }
    } catch (error) {
      console.error(`Failed to verify hostname ${hostname.hostname}:`, error);
    }
  }
}

async function processDunning(env: any, db: any): Promise<void> {
  console.log('Processing dunning...');

  // Find past_due subscriptions
  const { data: pastDueSubscriptions, error } = await db
    .from('subscriptions')
    .select('id, org_id, current_period_end')
    .eq('state', 'past_due')
    .is('ended_at', null);

  if (error || !pastDueSubscriptions?.length) {
    return;
  }

  for (const subscription of pastDueSubscriptions) {
    const daysOverdue = Math.floor(
      (Date.now() - new Date(subscription.current_period_end).getTime()) /
        (24 * 60 * 60 * 1000)
    );

    // Dunning stages: 7, 14, 30 days - send reminders
    // 60 days - downgrade (top bar returns)
    if (daysOverdue >= 60) {
      // Downgrade: This is handled by entitlements middleware
      // Just log for now
      console.log(`Org ${subscription.org_id} is ${daysOverdue} days overdue`);
    }
  }
}

async function cleanupExpiredSessions(db: any): Promise<void> {
  console.log('Cleaning up expired sessions...');

  // Delete sessions expired more than 7 days ago
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await db
    .from('sessions')
    .delete()
    .lt('expires_at', cutoff);

  if (error) {
    console.error('Failed to cleanup sessions:', error);
  }
}

async function rollupAnalytics(env: any, db: any): Promise<void> {
  console.log('Rolling up analytics...');

  // Get yesterday's date
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const dateStr = yesterday.toISOString().split('T')[0];

  // Get sites that need analytics rollup
  const { data: sites, error } = await db
    .from('sites')
    .select('id, org_id, slug')
    .is('deleted_at', null)
    .limit(100);

  if (error || !sites?.length) {
    return;
  }

  for (const site of sites) {
    // Check if rollup already exists
    const { data: existing } = await db
      .from('analytics_daily')
      .select('id')
      .eq('site_id', site.id)
      .eq('date', dateStr)
      .single();

    if (existing) continue;

    // Get view count from KV
    const viewKey = `views:${site.id}:${dateStr}`;
    const views = await env.CACHE_KV.get(viewKey);

    // Create rollup record
    await db.from('analytics_daily').insert({
      id: crypto.randomUUID(),
      org_id: site.org_id,
      site_id: site.id,
      date: dateStr,
      page_views: parseInt(views || '0'),
      unique_visitors: 0, // Would need more sophisticated tracking
      bandwidth_bytes: 0,
      requests: 0,
    });
  }
}

async function checkCaps(env: any, db: any): Promise<void> {
  console.log('Checking daily caps...');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get today's usage
  const { data: usage, error } = await db
    .from('usage_events')
    .select('event_type, quantity')
    .gte('created_at', today.toISOString());

  if (error) {
    console.error('Failed to get usage:', error);
    return;
  }

  // Aggregate by type
  const totals: Record<string, number> = {};
  for (const event of usage || []) {
    totals[event.event_type] = (totals[event.event_type] || 0) + event.quantity;
  }

  // Check caps
  const caps = {
    llm_cost_cents: 2000,
    sites_created: 20,
    emails_sent: 25,
  };

  for (const [type, limit] of Object.entries(caps)) {
    const current = totals[type] || 0;
    if (current >= limit * 0.9) {
      console.warn(`Cap warning: ${type} at ${current}/${limit} (${Math.round(current / limit * 100)}%)`);
    }
  }
}
