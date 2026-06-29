/**
 * Unit tests for webhook_filter — pure filter matching and summary logic.
 *
 * Every export in `webhook_filter.ts` is a pure function (same inputs → same
 * outputs, no I/O, no env) so these tests never mock anything external. They
 * exercise matching, factory, and summary paths exhaustively.
 */
import {
  type WebhookFilter,
  buildFilter,
  matchFilters,
  filterSummary,
} from '../services/webhook_filter.js';

// ───────────── Fixtures ─────────────

const STRIPE_PAID: WebhookFilter = {
  source: 'stripe',
  eventType: 'invoice.paid',
  destination: 'https://hooks.example.com/billing',
  active: true,
};

const STRIPE_REFUND: WebhookFilter = {
  source: 'stripe',
  eventType: 'charge.refunded',
  destination: 'https://hooks.example.com/billing',
  active: true,
};

const DUB_CLICK: WebhookFilter = {
  source: 'dub',
  eventType: 'link.clicked',
  destination: 'https://hooks.example.com/analytics',
  active: true,
};

const INACTIVE: WebhookFilter = {
  source: 'stripe',
  eventType: 'invoice.paid',
  destination: 'https://hooks.example.com/legacy',
  active: false,
};

const ALL_FILTERS: readonly WebhookFilter[] = [STRIPE_PAID, STRIPE_REFUND, DUB_CLICK, INACTIVE];

// ───────────── buildFilter ─────────────

describe('buildFilter', () => {
  it('returns a filter with active=true by default', () => {
    const f = buildFilter('stripe', 'invoice.paid', 'https://hooks.example.com/billing');

    expect(f).toEqual({
      source: 'stripe',
      eventType: 'invoice.paid',
      destination: 'https://hooks.example.com/billing',
      active: true,
    });
  });

  it('accepts arbitrary source and eventType strings', () => {
    const f = buildFilter('chatwoot', 'conversation.created', 'https://hooks.example.com/support');

    expect(f.source).toBe('chatwoot');
    expect(f.eventType).toBe('conversation.created');
    expect(f.destination).toBe('https://hooks.example.com/support');
    expect(f.active).toBe(true);
  });
});

// ───────────── matchFilters ─────────────

describe('matchFilters', () => {
  it('returns matching filters for an exact source + eventType', () => {
    const result = matchFilters(ALL_FILTERS, 'stripe', 'invoice.paid');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(STRIPE_PAID);
  });

  it('returns multiple results when several filters match (fan-out)', () => {
    const multi: WebhookFilter[] = [
      { ...STRIPE_PAID, destination: 'https://hooks.example.com/a' },
      { ...STRIPE_PAID, destination: 'https://hooks.example.com/b' },
    ];

    const result = matchFilters(multi, 'stripe', 'invoice.paid');

    expect(result).toHaveLength(2);
    expect(result.map((f) => f.destination).sort()).toEqual([
      'https://hooks.example.com/a',
      'https://hooks.example.com/b',
    ]);
  });

  it('returns an empty array when nothing matches', () => {
    const result = matchFilters(ALL_FILTERS, 'stripe', 'charge.dispute.created');

    expect(result).toEqual([]);
  });

  it('returns an empty array when source matches but eventType does not', () => {
    const result = matchFilters(ALL_FILTERS, 'stripe', 'link.clicked');

    expect(result).toEqual([]);
  });

  it('returns an empty array when eventType matches but source does not', () => {
    const result = matchFilters(ALL_FILTERS, 'dub', 'invoice.paid');

    expect(result).toEqual([]);
  });

  it('excludes inactive filters from results', () => {
    const result = matchFilters([INACTIVE, STRIPE_PAID], 'stripe', 'invoice.paid');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(STRIPE_PAID);
  });

  it('returns an empty array when only inactive filters match', () => {
    const result = matchFilters([INACTIVE], 'stripe', 'invoice.paid');

    expect(result).toEqual([]);
  });

  it('is case-sensitive for source and eventType', () => {
    const result = matchFilters(ALL_FILTERS, 'Stripe', 'Invoice.Paid');

    expect(result).toEqual([]);
  });

  it('handles an empty filter list', () => {
    const result = matchFilters([], 'stripe', 'invoice.paid');

    expect(result).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const copy = [...ALL_FILTERS];
    matchFilters(ALL_FILTERS, 'stripe', 'invoice.paid');

    expect(ALL_FILTERS).toEqual(copy);
  });
});

// ───────────── filterSummary ─────────────

describe('filterSummary', () => {
  it('counts total and active filters correctly', () => {
    const result = filterSummary(ALL_FILTERS);

    expect(result.total).toBe(4);
    expect(result.active).toBe(3);
  });

  it('breaks down counts by source', () => {
    const result = filterSummary(ALL_FILTERS);

    expect(result.bySource).toEqual({
      stripe: 3,
      dub: 1,
    });
  });

  it('returns zero counts for an empty list', () => {
    const result = filterSummary([]);

    expect(result.total).toBe(0);
    expect(result.active).toBe(0);
    expect(result.bySource).toEqual({});
  });

  it('counts inactive filters in total and bySource but not in active', () => {
    const result = filterSummary([STRIPE_PAID, INACTIVE]);

    expect(result.total).toBe(2);
    expect(result.active).toBe(1);
    expect(result.bySource).toEqual({ stripe: 2 });
  });

  it('handles a single filter', () => {
    const result = filterSummary([DUB_CLICK]);

    expect(result.total).toBe(1);
    expect(result.active).toBe(1);
    expect(result.bySource).toEqual({ dub: 1 });
  });
});
