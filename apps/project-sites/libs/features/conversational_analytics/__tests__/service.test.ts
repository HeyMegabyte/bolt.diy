import { parseAnalyticsQuery } from '../service.js';

describe('parseAnalyticsQuery', () => {
  test('"how many visitors last week" → visitors, last_7_days', () => {
    const r = parseAnalyticsQuery('how many visitors last week?');
    expect(r.intent.metric).toBe('visitors');
    expect(r.intent.timeRange).toBe('last_7_days');
    expect(r.clarificationNeeded).toBe(false);
  });

  test('"what are my top pages this month" → top_pages', () => {
    const r = parseAnalyticsQuery('what are my top pages this month?');
    expect(r.intent.metric).toBe('top_pages');
  });

  test('"how many leads did I get yesterday" → leads', () => {
    const r = parseAnalyticsQuery('how many leads did I get yesterday?');
    expect(r.intent.metric).toBe('leads');
    expect(r.intent.timeRange).toBe('yesterday');
  });

  test('"what is my bounce rate" → bounce_rate', () => {
    const r = parseAnalyticsQuery('what is my bounce rate?');
    expect(r.intent.metric).toBe('bounce_rate');
    // Metric confidence is high, but no time range → combined confidence is lower
    expect(r.intent.confidence).toBeGreaterThan(0.4);
  });

  test('"show me revenue for last month" → revenue', () => {
    const r = parseAnalyticsQuery('show me revenue for last month');
    expect(r.intent.metric).toBe('revenue');
    expect(r.intent.timeRange).toBe('last_month');
  });

  test('"where is my traffic coming from" → traffic_sources', () => {
    const r = parseAnalyticsQuery('where is my traffic coming from?');
    expect(r.intent.metric).toBe('traffic_sources');
  });

  test('"how many email opens this week" → email_opens', () => {
    const r = parseAnalyticsQuery('how many email opens this week?');
    expect(r.intent.metric).toBe('email_opens');
  });

  test('"what are people searching for" → search_queries', () => {
    const r = parseAnalyticsQuery('what are people searching for on my site?');
    expect(r.intent.metric).toBe('search_queries');
  });

  test('"likes and shares" → social_engagement', () => {
    const r = parseAnalyticsQuery('how many likes and shares did I get?');
    expect(r.intent.metric).toBe('social_engagement');
  });

  test('"contact form submissions" → leads', () => {
    const r = parseAnalyticsQuery('how many contact form submissions?');
    expect(r.intent.metric).toBe('leads');
  });

  test('"by day" adds groupBy: day', () => {
    const r = parseAnalyticsQuery('visitors by day last week');
    expect(r.intent.groupBy).toBe('day');
  });

  test('"per source" adds groupBy: source', () => {
    const r = parseAnalyticsQuery('traffic per source this month');
    expect(r.intent.groupBy).toBe('source');
  });

  test('"breakdown" adds groupBy: source', () => {
    const r = parseAnalyticsQuery('show me traffic breakdown');
    expect(r.intent.groupBy).toBe('source');
  });

  test('"today" → timeRange: today', () => {
    const r = parseAnalyticsQuery('visitors today');
    expect(r.intent.timeRange).toBe('today');
  });

  test('"last 30 days" → timeRange: last_30_days', () => {
    const r = parseAnalyticsQuery('pageviews last 30 days');
    expect(r.intent.timeRange).toBe('last_30_days');
  });

  test('unrecognized query → clarification needed', () => {
    const r = parseAnalyticsQuery('blah blah nothing relevant here');
    expect(r.clarificationNeeded).toBe(true);
    expect(r.clarificationQuestion).toBeTruthy();
    expect(r.intent.confidence).toBe(0.2);
  });

  test('ambiguous query → clarification with suggestion', () => {
    const r = parseAnalyticsQuery('how did I do this year?');
    expect(r.clarificationNeeded).toBe(true);
  });

  test('empty string → clarification', () => {
    const r = parseAnalyticsQuery('');
    expect(r.clarificationNeeded).toBe(true);
  });
});
