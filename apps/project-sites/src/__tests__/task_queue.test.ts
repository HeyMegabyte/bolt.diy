/**
 * Priority queue — in-memory insertion sort. Pure functions, no I/O.
 * Tests verify: ordering, edge states, FIFO tie-break, and stats.
 */
import { enqueueTask, dequeueTask, taskQueueStats, type Task } from '../services/task_queue.js';

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 't',
  priority: 1,
  createdAt: 100,
  payload: null,
  ...overrides,
});

describe('enqueueTask', () => {
  it('inserts into an empty queue', () => {
    const q = enqueueTask([], task({ id: 'a' }));
    expect(q).toHaveLength(1);
    expect(q[0].id).toBe('a');
  });

  it('places higher-priority tasks before lower-priority ones', () => {
    let q = enqueueTask([], task({ id: 'a', priority: 3 }));
    q = enqueueTask(q, task({ id: 'b', priority: 5 }));
    // b has highest priority (5) → dequeued first
    expect(q[0].id).toBe('b');
    expect(q[1].id).toBe('a');
  });

  it('places lower-priority tasks after higher ones', () => {
    let q = enqueueTask([], task({ id: 'a', priority: 5 }));
    q = enqueueTask(q, task({ id: 'b', priority: 1 }));
    // a still first (highest priority 5)
    expect(q[0].id).toBe('a');
    expect(q[1].id).toBe('b');
  });

  it('preserves FIFO order within the same priority tier', () => {
    let q = enqueueTask([], task({ id: 'first', priority: 5, createdAt: 100 }));
    q = enqueueTask(q, task({ id: 'second', priority: 5, createdAt: 200 }));
    q = enqueueTask(q, task({ id: 'third', priority: 5, createdAt: 150 }));
    // same priority: earlier createdAt first → first(100) → third(150) → second(200)
    expect(q[0].id).toBe('first');
    expect(q[1].id).toBe('third');
    expect(q[2].id).toBe('second');
  });

  it('returns a new array (does not mutate the original)', () => {
    const original: Task[] = [task({ id: 'a' })];
    const next = enqueueTask(original, task({ id: 'b' }));
    expect(original).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(next).not.toBe(original);
  });

  it('sorts a mix of priorities descending', () => {
    let q = enqueueTask([], task({ id: 'low', priority: 1 }));
    q = enqueueTask(q, task({ id: 'high', priority: 10 }));
    q = enqueueTask(q, task({ id: 'mid', priority: 5 }));
    expect(q.map((t) => t.id)).toEqual(['high', 'mid', 'low']);
  });
});

describe('dequeueTask', () => {
  it('returns null for an empty queue', () => {
    const [q, task] = dequeueTask([]);
    expect(task).toBeNull();
    expect(q).toEqual([]);
  });

  it('removes and returns the first (highest-priority) task', () => {
    let q = enqueueTask([], task({ id: 'a', priority: 3 }));
    q = enqueueTask(q, task({ id: 'b', priority: 7 }));
    q = enqueueTask(q, task({ id: 'c', priority: 1 }));

    const [remaining, dequeued] = dequeueTask(q);
    expect(dequeued?.id).toBe('b');
    expect(dequeued?.priority).toBe(7);
    expect(remaining).toHaveLength(2);
  });

  it('reduces queue length by one', () => {
    let q = enqueueTask([], task({ id: 'a' }));
    q = enqueueTask(q, task({ id: 'b' }));
    const [remaining] = dequeueTask(q);
    expect(remaining).toHaveLength(1);
  });

  it('does not mutate the original queue', () => {
    const q = [task({ id: 'a' })];
    const [,] = dequeueTask(q);
    expect(q).toHaveLength(1);
  });

  it('returns a pair — never a bare value', () => {
    const [q, t] = dequeueTask([]);
    expect(Array.isArray([q, t])).toBe(true);
  });
});

describe('taskQueueStats', () => {
  it('returns zeros for an empty queue', () => {
    const stats = taskQueueStats([]);
    expect(stats).toEqual({
      highestPriority: null,
      lowestPriority: null,
      priorityTiers: {},
      total: 0,
    });
  });

  it('reports total count', () => {
    let q = enqueueTask([], task({ id: 'a' }));
    q = enqueueTask(q, task({ id: 'b' }));
    expect(taskQueueStats(q).total).toBe(2);
  });

  it('reports highest and lowest priority', () => {
    let q = enqueueTask([], task({ id: 'a', priority: 1 }));
    q = enqueueTask(q, task({ id: 'b', priority: 9 }));
    q = enqueueTask(q, task({ id: 'c', priority: 5 }));

    const stats = taskQueueStats(q);
    expect(stats.highestPriority).toBe(9);
    expect(stats.lowestPriority).toBe(1);
  });

  it('counts tasks per priority tier', () => {
    let q = enqueueTask([], task({ id: 'a', priority: 1 }));
    q = enqueueTask(q, task({ id: 'b', priority: 3 }));
    q = enqueueTask(q, task({ id: 'c', priority: 3 }));
    q = enqueueTask(q, task({ id: 'd', priority: 1 }));

    const stats = taskQueueStats(q);
    expect(stats.priorityTiers).toEqual({ 1: 2, 3: 2 });
  });

  it('matches dequeue ordering after stats (integration sanity)', () => {
    let q = enqueueTask([], task({ id: 'a', priority: 5, createdAt: 1 }));
    q = enqueueTask(q, task({ id: 'b', priority: 10, createdAt: 2 }));
    q = enqueueTask(q, task({ id: 'c', priority: 1, createdAt: 3 }));

    const stats = taskQueueStats(q);
    expect(stats.total).toBe(3);
    expect(stats.highestPriority).toBe(10);
    expect(stats.lowestPriority).toBe(1);

    const [q1, t1] = dequeueTask(q);
    expect(t1?.id).toBe('b'); // highest priority first
    const [q2, t2] = dequeueTask(q1);
    expect(t2?.id).toBe('a');
    const [q3, t3] = dequeueTask(q2);
    expect(t3?.id).toBe('c');
    expect(q3).toEqual([]);
  });
});
