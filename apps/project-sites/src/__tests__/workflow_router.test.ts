/**
 * Convergence §20 — WorkflowRouter selection logic + job-definition integrity.
 *
 * Locks the routing brain: CF-native+light → Workflows, event-driven+light →
 * Inngest, heavy/browser/stateful → Hatchet — and asserts every declared job's
 * `defaultBackend` equals what the live policy (`chooseWorkflowBackend`) derives,
 * so the declaration and the policy can never silently diverge.
 */
import {
  chooseWorkflowBackend,
  routeJob,
  isJobKind,
  JOB_DEFINITIONS,
  type JobKind,
  type WorkflowBackend,
} from '../platform/workflow-router.js';

describe('chooseWorkflowBackend (§20 selection logic)', () => {
  it('routes CF-native + light work to Cloudflare Workflows', () => {
    expect(chooseWorkflowBackend({ kind: 'x', isCloudflareNative: true })).toBe('cloudflare-workflows');
    expect(
      chooseWorkflowBackend({ kind: 'x', isCloudflareNative: true, canUseWorkflowWaits: true }),
    ).toBe('cloudflare-workflows');
  });

  it('routes event-driven + light work to Inngest', () => {
    expect(chooseWorkflowBackend({ kind: 'x', isProductEventDriven: true })).toBe('inngest');
  });

  it('routes heavy / browser / filesystem / stateful work to Hatchet', () => {
    expect(chooseWorkflowBackend({ kind: 'x', needsHeavyRuntime: true })).toBe('hatchet');
    expect(chooseWorkflowBackend({ kind: 'x', needsBrowser: true })).toBe('hatchet');
    expect(chooseWorkflowBackend({ kind: 'x', needsFilesystem: true })).toBe('hatchet');
    expect(chooseWorkflowBackend({ kind: 'x', needsStatefulSession: true })).toBe('hatchet');
  });

  it('CF-native but heavy/browser/stateful escalates OFF Workflows to Hatchet', () => {
    expect(chooseWorkflowBackend({ kind: 'x', isCloudflareNative: true, needsHeavyRuntime: true })).toBe('hatchet');
    expect(chooseWorkflowBackend({ kind: 'x', isCloudflareNative: true, needsBrowser: true })).toBe('hatchet');
  });

  it('event-driven but browser/heavy escalates OFF Inngest to Hatchet', () => {
    expect(chooseWorkflowBackend({ kind: 'x', isProductEventDriven: true, needsBrowser: true })).toBe('hatchet');
  });

  it('defaults unknown/unflagged work to Hatchet (the heavy plane)', () => {
    expect(chooseWorkflowBackend({ kind: 'x' })).toBe('hatchet');
  });
});

describe('JOB_DEFINITIONS integrity', () => {
  const entries = Object.entries(JOB_DEFINITIONS) as [JobKind, (typeof JOB_DEFINITIONS)[JobKind]][];

  it('declares at least one job per backend', () => {
    const backends = new Set<WorkflowBackend>(entries.map(([, d]) => d.defaultBackend));
    expect(backends).toEqual(new Set(['cloudflare-workflows', 'inngest', 'hatchet']));
  });

  it('every defaultBackend equals the policy-derived backend (no drift)', () => {
    for (const [kind, def] of entries) {
      expect({ kind, backend: def.defaultBackend }).toEqual({ kind, backend: chooseWorkflowBackend(def) });
    }
  });

  it('every job key matches its own kind field', () => {
    for (const [kind, def] of entries) expect(def.kind).toBe(kind);
  });

  it('retry caps are bounded positive integers (never 0, never unbounded)', () => {
    for (const [, def] of entries) {
      expect(Number.isInteger(def.maxRetries)).toBe(true);
      expect(def.maxRetries).toBeGreaterThanOrEqual(1);
      expect(def.maxRetries).toBeLessThanOrEqual(10);
    }
  });

  it('every job requires idempotency (replay-safe per §18/§23)', () => {
    for (const [, def] of entries) expect(def.requiresIdempotency).toBe(true);
  });
});

describe('routeJob / isJobKind', () => {
  it('routes the canonical revenue-path jobs to the right plane', () => {
    expect(routeJob('site-generation').backend).toBe('hatchet');
    expect(routeJob('claim-flow').backend).toBe('cloudflare-workflows');
    expect(routeJob('notification-workflow').backend).toBe('inngest');
  });

  it('returns the full definition alongside the backend', () => {
    const r = routeJob('screenshot-job');
    expect(r.backend).toBe('hatchet');
    expect(r.definition.costCategory).toBe('browser');
  });

  it('throws on an unknown job kind', () => {
    expect(() => routeJob('nope' as JobKind)).toThrow(/Unknown job kind/);
  });

  it('isJobKind narrows declared vs undeclared kinds', () => {
    expect(isJobKind('site-generation')).toBe(true);
    expect(isJobKind('totally-made-up')).toBe(false);
  });
});
