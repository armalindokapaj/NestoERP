import { describe, expect, it } from "vitest";

import { diffNames, isIgnoredName, sameValues, serializeValue, type FormBaseline } from "@/lib/unsaved/form-snapshot";
import { isNextControlFlow, isStaleWorkspaceRefusal, outcomeOf, STALE_WORKSPACE_DIGEST } from "@/lib/unsaved/outcome";
import { committed } from "@/lib/forms/committed";

/**
 * AUD-03 — the semantic baseline comparison (§3 rules 2-4, UW-02) and the save
 * outcome contract (§6, UW-12).
 */

function snapshot(entries: Record<string, string[]>): FormBaseline {
  return new Map(Object.entries(entries).map(([name, values]) => [name, values.map((value) => serializeValue(value))]));
}

describe("dirty comparison", () => {
  it("an edit restored to the baseline is clean again", () => {
    const baseline = snapshot({ name: ["ACME"], city: ["Tirana"] });
    expect([...diffNames(baseline, snapshot({ name: ["ACME Ltd"], city: ["Tirana"] }))]).toEqual(["name"]);
    expect(diffNames(baseline, snapshot({ name: ["ACME"], city: ["Tirana"] })).size).toBe(0);
  });

  it("never trims, rounds or reorders: whitespace, amounts and order are meaningful", () => {
    expect(diffNames(snapshot({ note: ["a"] }), snapshot({ note: ["a "] })).size).toBe(1);
    expect(diffNames(snapshot({ amount: ["10.00"] }), snapshot({ amount: ["10"] })).size).toBe(1);
    expect(diffNames(snapshot({ "lines.amount": ["1", "2"] }), snapshot({ "lines.amount": ["2", "1"] })).size).toBe(1);
  });

  it("a row added and removed again leaves the form clean; a row added is dirty", () => {
    const baseline = snapshot({ "lines[0].amount": ["5"] });
    expect(diffNames(baseline, snapshot({ "lines[0].amount": ["5"], "lines[1].amount": [""] })).size).toBe(1);
    expect(diffNames(baseline, snapshot({ "lines[0].amount": ["5"] })).size).toBe(0);
  });

  it("a checkbox is its presence: checking and unchecking are both changes", () => {
    expect(diffNames(snapshot({}), snapshot({ notify: ["on"] })).size).toBe(1);
    expect(diffNames(snapshot({ notify: ["on"] }), snapshot({})).size).toBe(1);
  });

  it("a file is its name, size and time; the empty selection is always the same", () => {
    const empty = new File([], "");
    expect(serializeValue(empty)).toBe("f:");
    const file = new File(["abc"], "plan.pdf", { lastModified: 5 });
    expect(serializeValue(file)).toBe("f:plan.pdf:3:5");
    expect(sameValues(["f:"], [serializeValue(new File([], ""))])).toBe(true);
  });

  it("ignores Next's action fields, concurrency stamps and the tab's own plumbing", () => {
    for (const name of ["$ACTION_ID_abc", "$ACTION_REF_1", "expectedVersion", "versionUpdatedAt", "acceptDuplicate", "__workspace", ""]) {
      expect(isIgnoredName(name)).toBe(true);
    }
    expect(isIgnoredName("name")).toBe(false);
    expect(isIgnoredName("search", new Set(["search"]))).toBe(true);
  });
});

describe("save outcomes", () => {
  it("only an explicit ok is a commit; undefined proves nothing", () => {
    expect(outcomeOf({ ok: true })).toEqual({ kind: "committed", redirectTo: undefined });
    expect(outcomeOf(committed("/clients/1"))).toEqual({ kind: "committed", redirectTo: "/clients/1" });
    expect(outcomeOf(undefined)).toEqual({ kind: "unknown" });
    expect(outcomeOf(null)).toEqual({ kind: "unknown" });
  });

  it("tells refusals, conflicts, failures, decisions and unknowns apart", () => {
    expect(outcomeOf({ ok: false, error: "x", fieldErrors: { name: ["Required"] } }).kind).toBe("invalid");
    expect(outcomeOf({ ok: false, error: "Code in use" }).kind).toBe("invalid");
    expect(outcomeOf({ ok: false, error: "x", duplicates: [{}] }).kind).toBe("decision");
    expect(outcomeOf({ ok: false, error: "x", code: "TASK_VERSION_CONFLICT" }).kind).toBe("conflict");
    expect(outcomeOf({ ok: false, error: "x", code: "TASK_STATE_CONFLICT" }).kind).toBe("conflict");
    expect(outcomeOf({ ok: false, error: "x", code: "FORBIDDEN" }).kind).toBe("refused");
    expect(outcomeOf({ ok: false, error: "x", code: "WORKSPACE_CHANGED" }).kind).toBe("refused");
    expect(outcomeOf({ ok: false, error: "x", code: "TEMPORARILY_UNAVAILABLE" }).kind).toBe("failed");
    expect(outcomeOf({ ok: false, error: "x", code: "UNCONFIRMED" }).kind).toBe("unknown");
  });

  it("recognises Next's control flow and the stale-workspace refusal by digest", () => {
    expect(isNextControlFlow({ digest: "NEXT_REDIRECT;push;/x;307;" })).toBe(true);
    expect(isNextControlFlow(new Error("boom"))).toBe(false);
    expect(isStaleWorkspaceRefusal({ digest: STALE_WORKSPACE_DIGEST })).toBe(true);
    expect(isStaleWorkspaceRefusal({ digest: "123456" })).toBe(false);
  });
});
