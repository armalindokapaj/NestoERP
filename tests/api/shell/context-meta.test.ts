import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { GET as activityList } from "@/app/api/activity-center/route";
import { GET as activityCount } from "@/app/api/activity-center/unread-count/route";
import { GET as search } from "@/app/api/search/route";
import { GET as searchHome } from "@/app/api/search/home/route";
import { resolveShellCore } from "@/lib/workspace/shell-core";
import { actAs } from "@/tests/security/harness/actor";
import { cleanupSessions, loginAs, prisma } from "@/tests/helpers";

vi.mock("@/lib/context/resolve-user-context", () => import("@/tests/security/harness/actor"));

/**
 * Context metadata on the answers the shell's controllers keep (NAV-03
 * RUNTIME-02, §12): each carries the shell's own key for the same session,
 * next to its unchanged payload, and another workspace gets another key.
 */

afterEach(() => actAs(null));
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function answers() {
  const responses = await Promise.all([
    searchHome(),
    activityCount(),
    activityList(new Request("http://localhost/api/activity-center?type=ALL&limit=10")),
    search(new Request("http://localhost/api/search?q=riverside&limit=20")),
  ]);
  return Promise.all(responses.map(async (response) => ({ status: response.status, body: (await response.json()) as { data?: unknown; results?: unknown; meta?: { contextKey?: string } } })));
}

describe("context metadata (NAV-03 §12)", () => {
  it("matches the shell's key for the same session, and keeps the payload where it was", async () => {
    for (const [role, workspace] of [["PROJECT_MANAGER", undefined], ["OWNER", "GROUP"]] as const) {
      const context = await loginAs(role, workspace ? { workspace } : undefined);
      actAs(context);
      const core = await resolveShellCore(context);
      const [home, count, list, found] = await answers();
      for (const answer of [home, count, list, found]) {
        expect(answer.status, role).toBe(200);
        expect(answer.body.meta?.contextKey, role).toBe(core.contextKey);
      }
      expect(home.body.data).toHaveProperty("favorites");
      expect(count.body.data).toHaveProperty("total");
      expect(list.body.data).toHaveProperty("items");
      expect(found.body).toHaveProperty("results");
    }
  });

  it("differs once the workspace is another", async () => {
    const inCompany = await loginAs("OWNER");
    actAs(inCompany);
    const [companyAnswer] = await answers();
    const inGroup = await loginAs("OWNER", { workspace: "GROUP" });
    actAs(inGroup);
    const [groupAnswer] = await answers();
    expect(companyAnswer.body.meta?.contextKey).toBeTruthy();
    expect(groupAnswer.body.meta?.contextKey).not.toBe(companyAnswer.body.meta?.contextKey);
  });
});
