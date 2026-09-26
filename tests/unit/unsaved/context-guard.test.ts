import { describe, expect, it } from "vitest";

import { identityKeys } from "@/lib/context/identity-key";
import { isStaleWorkspace, StaleWorkspaceError } from "@/lib/context/tab-workspace";
import type { UserContext } from "@/lib/context/types";
import { isStaleWorkspaceRefusal, STALE_WORKSPACE_DIGEST } from "@/lib/unsaved/outcome";

/**
 * AUD-03 §7 — the stale-context guard and the identity keys. The header can
 * only make a request fail: absent, it changes nothing.
 */

function contextIn(scopeType: "GROUP" | "COMPANY", companyId: string | null) {
  return { workspace: { parentGroupId: "group_1", scopeType, companyId } } as unknown as UserContext;
}

describe("stale workspace", () => {
  it("is stale only when the tab said which workspace it rendered and it is another one", () => {
    const company = contextIn("COMPANY", "company_a");
    expect(isStaleWorkspace(company, null)).toBe(false);
    expect(isStaleWorkspace(company, "")).toBe(false);
    expect(isStaleWorkspace(company, "COMPANY:company_a")).toBe(false);
    expect(isStaleWorkspace(company, "COMPANY:company_b")).toBe(true);
    expect(isStaleWorkspace(company, "GROUP:group_1")).toBe(true);
    expect(isStaleWorkspace(contextIn("GROUP", null), "GROUP:group_1")).toBe(false);
  });

  it("travels as a definite refusal the form can recognise", () => {
    const error = new StaleWorkspaceError();
    expect(error.digest).toBe(STALE_WORKSPACE_DIGEST);
    expect(isStaleWorkspaceRefusal(error)).toBe(true);
  });
});

describe("identity keys", () => {
  it("are stable, opaque and separate the person from the sign-in", () => {
    const first = identityKeys({ userId: "user_1", sessionId: "session_1" });
    expect(identityKeys({ userId: "user_1", sessionId: "session_1" })).toEqual(first);
    expect(identityKeys({ userId: "user_1", sessionId: "session_2" }).user).toBe(first.user);
    expect(identityKeys({ userId: "user_1", sessionId: "session_2" }).session).not.toBe(first.session);
    expect(identityKeys({ userId: "user_2", sessionId: "session_1" }).user).not.toBe(first.user);
    expect(JSON.stringify(first)).not.toMatch(/user_1|session_1/);
  });
});
