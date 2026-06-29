/**
 * @module services/task_queue
 *
 * @description
 * An insertion-sort priority queue for in-memory task scheduling. Tasks are
 * ordered by `priority` descending (highest priority dequeued first), then by
 * `createdAt` ascending within the same priority level (FIFO tie-break).
 *
 * Pure — no I/O, no clock dependency beyond the caller-provided timestamps.
 * Every mutation returns a NEW array reference (no side-effects on the caller's
 * queue). Used by the build pipeline's step scheduler and the task inbox's
 * deadline-aware polling.
 */

/** A queued task. The caller provides `priority` + `createdAt` at insertion. */
export interface Task {
  /** Unique identifier for this task instance. */
  readonly id: string;
  /** Higher = dequeued first. */
  readonly priority: number;
  /** ISO 8601 or Unix-ms timestamp; used as FIFO tie-break within a priority tier. */
  readonly createdAt: string | number;
  /** Arbitrary payload the caller attaches. */
  readonly payload: unknown;
}

/** Read-only snapshot of queue state. */
export interface QueueStats {
  readonly total: number;
  readonly highestPriority: number | null;
  readonly lowestPriority: number | null;
  readonly priorityTiers: Record<number, number>;
}

/**
 * Insert a task into the queue in priority order (descending priority, then
 * ascending createdAt within the same priority tier).
 *
 * @param queue - The current queue array (not mutated).
 * @param task  - The task to insert.
 * @returns A NEW array with the task inserted at the correct position.
 *
 * @example
 * const q = enqueueTask([], { id: 'a', priority: 3, createdAt: 1, payload: null });
 * enqueueTask(q, { id: 'b', priority: 5, createdAt: 2, payload: null });
 * // → [{ id:'b', priority:5, … }, { id:'a', priority:3, … }]
 */
export function enqueueTask(queue: readonly Task[], task: Task): Task[] {
  // Find the insertion index via linear scan — insertion sort on an in-memory
  // queue that is already nearly sorted. For queues exceeding ~10K items
  // a binary-search + splice would be faster, but our usage is <1K.
  const idx = queue.findIndex((t) => {
    if (t.priority > task.priority) return false;
    if (t.priority < task.priority) return true;
    // Same priority: earlier createdAt first (FIFO tie-break)
    return t.createdAt > task.createdAt;
  });

  const next = queue.slice();
  if (idx === -1) {
    next.push(task);
  } else {
    next.splice(idx, 0, task);
  }
  return next;
}

/**
 * Remove and return the highest-priority task from the front of the queue.
 *
 * @param queue - The current queue array (not mutated).
 * @returns A tuple of `[nextQueue, task | null]` where `nextQueue` is a NEW
 *   array with the first element removed, and `task` is the dequeued task or
 *   `null` when the queue is empty.
 *
 * @example
 * const q = enqueueTask([], { id: 'a', priority: 3, createdAt: 1, payload: null });
 * const [remaining, task] = dequeueTask(q);
 * task // → { id:'a', priority:3, … }
 * remaining // → []
 */
export function dequeueTask(queue: readonly Task[]): [Task[], Task | null] {
  if (queue.length === 0) return [[], null];
  return [queue.slice(1), queue[0]];
}

/**
 * Build a statistics snapshot for a queue.
 *
 * @param queue - The queue to inspect (treated as read-only).
 * @returns A {@link QueueStats} object with counts and priority bands.
 *
 * @example
 * taskQueueStats([])
 * // → { total:0, highestPriority:null, lowestPriority:null, priorityTiers:{} }
 */
export function taskQueueStats(queue: readonly Task[]): QueueStats {
  if (queue.length === 0) {
    return { highestPriority: null, lowestPriority: null, priorityTiers: {}, total: 0 };
  }

  const highestPriority = queue[0].priority;
  const lowestPriority = queue[queue.length - 1].priority;

  const priorityTiers: Record<number, number> = {};
  for (const t of queue) {
    priorityTiers[t.priority] = (priorityTiers[t.priority] ?? 0) + 1;
  }

  return {
    highestPriority,
    lowestPriority,
    priorityTiers,
    total: queue.length,
  };
}
