// Funnels every inbound socket event (and outgoing sends) through one chained promise so they're
// processed strictly in wire-arrival order, never concurrently. This is what makes
// dormancy:return's fan-out-to-every-conversation safe: without it, its async writes across many
// conversations could still be in flight when a concurrently-fired envelope:deliver handler
// finishes first and lands its write ahead of the dormancy marker (docs/REALTIME_PROTOCOL.md §3
// guarantees dormancy:return arrives before any envelope:deliver on the wire, but Socket.IO does
// not serialize handler execution for you — only enqueueing here does).
export class EventQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    // Swallow the outcome for chaining purposes only — a rejected task must not stop the next
    // enqueued task from running. Callers still observe the real outcome via the returned promise.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
