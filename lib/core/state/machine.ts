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
  to: S;
  permission: Permission;
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
    for (const state of [...transition.from, transition.to]) {
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

/** States an action can reach a record in, whatever it is in now. */
export function statesReaching<S extends string, A extends string>(machine: StateMachine<S, A>, state: S): A[] {
  return machine.transitions.filter((transition) => transition.to === state).map((transition) => transition.action);
}
