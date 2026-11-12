import { describe, expect, it } from "vitest";

import { CREATE_DIAL, DIAL_SIZE, dialActions } from "@/config/create-dial";
import { QUICK_CREATE_ACTIONS, QUICK_CREATE_BY_KEY } from "@/config/quick-create";
import { roleModuleAccess } from "@/config/role-defaults";
import type { RoleKey } from "@/config/roles";

/**
 * The desktop Create dial (docs/ui/UI-06-create-dial.md): five things each
 * user type makes most, in its order; the server's eligibility decides which
 * of them a person actually gets.
 */
const held = (role: RoleKey) => new Set<string>(Object.values(roleModuleAccess[role] ?? {}).flatMap((access) => access.permissions));
const everything = QUICK_CREATE_ACTIONS.map((action) => action.key);

describe("each user type's five", () => {
  for (const [role, keys] of Object.entries(CREATE_DIAL) as [RoleKey, readonly string[]][]) {
    it(`${role}: real Quick Create actions, at most five, none twice, each one the role may create`, () => {
      expect(keys.length).toBeLessThanOrEqual(DIAL_SIZE);
      expect(new Set(keys).size).toBe(keys.length);
      const grants = held(role);
      for (const key of keys) {
        const action = QUICK_CREATE_BY_KEY.get(key);
        expect(action, key).toBeDefined();
        expect(grants.has(action!.permission), `${role} holds ${action!.permission}`).toBe(true);
      }
    });
  }

  it("gives the read-only and the platform's people none", () => {
    expect(CREATE_DIAL.VIEWER).toEqual([]);
    expect(CREATE_DIAL.PLATFORM_ADMIN).toEqual([]);
  });
});

describe("a person's dial", () => {
  it("is the role's five, in the role's order, when all may be created", () => {
    expect(dialActions("SALES", everything)).toEqual(CREATE_DIAL.SALES);
    expect(dialActions("HSE", everything)).toEqual(CREATE_DIAL.HSE);
  });

  it("leaves out what this person may not create here, and fills up from what they may", () => {
    const eligible = everything.filter((key) => key !== "sales.proposal.create");
    const dial = dialActions("SALES", eligible);
    expect(dial).not.toContain("sales.proposal.create");
    expect(dial).toHaveLength(DIAL_SIZE);
    expect(dial.slice(0, 4)).toEqual(CREATE_DIAL.SALES.filter((key) => key !== "sales.proposal.create"));
  });

  it("never offers more than five, nor anything not eligible", () => {
    const eligible = ["tasks.task.create", "meetings.meeting.create"];
    expect(dialActions("FINANCE", eligible)).toEqual(["tasks.task.create", "meetings.meeting.create"]);
    expect(dialActions("OWNER", everything)).toHaveLength(DIAL_SIZE);
  });

  it("is empty for someone who may create nothing", () => {
    expect(dialActions("CEO", [])).toEqual([]);
  });
});
