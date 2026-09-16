import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { actionsFrom, defineStateMachine, transitionFor } from "@/lib/core/state/machine";
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
      for (const state of [...transition.from, transition.to]) {
        expect(machine.states).toContain(state);
      }
    }
  });

  it.each(STATE_MACHINES.map((machine) => [machine.key, machine] as const))("%s leaves no state stranded", (_key, machine) => {
    // Every state is either reachable by some transition or is a starting
    // state the domain creates records in. A state nothing reaches and
    // nothing leaves is a state that should not be in the enum.
    for (const state of machine.states) {
      const reachable = machine.transitions.some((transition) => transition.to === state);
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
