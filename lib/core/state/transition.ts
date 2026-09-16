import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { canAny } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import type { StateMachine, TransitionDefinition } from "./machine";
import { permissionsOf, targetsOf, transitionFor } from "./machine";

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
  /**
   * Which of the transition's declared destinations, where it declares more
   * than one — computed by the service from the record, never taken from the
   * client (§62). Omitted for a transition with a single destination.
   */
  to?: S;
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
   * The approval step this actor settled, when a chain concludes the
   * transition rather than the actor's own permission (PRD #41 §21). Only a
   * transition declaring `concludedByApprovalStep` accepts it, and the step
   * must have been decided by this actor.
   */
  approvalStepId?: string;
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
 *
 * An approval chain's step holder is not checked here — whether they hold the
 * step is the chain's question, answered before the write.
 */
export function assertTransitionAllowed<S extends string, A extends string>(
  machine: StateMachine<S, A>,
  input: { currentState: S; action: A; context: UserContext; reason?: string | null; to?: S },
): TransitionDefinition<S, A> {
  const transition = transitionFor(machine, input.action);
  if (!transition) {
    throw new AccessError("VALIDATION_ERROR", `${machine.key} has no action "${input.action}".`);
  }
  if (!canAny(input.context, permissionsOf(transition))) {
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
  if (input.to !== undefined) destinationOf(machine, transition, input.to);
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

  await assertAuthorised(tx, machine, transition, input);

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
  const to = destinationOf(machine, transition, input.to);

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

  const payload: Record<string, unknown> = { ...data, [machine.field]: to };
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
    const settled = await countIn(tx, machine, { id, companyId, state: to });
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

/**
 * The permission floor, or the approval step standing in for it.
 *
 * A step is accepted only where the transition declares a chain can conclude
 * it, and only once the step row says this actor decided it — so passing an id
 * is a claim the database checks, not a flag that switches the check off.
 */
async function assertAuthorised<S extends string, A extends string>(
  tx: Tx,
  machine: StateMachine<S, A>,
  transition: TransitionDefinition<S, A>,
  input: ApplyTransitionInput<S, A>,
): Promise<void> {
  if (input.approvalStepId === undefined) {
    if (!canAny(input.context, permissionsOf(transition))) throw new AccessError("FORBIDDEN");
    return;
  }
  if (!transition.concludedByApprovalStep) {
    throw new Error(`${machine.key}: "${transition.action}" is not concluded by an approval step`);
  }
  const decided = await tx.approvalStep.count({
    where: {
      id: input.approvalStepId,
      companyId: input.context.companyId,
      decidedByMemberId: input.context.membershipId,
      status: { not: "PENDING" },
    },
  });
  if (decided === 0) throw new AccessError("FORBIDDEN");
}

function destinationOf<S extends string, A extends string>(machine: StateMachine<S, A>, transition: TransitionDefinition<S, A>, chosen: S | undefined): S {
  const targets = targetsOf(transition);
  if (chosen === undefined) {
    if (targets.length === 1) return targets[0];
    throw new Error(`${machine.key}: "${transition.action}" leads to one of ${targets.join(", ")} — name which`);
  }
  if (!targets.includes(chosen)) {
    throw new Error(`${machine.key}: "${transition.action}" does not lead to ${chosen}`);
  }
  return chosen;
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
  const word = transition.action.replace(/_/g, " ");
  // "cannot be mark sented" helps nobody; a phrase is named rather than conjugated.
  if (word.includes(" ")) return `This ${label(machine)} is ${humanise(current)}, so "${word}" cannot be applied to it.`;
  return `This ${label(machine)} is ${humanise(current)}, so it cannot be ${pastTense(word)}.`;
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

const IRREGULAR: Record<string, string> = { submit: "submitted", cancel: "cancelled", commit: "committed", rework: "reworked", withdraw: "withdrawn" };

function pastTense(word: string): string {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (word.endsWith("e")) return `${word}d`;
  return `${word}ed`;
}
