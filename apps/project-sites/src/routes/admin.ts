/**
 * Admin dashboard routes
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import {
  requireAdmin,
  ValidationError,
  NotFoundError,
  DEFAULT_CAPS,
  type RequestContext,
} from '@project-sites/shared';

export const adminRoutes = new Hono<AppEnv>();

// Admin middleware
adminRoutes.use('*', async (c, next) => {
  const ctx: RequestContext = {
    auth: c.get('auth'),
    request_id: c.get('request_id'),
  };
  requireAdmin(ctx);
  await next();
});

// Get admin stats
adminRoutes.get('/stats', async (c) => {
  const db = c.get('db');

  // Get counts
  const [
    { count: totalSites },
    { count: totalOrgs },
    { count: totalUsers },
    { count: activeSubscriptions },
    { count: pendingHostnames },
  ] = await Promise.all([
    db.from('sites').select('*', { count: 'exact', head: true }).is('deleted_at', null),
    db.from('orgs').select('*', { count: 'exact', head: true }).is('deleted_at', null),
    db.from('users').select('*', { count: 'exact', head: true }).is('deleted_at', null),
    db.from('subscriptions').select('*', { count: 'exact', head: true }).eq('state', 'active'),
    db.from('hostnames').select('*', { count: 'exact', head: true }).eq('state', 'pending'),
  ]);

  // Get today's counts
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count: sitesToday } = await db
    .from('sites')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString());

  // Calculate MRR from active subscriptions
  const { data: subscriptions } = await db
    .from('subscriptions')
    .select('monthly_amount_cents')
    .eq('state', 'active');

  const mrrCents = subscriptions?.reduce((sum, s) => sum + (s.monthly_amount_cents || 0), 0) || 0;

  // Get LLM spend today (from usage events)
  const { data: llmUsage } = await db
    .from('usage_events')
    .select('quantity')
    .eq('event_type', 'llm_cost_cents')
    .gte('created_at', today.toISOString());

  const llmSpendTodayCents = llmUsage?.reduce((sum, u) => sum + u.quantity, 0) || 0;

  // Get email count today
  const { data: emailUsage } = await db
    .from('usage_events')
    .select('quantity')
    .eq('event_type', 'email_sent')
    .gte('created_at', today.toISOString());

  const emailsToday = emailUsage?.reduce((sum, u) => sum + u.quantity, 0) || 0;

  // Get lighthouse queue size
  const { count: lighthouseQueueSize } = await db
    .from('workflow_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('job_name', 'lighthouse')
    .in('state', ['pending', 'running']);

  return c.json({
    success: true,
    data: {
      total_sites: totalSites || 0,
      total_orgs: totalOrgs || 0,
      total_users: totalUsers || 0,
      active_subscriptions: activeSubscriptions || 0,
      mrr_cents: mrrCents,
      sites_today: sitesToday || 0,
      emails_today: emailsToday,
      llm_spend_today_cents: llmSpendTodayCents,
      lighthouse_queue_size: lighthouseQueueSize || 0,
      pending_hostnames: pendingHostnames || 0,
      caps: {
        llm_daily_cents: DEFAULT_CAPS.LLM_DAILY_SPEND_CENTS,
        sites_per_day: DEFAULT_CAPS.SITES_PER_DAY,
        emails_per_day: DEFAULT_CAPS.EMAILS_PER_DAY,
      },
    },
    request_id: c.get('request_id'),
  });
});

// Get site details (admin view)
adminRoutes.get('/sites/:site_id', async (c) => {
  const siteId = c.req.param('site_id');
  const db = c.get('db');

  const { data: site, error } = await db
    .from('sites')
    .select('*')
    .eq('id', siteId)
    .single();

  if (error || !site) {
    throw new NotFoundError('Site');
  }

  // Get org
  const { data: org } = await db
    .from('orgs')
    .select('*')
    .eq('id', site.org_id)
    .single();

  // Get subscription
  const { data: subscription } = await db
    .from('subscriptions')
    .select('*')
    .eq('org_id', site.org_id)
    .is('ended_at', null)
    .single();

  // Get hostnames
  const { data: hostnames } = await db
    .from('hostnames')
    .select('*')
    .eq('site_id', siteId)
    .is('deleted_at', null);

  // Get confidence scores
  const { data: confidenceAttrs } = await db
    .from('confidence_attributes')
    .select('attribute_name, confidence')
    .eq('site_id', siteId);

  const confidenceScores = (confidenceAttrs || []).reduce((acc, attr) => {
    acc[attr.attribute_name] = attr.confidence;
    return acc;
  }, {} as Record<string, number>);

  // Get recent audit events
  const { data: recentEvents } = await db
    .from('audit_logs')
    .select('action, created_at, metadata')
    .eq('org_id', site.org_id)
    .order('created_at', { ascending: false })
    .limit(10);

  // Get lighthouse history
  const { data: lighthouseHistory } = await db
    .from('lighthouse_runs')
    .select('performance_score, created_at')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .limit(10);

  return c.json({
    success: true,
    data: {
      site,
      org,
      subscription,
      hostnames: hostnames || [],
      confidence_scores: confidenceScores,
      recent_events: (recentEvents || []).map((e) => ({
        type: e.action,
        timestamp: e.created_at,
        details: e.metadata,
      })),
      lighthouse_history: (lighthouseHistory || []).map((l) => ({
        score: l.performance_score,
        timestamp: l.created_at,
      })),
    },
    request_id: c.get('request_id'),
  });
});

// Update admin setting
adminRoutes.put('/settings/:key', async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json();
  const db = c.get('db');
  const auth = c.get('auth');

  const { data: setting, error } = await db
    .from('admin_settings')
    .upsert({
      key,
      value: String(body.value),
      value_type: body.value_type || 'string',
      description: body.description,
      updated_by: auth?.user_id,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;

  // Log audit event
  await db.from('audit_logs').insert({
    id: crypto.randomUUID(),
    org_id: auth?.org_id || '00000000-0000-0000-0000-000000000000',
    actor_id: auth?.user_id,
    actor_type: 'user',
    action: 'admin.setting_changed',
    target_type: 'admin_setting',
    target_id: key,
    metadata: { old_value: body.old_value, new_value: body.value },
    request_id: c.get('request_id'),
  });

  return c.json({
    success: true,
    data: { setting },
    request_id: c.get('request_id'),
  });
});

// Get feature flags
adminRoutes.get('/flags', async (c) => {
  const db = c.get('db');

  const { data: flags, error } = await db
    .from('feature_flags')
    .select('*')
    .order('name');

  if (error) throw error;

  return c.json({
    success: true,
    data: { flags: flags || [] },
    request_id: c.get('request_id'),
  });
});

// Toggle feature flag
adminRoutes.put('/flags/:name', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json();
  const db = c.get('db');
  const auth = c.get('auth');

  const { data: flag, error } = await db
    .from('feature_flags')
    .upsert({
      name,
      enabled: body.enabled,
      description: body.description,
      org_id: body.org_id,
      percentage: body.percentage,
      metadata: body.metadata,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;

  // Log audit event
  await db.from('audit_logs').insert({
    id: crypto.randomUUID(),
    org_id: auth?.org_id || '00000000-0000-0000-0000-000000000000',
    actor_id: auth?.user_id,
    actor_type: 'user',
    action: 'admin.flag_toggled',
    target_type: 'feature_flag',
    target_id: name,
    metadata: { enabled: body.enabled },
    request_id: c.get('request_id'),
  });

  return c.json({
    success: true,
    data: { flag },
    request_id: c.get('request_id'),
  });
});

// Trigger smoke test
adminRoutes.post('/smoke-test', async (c) => {
  // Queue a smoke test job
  await c.env.WORKFLOW_QUEUE.send({
    type: 'smoke_test',
    payload: {
      triggered_by: c.get('auth')?.user_id,
    },
    metadata: {
      request_id: c.get('request_id'),
      trace_id: c.get('trace_id'),
      attempt: 1,
      max_attempts: 1,
      scheduled_at: new Date().toISOString(),
    },
  });

  return c.json({
    success: true,
    data: { message: 'Smoke test queued' },
    request_id: c.get('request_id'),
  });
});

// Replay webhook event
adminRoutes.post('/webhooks/:event_id/replay', async (c) => {
  const eventId = c.req.param('event_id');
  const db = c.get('db');

  const { data: event, error } = await db
    .from('webhook_events')
    .select('*')
    .eq('id', eventId)
    .single();

  if (error || !event) {
    throw new NotFoundError('Webhook event');
  }

  // Queue replay
  await c.env.WORKFLOW_QUEUE.send({
    type: 'webhook_replay',
    payload: {
      event_id: eventId,
      provider: event.provider,
      event_type: event.event_type,
    },
    metadata: {
      request_id: c.get('request_id'),
      trace_id: c.get('trace_id'),
      attempt: 1,
      max_attempts: 1,
      scheduled_at: new Date().toISOString(),
    },
  });

  return c.json({
    success: true,
    data: { message: 'Webhook replay queued' },
    request_id: c.get('request_id'),
  });
});
