import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import type { StateMachine, TransitionDefinition } from "./machine";
import { transitionFor } from "./machine";

/**
 * Applying a transition (PRD #49 §58, §63-§65).
 *
 * The rule this module exists to enforce: **the state a transition is legal
 * from goes into the `where` clause, not only into an `if` above it.** A
 * service that reads a record, decides the move is legal and then writes by id
 * alone is correct only until two people act at once — Postgres takes no lock
 * on a plain read, so both callers see the old state and both write. Binding
 * the source state to the update makes the database the arbiter: the second
 * write matches no row and is told so.
 *
 * `expectedVersion` layers the *user's* view on top of that (§65). The state
 * guard asks "is this move still legal"; the version guard asks "is this the
 * record the person was looking at". A record can pass the first and fail the
 * second — edited, not moved — and that is still a conflict worth reporting.
 */

type Tx = Prisma.TransactionClient;

/** A model whose rows can be moved by this helper: identified, owned, statused. */
type StatefulDelegate = {
  updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
};

export type TransitionOutcome = "MOVED" | "ALREADY_THERE";

export type ApplyTransitionInput<S extends string, A extends string> = {
  machine: StateMachine<S, A>;
  action: A;
  id: string;
  /**
   * Who is acting. The company scopes the write, and the transition's declared
   * permission is checked against them — which is what stops that declaration
   * being decorative. Services keep their own richer checks (a self-approval
   * rule, an approval guard); this is the floor, not the whole gate.
   */
  context: UserContext;
  /** The state the caller read, used for the audit trail and the error message. */
  from: S;
  /** The row version the caller's page was rendered from, where the model carries one. */
  expectedVersion?: number;
  /** Columns the transition sets besides the state — timestamps, actor, reason. */
  data?: Record<string, unknown>;
  /**
   * The reason, where the transition requires one (§162, §234). Checked here
   * and stored by the caller: domains keep it under different names —
   * `suspensionReason`, `voidReason`, `returnReason` — and only the owner
   * service knows which column this one belongs in.
   */
  reason?: string | null;
  /**
   * Treat a record already in the target state as success rather than as a
   * conflict (§236-§240). Double-submit of an idempotent action — publish,
   * close, void — should not raise, and should not write twice either.
   */
  idempotent?: boolean;
};

/**
 * Checks the move is one the machine allows and the actor is allowed to make
 * (§57). Throws rather than returning a verdict: every caller's next step on
 * failure is the same refusal.
 */
export function assertTransitionAllowed<S extends string, A extends string>(
  machine: StateMachine<S, A>,
  input: { currentState: S; action: A; context: UserContext; reason?: string | null },
): TransitionDefinition<S, A> {
  const transition = transitionFor(machine, input.action);
  if (!transition) {
    throw new AccessError("VALIDATION_ERROR", `${machine.key} has no action "${input.action}".`);
  }
  if (!can(input.context, transition.permission)) {
    throw new AccessError("FORBIDDEN");
  }
  if (!transition.from.includes(input.currentState)) {
    // Says what is true now, never what the record holds (§63).
    throw new AccessError("CONFLICT", illegalMessage(machine, transition, input.currentState), {
      code: `${machine.key.toUpperCase()}_ILLEGAL_TRANSITION`,
      state: input.currentState,
      action: input.action,
    });
  }
  if (transition.requiresReason && !input.reason?.trim()) {
    throw new AccessError("VALIDATION_ERROR", "Give a reason for this change.", { field: "reason" });
  }
  return transition;
}

/**
 * The guarded write. Returns `ALREADY_THERE` only for an idempotent replay;
 * every other missed row is a conflict, because the record moved under the
 * caller between the read and the write.
 */
