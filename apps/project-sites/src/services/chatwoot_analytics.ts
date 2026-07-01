/**
 * @module services/chatwoot_analytics
 * @description Support analytics pipeline — ingests Chatwoot webhook events
 * and exposes real-time + historical metrics for the admin dashboard.
 *
 * Events flow:
 *   Chatwoot webhook → event_bus.publish('chatwoot.*') → Tinybird datasource
 *
 * Metrics exposed:
 *   - Conversation volume (by hour/day/week)
 *   - First-response time (avg, p50, p95, p99)
 *   - Resolution time (avg, p50, p95)
 *   - CSAT scores (avg, distribution)
 *   - AI deflection rate (% auto-resolved)
 *   - SLA compliance (% within target)
 *   - Agent workload (conversations per agent)
 *   - Label/topic distribution
 *   - Channel distribution
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { tryEmitEvent } from './emit_event.js';

// ────────────────────────────────────────────────────────
// Event schemas
// ────────────────────────────────────────────────────────

export interface ChatwootConversationEvent {
  event: 'conversation_created' | 'conversation_resolved' | 'conversation_status_changed';
  conversation_id: number;
  account_id: number;
  inbox_id?: number;
  contact_id?: number;
  assignee_id?: number;
  team_id?: number;
  status: 'open' | 'pending' | 'resolved' | 'snoozed';
  labels: string[];
  priority?: 'critical' | 'high' | 'normal' | 'low';
  channel?: string;
  created_at: string;
  resolved_at?: string;
}

export interface ChatwootMessageEvent {
  event: 'message_created' | 'message_updated';
  conversation_id: number;
  message_id: number;
  message_type: 'incoming' | 'outgoing' | 'private';
  sender_type: 'contact' | 'agent' | 'bot';
  sender_id?: number;
  content_length: number;
  has_attachment: boolean;
  created_at: string;
}

export interface ChatwootCSATEvent {
  event: 'csat_received';
  conversation_id: number;
  rating: number; // 1-5
  feedback?: string;
  contact_id?: number;
  assignee_id?: number;
  created_at: string;
}

export interface ChatwootAITriageEvent {
  event: 'ai_triage';
  conversation_id: number;
  intent: string;
  urgency: number;
  sentiment: number;
  confidence: number;
  auto_resolved: boolean;
  labels_suggested: string[];
  model: string;
  latency_ms: number;
}

// ────────────────────────────────────────────────────────
// Ingest helpers
// ────────────────────────────────────────────────────────

const ANALYTICS_ENABLED = true;
const PRODUCER = 'worker' as const;

function noopCatch() { /* fire-and-forget — analytics never throws */ }

async function emit(env: Env, type: string, eventData: Record<string, unknown>): Promise<void> {
  if (!ANALYTICS_ENABLED) return;
  await tryEmitEvent(env, {
    type: type as any,
    producer: PRODUCER,
    tenantId: 'system',
    traceId: crypto.randomUUID(),
    data: eventData,
  }).catch(noopCatch);
}

export async function trackConversation(env: Env, data: ChatwootConversationEvent): Promise<void> {
  await emit(env, 'chatwoot.conversation', data as unknown as Record<string, unknown>);
}

export async function trackMessage(env: Env, data: ChatwootMessageEvent): Promise<void> {
  await emit(env, 'chatwoot.message', data as unknown as Record<string, unknown>);
}

export async function trackCSAT(env: Env, data: ChatwootCSATEvent): Promise<void> {
  await emit(env, 'chatwoot.csat', data as unknown as Record<string, unknown>);
}

export async function trackAITriage(env: Env, data: ChatwootAITriageEvent): Promise<void> {
  await emit(env, 'chatwoot.ai_triage', data as unknown as Record<string, unknown>);
}

// ────────────────────────────────────────────────────────
// Metrics queries (for admin dashboard)
// ────────────────────────────────────────────────────────

export interface SupportMetrics {
  period: { start: string; end: string };
  conversations: { total: number; open: number; resolved: number };
  response_time: { avg_ms: number; p50_ms: number; p95_ms: number; p99_ms: number };
  resolution_time: { avg_hours: number; p50_hours: number; p95_hours: number };
  csat: { avg: number; count: number; distribution: Record<string, number> };
  ai_deflection: { total_conversations: number; auto_resolved: number; rate_pct: number };
  sla_compliance: { total: number; breached: number; rate_pct: number };
  agents: Array<{
    agent_id: number;
    conversations: number;
    avg_response_ms: number;
    csat_avg: number;
  }>;
  labels: Record<string, number>;
  channels: Record<string, number>;
  hourly_volume: Array<{ hour: string; count: number }>;
}

/** Returns mock metrics when Tinybird is unavailable (dev/fallback). */
export function emptyMetrics(): SupportMetrics {
  const now = new Date().toISOString();
  return {
    period: { start: now, end: now },
    conversations: { total: 0, open: 0, resolved: 0 },
    response_time: { avg_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0 },
    resolution_time: { avg_hours: 0, p50_hours: 0, p95_hours: 0 },
    csat: { avg: 0, count: 0, distribution: {} },
    ai_deflection: { total_conversations: 0, auto_resolved: 0, rate_pct: 0 },
    sla_compliance: { total: 0, breached: 0, rate_pct: 100 },
    agents: [],
    labels: {},
    channels: {},
    hourly_volume: [],
  };
}

/**
 * Fetch support metrics from Tinybird.
 * Falls back to emptyMetrics() when Tinybird is unavailable.
 */
export async function fetchMetrics(env: Env, _days = 30): Promise<SupportMetrics> {
  // TODO: wire to Tinybird SQL API when datasource is live
  // const result = await fetch(`https://api.tinybird.co/v0/sql?q=...`, {
  //   headers: { Authorization: `Bearer ${env.TINYBIRD_API_KEY}` },
  // });
  return emptyMetrics();
}
