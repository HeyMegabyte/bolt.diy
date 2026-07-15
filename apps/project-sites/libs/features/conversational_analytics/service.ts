/**
 * @module libs/features/conversational_analytics/service
 *
 * Pure NL-to-metrics intent parser — maps natural language analytics
 * questions to structured MetricIntent objects. Zero I/O, deterministic.
 *
 * The LLM (Workers AI) provides the actual NLU at the route layer.
 * This module is the rule-based fallback + confidence-scoring engine
 * that handles the 80% of queries that don't need an LLM.
 *
 * Supported patterns:
 * - "How many visitors/leads/pageviews [time]?"
 * - "What are my top pages [time]?"
 * - "Show me traffic sources [time]"
 * - "What's my bounce rate / conversion rate [time]?"
 * - "How much revenue [time]?"
 * - "Email opens / social engagement [time]?"
 */
import type { AnalyticsQuery, MetricIntent } from './schemas.js';

// ── Pattern matching ────────────────────────────────────────────────────────

interface QueryPattern {
  regex: RegExp;
  metric: MetricIntent['metric'];
  confidence: number;
}

const PATTERNS: QueryPattern[] = [
  // Visitors
  { regex: /\b(?:how many\s+)?(?:people|visitors?|users?|unique)\b.*\b(?:visit|come|came|went)\b/i, metric: 'visitors', confidence: 0.9 },
  { regex: /\b(?:how many\s+)?(?:visitors?|visits?)\b/i, metric: 'visitors', confidence: 0.85 },
  { regex: /\btraffic\b(?!.*source)/i, metric: 'visitors', confidence: 0.7 },

  // Pageviews
  { regex: /\bpage\s*views?\b/i, metric: 'pageviews', confidence: 0.9 },
  { regex: /\b(?:how many\s+)?(?:pages?|views?)\b.*\b(?:viewed|seen|loaded)\b/i, metric: 'pageviews', confidence: 0.8 },

  // Leads
  { regex: /\bleads?\b.*\b(?:generated|captured|received|got|get)\b/i, metric: 'leads', confidence: 0.9 },
  { regex: /\b(?:generated|captured|received|got|get)\b.*\bleads?\b/i, metric: 'leads', confidence: 0.85 },
  { regex: /\b(?:contact\s+form|inquir(?:y|ies)|submissions?)\b/i, metric: 'leads', confidence: 0.85 },
  { regex: /\bhow many\s+(?:people\s+)?(?:contacted|reached\s+out|filled|submitted)\b/i, metric: 'leads', confidence: 0.8 },

  // Conversions
  { regex: /\bconversions?\b/i, metric: 'conversions', confidence: 0.9 },
  { regex: /\b(?:conversion|convert)\s+rate\b/i, metric: 'conversions', confidence: 0.85 },

  // Bounce rate
  { regex: /\bbounce\s*rate\b/i, metric: 'bounce_rate', confidence: 0.95 },
  { regex: /\b(?:bounced?|bouncing)\b/i, metric: 'bounce_rate', confidence: 0.75 },

  // Revenue
  { regex: /\brevenue\b/i, metric: 'revenue', confidence: 0.9 },
  { regex: /\b(?:sales|income|earnings|how much (?:money|did))\b/i, metric: 'revenue', confidence: 0.85 },
  { regex: /\$\d+/i, metric: 'revenue', confidence: 0.7 },

  // Top pages
  { regex: /\b(?:top|most|best|popular|highest)\s+(?:pages?|content)\b/i, metric: 'top_pages', confidence: 0.9 },
  { regex: /\bwhich\s+pages?\b/i, metric: 'top_pages', confidence: 0.8 },
  { regex: /\bwhat\s+(?:pages?|content)\b.*\b(?:perform|popular|work)\b/i, metric: 'top_pages', confidence: 0.8 },

  // Traffic sources
  { regex: /\b(?:traffic|where).*\b(?:source|from|coming|came)\b/i, metric: 'traffic_sources', confidence: 0.85 },
  { regex: /\b(?:source|channel|referrer)s?\b.*\btraffic\b/i, metric: 'traffic_sources', confidence: 0.85 },
  { regex: /\b(?:google|social|facebook|instagram|twitter|linkedin)\b.*\btraffic\b/i, metric: 'traffic_sources', confidence: 0.75 },

  // Social engagement
  { regex: /\bsocial\b.*\b(?:engagement|media|post|likes?|shares?|comments?)\b/i, metric: 'social_engagement', confidence: 0.85 },
  { regex: /\b(?:likes?|shares?|comments?|followers?)\b/i, metric: 'social_engagement', confidence: 0.75 },

  // Email opens
  { regex: /\bemail\b.*\b(?:opens?|clicks?|open\s*rate|click\s*rate)\b/i, metric: 'email_opens', confidence: 0.9 },
  { regex: /\b(?:newsletter|campaign)\b.*\b(?:perform|open|click)\b/i, metric: 'email_opens', confidence: 0.8 },

  // Search queries
  { regex: /\b(?:what|which|search)\b.*\b(?:search|query|keyword|finding|looking)\b/i, metric: 'search_queries', confidence: 0.8 },
  { regex: /\bwhat\s+are\s+(?:people|users|visitors)\s+(?:searching|looking)\b/i, metric: 'search_queries', confidence: 0.85 },
];

