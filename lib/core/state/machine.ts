import type { Permission } from "@/config/permissions";

/**
 * The shared state machine contract (PRD #49 §54-§57, §154-§156).
 *
 * Each domain owns its machine — there is deliberately no generic state table
 * and no workflow engine (§8, §54). What is shared is the *shape*: a domain
 * declares which action moves a record from which states to which state, what
 * permission it needs and whether it needs a reason, and that declaration is
 * the only place those rules live. The API validator, the action menu and the
 * transition itself all read it, so they cannot disagree (§157, §159).
 *
 * The declaration is data, not code, so it can also be read by the gate that
 * checks every controlled write goes through a transition (§276) and by the
 * documentation generator (§294).
 */

export type TransitionDefinition<S extends string, A extends string> = {
  action: A;
  /** Source states the action is legal from. Never empty. */
  from: readonly S[];
  /**
   * The state it leads to — or, where the record rather than the actor decides
   * which, the states it may lead to. Restoring from the archive returns to
   * whatever the record held before; a goods receipt leaves an order partly or
   * wholly received. The service computes which and names it; the client never
   * does (§62).
   */
  to: S | readonly S[];
  /** Any one of these lets the actor apply it — an approver's own permission, or the module-wide decide permission. */
  permission: Permission | readonly Permission[];
  /**
   * An approval chain can conclude this transition (PRD #41 §21). Whoever holds
   * the chain's current step decides it — by name, by role, or standing in for
   * either — and need not hold `permission`. The caller passes the step it
   * settled, and `applyTransition` checks that step was decided by this actor.
   * Nothing else skips the permission.
   */
  concludedByApprovalStep?: boolean;
  /** A reason the actor must supply, stored with the record and the audit event (§162, §234). */
  requiresReason?: boolean;
  /**
   * What the record may no longer change afterwards (§55). Recorded for the
   * documentation and the reviewer, not enforced here — the immutability lives
   * in the owner service, which is the only place that knows what "the amounts"
   * means for its own record.
   */
  freezes?: string;
};

export type StateMachine<S extends string, A extends string> = {
  /** Stable key used in audit events, the registry and the docs, e.g. `daily_log`. */
  key: string;
  /** The Prisma model this machine governs, in Prisma's own camelCase. */
  model: string;
  /** The column holding the state. Almost always `status`. */
  field: string;
  states: readonly S[];
  /** States nothing legal leads out of (§203). Derived, then checked against the table. */
  terminal: readonly S[];
  transitions: readonly TransitionDefinition<S, A>[];
};

export function defineStateMachine<S extends string, A extends string>(machine: StateMachine<S, A>): StateMachine<S, A> {
  const seen = new Set<string>();
  for (const transition of machine.transitions) {
    if (transition.from.length === 0) {
      throw new Error(`${machine.key}: transition "${transition.action}" has no source state`);
    }
    const targets = targetsOf(transition);
    if (targets.length === 0) {
      throw new Error(`${machine.key}: transition "${transition.action}" leads nowhere`);
    }
    if (permissionsOf(transition).length === 0) {
      throw new Error(`${machine.key}: transition "${transition.action}" names no permission`);
    }
    for (const state of [...transition.from, ...targets]) {
      if (!machine.states.includes(state)) {
        throw new Error(`${machine.key}: transition "${transition.action}" names "${state}", which is not one of its states`);
      }
    }
    // Two definitions of one action would make "which rule applies" ambiguous.
    if (seen.has(transition.action)) {
      throw new Error(`${machine.key}: action "${transition.action}" is defined twice`);
    }
    seen.add(transition.action);
  }

  // A state the table declares terminal but still leads out of is a table that
  // has drifted from what it says about itself.
  for (const state of machine.terminal) {
    const exit = machine.transitions.find((transition) => transition.from.includes(state));
    if (exit) {
      throw new Error(`${machine.key}: "${state}" is declared terminal but "${exit.action}" leads out of it`);
    }
  }
  return machine;
}

/** The transition an action names, or undefined when the machine has no such action. */
export function transitionFor<S extends string, A extends string>(machine: StateMachine<S, A>, action: A): TransitionDefinition<S, A> | undefined {
  return machine.transitions.find((transition) => transition.action === action);
}

/**
 * The actions legal from a state — what the action menu offers, and what the
 * detail page greys out rather than hides (§159, §160).
 */
export function actionsFrom<S extends string, A extends string>(machine: StateMachine<S, A>, state: S): TransitionDefinition<S, A>[] {
  return machine.transitions.filter((transition) => transition.from.includes(state));
}

/** Actions that can leave a record in a state, whatever it is in now. */
export function statesReaching<S extends string, A extends string>(machine: StateMachine<S, A>, state: S): A[] {
  return machine.transitions.filter((transition) => targetsOf(transition).includes(state)).map((transition) => transition.action);
}

/** The states a transition may lead to, as a list whether it declares one or several. */
export function targetsOf<S extends string, A extends string>(transition: TransitionDefinition<S, A>): readonly S[] {
  return typeof transition.to === "string" ? [transition.to] : (transition.to as readonly S[]);
}

/** The permissions any one of which lets an actor apply a transition. */
export function permissionsOf<S extends string, A extends string>(transition: TransitionDefinition<S, A>): readonly Permission[] {
  return typeof transition.permission === "string" ? [transition.permission] : (transition.permission as readonly Permission[]);
}

/**
 * Whether some declared transition moves a record from one state to another.
 *
 * For the older `canTransition…(from, to)` helpers a domain's UI and services
 * still ask, so they answer from the machine instead of a second table that
 * could drift from it.
 */
export function canMove<S extends string, A extends string>(machine: StateMachine<S, A>, from: S, to: S): boolean {
  return machine.transitions.some((transition) => transition.from.includes(from) && targetsOf(transition).includes(to));
}
