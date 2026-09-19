import { afterAll, describe, expect, it, vi } from "vitest";

import { PRIMARY_DEMO_ACCOUNTS } from "@/config/demo-accounts";
import { signInAsDemoAccountAction } from "@/lib/actions/demo";
import { listDemoTenants } from "@/lib/auth/demo-tenants";
import { authenticateCredentials, type AuthenticatedUser } from "@/lib/auth/credentials";
import { prisma } from "../../helpers";
import { ARVELA_PEOPLE, COMPANY_PEOPLE, GROUP_PEOPLE } from "../../../prisma/seed/arvela/people";
import { COMPANY_FACTS } from "../../../prisma/seed/arvela/public-facts";

/**
 * One-click demo sign-in (spec §65, PRD #50 §6).
 *
 * The Playwright suite runs against a production build, where the demo panel
 * is never rendered, so nothing else exercises this action. It went on sending
 * `email` after sign-in moved to usernames, and every button on the login page
 * answered "Demo account not found".
 *
 * `signIn` is replaced by the credentials check Auth.js would run, so what is
 * proven is that the action's credentials authenticate the seeded account.
 */
const signedIn: AuthenticatedUser[] = [];

vi.mock("@/lib/auth", () => ({
  signIn: async (_provider: string, credentials: Record<string, unknown>) => {
    const user = await authenticateCredentials(credentials, new Headers());
    if (!user) throw new Error("credentials refused");
    signedIn.push(user);
  },
}));

afterAll(async () => {
  await prisma.session.deleteMany({ where: { id: { in: signedIn.map((user) => user.sessionId) } } });
});

describe("demo account sign-in", () => {
  it.each(PRIMARY_DEMO_ACCOUNTS.map((account) => [account.username, account.role] as const))(
    "signs in as %s (%s) by its username",
    async (username) => {
      await expect(signInAsDemoAccountAction(username)).resolves.toBeUndefined();
      expect(signedIn.at(-1)?.username).toBe(username);
    },
  );

  it("lists a demo tenant's people from its data: the group's heads, then its companies, the busiest first (D-01 §87, §92)", async () => {
    const tenants = await listDemoTenants();
    expect(tenants.map((tenant) => tenant.name)).toEqual(["ARVELA GROUP"]);
    const [arvela] = tenants;
    expect(arvela.heads[0]).toMatchObject({ username: "arvela.owner", role: "OWNER", title: "Group Owner" });
    expect(arvela.heads.map((head) => head.username).sort()).toEqual(GROUP_PEOPLE.map((person) => person.username).sort());
    expect(arvela.companies[0].name).toBe("ARVELA INFRASTRUKTURA");
    expect(arvela.companies[0].personas[0]).toEqual({ username: "avi.director", role: "CEO", title: "Company Director" });
    expect(arvela.companies[0].personas).toContainEqual({ username: "avi.pm", role: "PROJECT_MANAGER", title: "Project Manager · Liqeni Park" });
    const nameOf = new Map(COMPANY_FACTS.map((fact) => [fact.code, fact.name]));
    const expected = new Map<string, string[]>();
    for (const person of COMPANY_PEOPLE) {
      const name = nameOf.get(person.company)!;
      expected.set(name, [...(expected.get(name) ?? []), person.username].sort());
    }
    expect(new Map(arvela.companies.map((company) => [company.name, company.personas.map((persona) => persona.username).sort()]))).toEqual(expected);
  });

  it.each(ARVELA_PEOPLE.map((person) => [person.username, person.role] as const))(
    "signs in as the demo tenant's %s (%s) by its username",
    async (username) => {
      await expect(signInAsDemoAccountAction(username)).resolves.toBeUndefined();
      expect(signedIn.at(-1)?.username).toBe(username);
    },
  );

  it("refuses a demo tenant's login that is no longer active", async () => {
    const before = signedIn.length;
    await prisma.user.update({ where: { username: "avi.viewer" }, data: { status: "INACTIVE" } });
    try {
      await expect(signInAsDemoAccountAction("avi.viewer")).resolves.toEqual({ error: "Unknown demo account." });
      expect((await listDemoTenants())[0].companies.flatMap((company) => company.personas).map((persona) => persona.username)).not.toContain("avi.viewer");
    } finally {
      await prisma.user.update({ where: { username: "avi.viewer" }, data: { status: "ACTIVE" } });
    }
    expect(signedIn).toHaveLength(before);
  });

  it("refuses an account that is not a curated persona (E-06 §150)", async () => {
    const before = signedIn.length;
    await expect(signInAsDemoAccountAction("tenant-owner")).resolves.toEqual({ error: "Unknown demo account." });
    expect(signedIn).toHaveLength(before);
  });
});