// ── Time range extraction ───────────────────────────────────────────────────

interface TimeMatch {
  range: MetricIntent['timeRange'];
  confidence: number;
}

const TIME_PATTERNS: Array<{ regex: RegExp; range: MetricIntent['timeRange']; confidence: number }> = [
  { regex: /\btoday\b/i, range: 'today', confidence: 0.95 },
  { regex: /\byesterday\b/i, range: 'yesterday', confidence: 0.95 },
  { regex: /\b(?:last|past)\s*(?:7|seven)\s*(?:days?)?\b/i, range: 'last_7_days', confidence: 0.9 },
  { regex: /\b(?:this|last)\s*week\b/i, range: 'last_7_days', confidence: 0.85 },
  { regex: /\b(?:last|past)\s*(?:30|thirty)\s*(?:days?)?\b/i, range: 'last_30_days', confidence: 0.9 },
  { regex: /\blast\s*month\b/i, range: 'last_month', confidence: 0.85 },
  { regex: /\bthis\s*month\b/i, range: 'this_month', confidence: 0.8 },
  { regex: /\b(?:this|last)\s*year\b/i, range: 'this_year', confidence: 0.85 },
  { regex: /\b(?:last|past)\s*(?:24\s*hours?|day)\b/i, range: 'today', confidence: 0.8 },
  { regex: /\b(?:last|past)\s*(?:90|ninety)\s*days\b/i, range: 'last_30_days', confidence: 0.7 }, // fallback
];

function extractTimeRange(query: string): TimeMatch {
  for (const tp of TIME_PATTERNS) {
    if (tp.regex.test(query)) {
      return { range: tp.range, confidence: tp.confidence };
    }
  }
  return { range: 'last_30_days', confidence: 0.5 };
}

// ── Group-by extraction ─────────────────────────────────────────────────────

function extractGroupBy(query: string): MetricIntent['groupBy'] {
  if (/\b(?:by|per|each|every)\s*day\b/i.test(query)) return 'day';
  if (/\b(?:by|per|each|every)\s*week\b/i.test(query)) return 'week';
  if (/\b(?:by|per|each|every)\s*month\b/i.test(query)) return 'month';
  if (/\b(?:by|per)\s*source\b/i.test(query)) return 'source';
  if (/\b(?:by|per)\s*page\b/i.test(query)) return 'page';
  if (/\bbreakdown\b/i.test(query)) return 'source';
  return 'none';
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Parses a natural language analytics question into a structured query intent.
 *
 * Uses regex-based pattern matching for the 80% of queries that don't need
 * an LLM. Returns confidence scores so the route layer can decide whether
 * to escalate to Workers AI for ambiguous queries.
 *
 * @param query - Natural language question (e.g. "how many visitors last week?")
 * @returns Structured AnalyticsQuery with intent + confidence.
 */
export function parseAnalyticsQuery(query: string): AnalyticsQuery {
  // Find best metric match
  let bestMetric: { metric: MetricIntent['metric']; confidence: number } | null = null;
  for (const pattern of PATTERNS) {
    if (pattern.regex.test(query)) {
      if (!bestMetric || pattern.confidence > bestMetric.confidence) {
        bestMetric = { metric: pattern.metric, confidence: pattern.confidence };
      }
    }
  }

  const timeResult = extractTimeRange(query);
  const groupBy = extractGroupBy(query);

  // If no metric found, return low-confidence fallback
  if (!bestMetric) {
    const fallback: MetricIntent = {
      metric: 'visitors',
      timeRange: timeResult.range,
      groupBy: 'none',
      limit: 10,
      confidence: 0.2,
    };
    return {
      query,
      intent: fallback,
      clarificationNeeded: true,
      clarificationQuestion: 'What specifically would you like to know? For example: "How many visitors did I get last week?" or "What are my top pages this month?"',
      suggestedQuery: 'Show me my visitor traffic for the last 30 days',
    };
  }

  // Check if confidence is high enough to skip clarification
  const needsClarification = bestMetric.confidence < 0.7 || timeResult.confidence < 0.6;

  const intent: MetricIntent = {
    metric: bestMetric.metric,
    timeRange: timeResult.range,
    groupBy,
    limit: 10,
    confidence: Math.round(Math.min(bestMetric.confidence, timeResult.confidence) * 100) / 100,
  };

  return {
    query,
    intent,
    clarificationNeeded: needsClarification,
    clarificationQuestion: needsClarification
      ? `I think you are asking about ${bestMetric.metric} for ${timeResult.range.replace(/_/g, ' ')}. Is that correct?`
      : undefined,
  };
}
