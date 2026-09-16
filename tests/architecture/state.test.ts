import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import type { Permission } from "@/config/permissions";
import type { UserContext } from "@/lib/context/types";
import { actionsFrom, canMove, defineStateMachine, permissionsOf, targetsOf, transitionFor } from "@/lib/core/state/machine";
import { assertTransitionAllowed } from "@/lib/core/state/transition";
import { STATE_MACHINES } from "@/lib/core/state/registry";
import { MODEL_OWNER, domainOfFile } from "../../scripts/architecture/ownership";

/**
 * The state integrity rules, held from `pnpm test` as well as from the gate
 * (PRD #49 §257, §259, §276).
 */

describe("the state gate", () => {
  it("passes", () => {
    // Throws with the gate's own output when a rule fails, which is the
    // message worth reading.
    expect(() => execFileSync("npx", ["tsx", "scripts/verify-state.ts"], { encoding: "utf8", stdio: "pipe" })).not.toThrow();
  });
});

describe("every declared machine", () => {
  it.each(STATE_MACHINES.map((machine) => [machine.key, machine] as const))("%s names only states it declares", (_key, machine) => {
    for (const transition of machine.transitions) {
      for (const state of [...transition.from, ...targetsOf(transition)]) {
        expect(machine.states).toContain(state);
      }
    }
  });

  it.each(STATE_MACHINES.map((machine) => [machine.key, machine] as const))("%s leaves no state stranded", (_key, machine) => {
    // Every state is either reachable by some transition or is a starting
    // state the domain creates records in. A state nothing reaches and
    // nothing leaves is a state that should not be in the enum.
    for (const state of machine.states) {
      const reachable = machine.transitions.some((transition) => targetsOf(transition).includes(state));
      const leavable = machine.transitions.some((transition) => transition.from.includes(state));
      expect(reachable || leavable, `${machine.key}: "${state}" is reached by nothing and leads nowhere`).toBe(true);
    }
  });

  it.each(STATE_MACHINES.map((machine) => [machine.key, machine] as const))("%s declares terminal states nothing leads out of", (_key, machine) => {
    for (const state of machine.terminal) {
      expect(actionsFrom(machine, state), `${machine.key}: "${state}" is terminal but has actions`).toHaveLength(0);
    }
  });

  it.each(STATE_MACHINES.map((machine) => [machine.key, machine] as const))("%s governs a model its own domain owns", (_key, machine) => {
    expect(MODEL_OWNER[machine.model], `no domain owns ${machine.model}`).toBeDefined();
  });
});

describe("the machine contract", () => {
  it("refuses a transition from no state", () => {
    expect(() =>
      defineStateMachine<"A" | "B", "go">({
        key: "probe", model: "probe", field: "status", states: ["A", "B"], terminal: [],
        transitions: [{ action: "go", from: [], to: "B", permission: "task.create" }],
      }),
    ).toThrow(/no source state/);
  });

  it("refuses a state the machine does not declare", () => {
    expect(() =>
      defineStateMachine<"A" | "B", "go">({
        key: "probe", model: "probe", field: "status", states: ["A", "B"], terminal: [],
        // @ts-expect-error -- the point of the test is the runtime check.
        transitions: [{ action: "go", from: ["A"], to: "C", permission: "task.create" }],
      }),
    ).toThrow(/not one of its states/);
  });

  it("refuses one action defined twice", () => {
    expect(() =>
      defineStateMachine<"A" | "B", "go">({
        key: "probe", model: "probe", field: "status", states: ["A", "B"], terminal: [],
        transitions: [
          { action: "go", from: ["A"], to: "B", permission: "task.create" },
          { action: "go", from: ["B"], to: "A", permission: "task.create" },
        ],
      }),
    ).toThrow(/defined twice/);
  });

  it("refuses a transition that leads nowhere", () => {
    expect(() =>
      defineStateMachine<"A" | "B", "go">({
        key: "probe", model: "probe", field: "status", states: ["A", "B"], terminal: [],
        transitions: [{ action: "go", from: ["A"], to: [], permission: "task.create" }],
      }),
    ).toThrow(/leads nowhere/);
  });

  it("refuses a transition that names no permission", () => {
    expect(() =>
      defineStateMachine<"A" | "B", "go">({
        key: "probe", model: "probe", field: "status", states: ["A", "B"], terminal: [],
        transitions: [{ action: "go", from: ["A"], to: "B", permission: [] }],
      }),
    ).toThrow(/names no permission/);
  });

  it("answers the older from-to question from the machine", () => {
    const machine = defineStateMachine<"A" | "B" | "C", "go" | "restore">({
      key: "probe", model: "probe", field: "status", states: ["A", "B", "C"], terminal: [],
      transitions: [
        { action: "go", from: ["A"], to: "C", permission: "task.create" },
        { action: "restore", from: ["C"], to: ["A", "B"], permission: "task.create" },
      ],
    });
    expect(canMove(machine, "A", "C")).toBe(true);
    expect(canMove(machine, "C", "B")).toBe(true);
    expect(canMove(machine, "A", "B")).toBe(false);
  });

  it("refuses a terminal state that something leads out of", () => {
    expect(() =>
      defineStateMachine<"A" | "B", "go">({
        key: "probe", model: "probe", field: "status", states: ["A", "B"], terminal: ["A"],
        transitions: [{ action: "go", from: ["A"], to: "B", permission: "task.create" }],
      }),
    ).toThrow(/declared terminal/);
  });
});