export async function applyTransition<S extends string, A extends string>(
  tx: Tx,
  input: ApplyTransitionInput<S, A>,
): Promise<TransitionOutcome> {
  const { machine, action, id, context, from, expectedVersion, data = {}, reason } = input;
  const companyId = context.companyId;
  const transition = transitionFor(machine, action);
  if (!transition) throw new AccessError("VALIDATION_ERROR", `${machine.key} has no action "${action}".`);

  if (!can(context, transition.permission)) throw new AccessError("FORBIDDEN");

  // The move has to be legal from where the caller found the record. Checked
  // before the write so an illegal transition is named as one, rather than
  // arriving as "somebody else moved it".
  if (!transition.from.includes(from)) {
    throw new AccessError("CONFLICT", illegalMessage(machine, transition, from), {
      code: `${machine.key.toUpperCase()}_ILLEGAL_TRANSITION`,
      state: from,
      action,
    });
  }

  const delegate = (tx as unknown as Record<string, StatefulDelegate>)[machine.model];
  if (!delegate) throw new Error(`${machine.key}: no Prisma delegate named "${machine.model}"`);

  const where: Record<string, unknown> = {
    id,
    companyId,
    // The guard (§64), and the reason it is the state the caller *read* rather
    // than every state the action is legal from: two people who both open an
    // OPEN hazard and both control it are each making a legal move, and
    // guarding on the legal set would let the second overwrite the first
    // without either being told. The caller's own state is what their decision
    // was based on, so that is what the write is conditional on.
    [machine.field]: from,
  };
  if (expectedVersion !== undefined) where.version = expectedVersion;

  if (transition.requiresReason && !reason?.trim()) {
    throw new AccessError("VALIDATION_ERROR", "Give a reason for this change.", { field: "reason" });
  }

  const payload: Record<string, unknown> = { ...data, [machine.field]: transition.to };
  if (expectedVersion !== undefined) payload.version = { increment: 1 };

  const moved = await delegate.updateMany({ where, data: payload });
  if (moved.count > 0) {
    incrementCounter(Metric.TRANSITION_APPLIED, { machine: machine.key, action });
    return "MOVED";
  }

  // Nothing moved. Either the action already happened — which for an
  // idempotent action is the outcome the caller wanted — or somebody else
  // moved the record first.
  if (input.idempotent) {
    const settled = await countIn(tx, machine, { id, companyId, state: transition.to });
    if (settled > 0) {
      incrementCounter(Metric.TRANSITION_REPLAY, { machine: machine.key, action });
      return "ALREADY_THERE";
    }
  }

  incrementCounter(Metric.TRANSITION_CONFLICT, { machine: machine.key, action });
  throw new AccessError("CONFLICT", staleMessage(machine, from), {
    code: `${machine.key.toUpperCase()}_STALE`,
    action,
  });
}

async function countIn<S extends string, A extends string>(
  tx: Tx,
  machine: StateMachine<S, A>,
  target: { id: string; companyId: string; state: string },
): Promise<number> {
  const delegate = (tx as unknown as Record<string, { count: (args: { where: Record<string, unknown> }) => Promise<number> }>)[machine.model];
  return delegate.count({ where: { id: target.id, companyId: target.companyId, [machine.field]: target.state } });
}

function illegalMessage<S extends string, A extends string>(machine: StateMachine<S, A>, transition: TransitionDefinition<S, A>, current: S): string {
  return `This ${label(machine)} is ${humanise(current)}, so it cannot be ${pastTense(transition.action)}.`;
}

function staleMessage<S extends string, A extends string>(machine: StateMachine<S, A>, from: S): string {
  return `This ${label(machine)} changed since you opened it — it is no longer ${humanise(from)}. Reload to see the latest.`;
}

function label(machine: { key: string }): string {
  return machine.key.replace(/_/g, " ");
}

function humanise(state: string): string {
  return state.toLowerCase().replace(/_/g, " ");
}

function pastTense(action: string): string {
  const word = action.replace(/_/g, " ");
  if (word.endsWith("e")) return `${word}d`;
  return `${word}ed`;
}
