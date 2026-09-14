/**
 * Milestone sequencing arithmetic (PRD #44 §36-§39). Pure.
 *
 * Dependencies are finish-to-start edges inside one project. There is no
 * network scheduling here — only the question every new edge must answer:
 * would it close a loop?
 */

export type Edge = { predecessorId: string; successorId: string };

/**
 * Whether adding `predecessor → successor` closes a cycle: true when the
 * successor already reaches the predecessor, or when they are the same.
 * Iterative, so a long chain cannot overflow the stack.
 */
export function wouldCreateCycle(edges: readonly Edge[], predecessorId: string, successorId: string): boolean {
  if (predecessorId === successorId) return true;
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.predecessorId, [...(next.get(edge.predecessorId) ?? []), edge.successorId]);
  const seen = new Set<string>();
  const stack = [successorId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === predecessorId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const following of next.get(current) ?? []) if (!seen.has(following)) stack.push(following);
  }
  return false;
}

/** Milestone ids in an order where every predecessor comes first; ids in a cycle are left out. */
export function topologicalOrder(ids: readonly string[], edges: readonly Edge[]): string[] {
  const incoming = new Map(ids.map((id) => [id, 0]));
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    if (!incoming.has(edge.predecessorId) || !incoming.has(edge.successorId)) continue;
    incoming.set(edge.successorId, (incoming.get(edge.successorId) ?? 0) + 1);
    next.set(edge.predecessorId, [...(next.get(edge.predecessorId) ?? []), edge.successorId]);
  }
  const queue = ids.filter((id) => incoming.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const following of next.get(id) ?? []) {
      const remaining = (incoming.get(following) ?? 0) - 1;
      incoming.set(following, remaining);
      if (remaining === 0) queue.push(following);
    }
  }
  return order;
}