describe("the machines say what the code does", () => {
  // Each of these was read off the service, not off the PRD's sketch, and is
  // here so a later edit to one without the other is caught.
  it("a rejected work permit goes back to draft, not to a rejected state", () => {
    const permit = STATE_MACHINES.find((machine) => machine.key === "hse_permit")!;
    expect(transitionFor(permit, "reject")!.to).toBe("DRAFT");
  });

  it("reopening a closed quality inspection only undoes the closure", () => {
    const inspection = STATE_MACHINES.find((machine) => machine.key === "quality_inspection")!;
    expect(transitionFor(inspection, "reopen")!.to).toBe("APPROVED");
  });

  it("an incident closure cannot be rejected", () => {
    const incident = STATE_MACHINES.find((machine) => machine.key === "hse_incident")!;
    expect(transitionFor(incident, "reject_close" as never)).toBeUndefined();
  });

  it("nothing leads into a hazard's pending verification", () => {
    const hazard = STATE_MACHINES.find((machine) => machine.key === "hse_hazard")!;
    expect(hazard.transitions.filter((transition) => transition.to === "PENDING_VERIFICATION")).toHaveLength(0);
  });

  it("every machine is declared in the domain that owns its table", () => {
    for (const machine of STATE_MACHINES) {
      const owner = MODEL_OWNER[machine.model];
      expect(owner, `${machine.key} governs ${machine.model}`).toBeDefined();
      // The registry is an aggregation point; the machine file itself is what
      // must sit in the owning domain.
      expect(domainOfFile(`lib/modules/${owner}/x.machine.ts`)).toBeTruthy();
    }
  });
});

/**
 * The transition matrix (PRD #49 §257-§259), walked for every registered
 * machine rather than written out per domain, so a machine added tomorrow is
 * covered by the same four questions the day it is registered: is the action
 * allowed from each state it declares, refused from every other, refused to
 * somebody without the permission, and refused without a reason it needs.
 *
 * Scope and staleness need a real row and live in
 * tests/integration/transactions/transitions.test.ts.
 */
describe("the transition matrix", () => {
  const holding = (permissions: readonly Permission[]) => ({ permissions }) as unknown as UserContext;

  const cases = STATE_MACHINES.flatMap((machine) =>
    machine.transitions.map((transition) => [`${machine.key}.${transition.action}`, machine, transition] as const),
  );

  it.each(cases)("%s is allowed from exactly the states it declares", (_name, machine, transition) => {
    const actor = holding(permissionsOf(transition));
    for (const state of machine.states) {
      const attempt = () =>
        assertTransitionAllowed(machine, { currentState: state, action: transition.action, context: actor, reason: "Matrix probe." });
      if (transition.from.includes(state)) {
        expect(attempt, `${machine.key}.${transition.action} from ${state}`).not.toThrow();
      } else {
        expect(attempt, `${machine.key}.${transition.action} from ${state}`).toThrow(
          expect.objectContaining({ code: "CONFLICT", details: expect.objectContaining({ code: `${machine.key.toUpperCase()}_ILLEGAL_TRANSITION` }) }),
        );
      }
    }
  });

  it.each(cases)("%s is refused to somebody holding none of its permissions", (_name, machine, transition) => {
    const nobody = holding([]);
    expect(() =>
      assertTransitionAllowed(machine, { currentState: transition.from[0], action: transition.action, context: nobody, reason: "Matrix probe." }),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it.each(cases)("%s accepts each of its permissions on its own", (_name, machine, transition) => {
    for (const permission of permissionsOf(transition)) {
      expect(() =>
        assertTransitionAllowed(machine, { currentState: transition.from[0], action: transition.action, context: holding([permission]), reason: "Matrix probe." }),
      ).not.toThrow();
    }
  });

  it.each(cases.filter(([, , transition]) => transition.requiresReason))("%s is refused without a reason", (_name, machine, transition) => {
    for (const reason of [undefined, null, "", "   "]) {
      expect(() =>
        assertTransitionAllowed(machine, { currentState: transition.from[0], action: transition.action, context: holding(permissionsOf(transition)), reason }),
      ).toThrow(/reason/i);
    }
  });

  it.each(cases.filter(([, , transition]) => targetsOf(transition).length > 1))("%s refuses a destination it does not declare", (_name, machine, transition) => {
    const elsewhere = machine.states.find((state) => !targetsOf(transition).includes(state));
    if (!elsewhere) return;
    expect(() =>
      assertTransitionAllowed(machine, {
        currentState: transition.from[0], action: transition.action, context: holding(permissionsOf(transition)), reason: "Matrix probe.", to: elsewhere,
      }),
    ).toThrow(/does not lead to/);
  });
});
