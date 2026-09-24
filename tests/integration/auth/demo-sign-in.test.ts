import { afterAll, describe, expect, it, vi } from "vitest";

import { PRIMARY_DEMO_ACCOUNTS } from "@/config/demo-accounts";
import { roles } from "@/config/roles";
import { signInAsDemoAccountAction } from "@/lib/actions/demo";
import { demoRosters, listDemoTenants } from "@/lib/auth/demo-tenants";
import { authenticateCredentials, type AuthenticatedUser } from "@/lib/auth/credentials";
import { resolveContextForSession } from "@/lib/context/build-context";
import { prisma } from "../../helpers";
import { ARMAAR_PEOPLE, COMPANY_PEOPLE, GROUP_PEOPLE, personOf } from "../../../prisma/seed/armaar/people";
import { COMPANY_FACTS } from "../../../prisma/seed/armaar/public-facts";

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
    expect(tenants.map((tenant) => tenant.name)).toEqual(["ARMAAR GROUP"]);
    const [armaar] = tenants;
    const nameOf = (username: string) => {
      const person = personOf(username)!;
      return `${person.firstName} ${person.lastName}`;
    };
    expect(armaar.heads[0]).toEqual({ username: "armaar.owner", name: "Armand Lilo", role: "OWNER", title: "Group Owner" });
    expect(armaar.heads.map((head) => head.username).sort()).toEqual(GROUP_PEOPLE.map((person) => person.username).sort());
    // The busiest company first: ARLIS - NDERTIM runs five of the group's projects.
    expect(armaar.companies[0].name).toBe("ARLIS - NDERTIM");
    expect(armaar.companies[0].personas[0]).toEqual({ username: "arlis.director", name: nameOf("arlis.director"), role: "CEO", title: "Company Director" });
    const bci = armaar.companies.find((company) => company.name === "BUILDING CONSTRUCTION INVEST")!;
    expect(bci.personas[0]).toEqual({ username: "bci.director", name: nameOf("bci.director"), role: "CEO", title: "Company Director" });
    expect(bci.personas).toContainEqual({ username: "bci.pm", name: nameOf("bci.pm"), role: "PROJECT_MANAGER", title: "Project Manager · Tirana Lake" });
    const companyName = new Map(COMPANY_FACTS.map((fact) => [fact.code, fact.name]));
    const expected = new Map<string, string[]>();
    for (const person of COMPANY_PEOPLE) {
      const name = companyName.get(person.company)!;
      expected.set(name, [...(expected.get(name) ?? []), person.username].sort());
    }
    expect(new Map(armaar.companies.map((company) => [company.name, company.personas.map((persona) => persona.username).sort()]))).toEqual(expected);
  });

  it.each(ARMAAR_PEOPLE.map((person) => [person.username, person.role] as const))(
    "signs in as the demo tenant's %s (%s) by its username",
    async (username) => {
      await expect(signInAsDemoAccountAction(username)).resolves.toBeUndefined();
      expect(signedIn.at(-1)?.username).toBe(username);
    },
  );

  it("refuses a demo tenant's login that is no longer active", async () => {
    const before = signedIn.length;
    await prisma.user.update({ where: { username: "bci.viewer" }, data: { status: "INACTIVE" } });
    try {
      await expect(signInAsDemoAccountAction("bci.viewer")).resolves.toEqual({ error: "That demo account is not active." });
      expect((await listDemoTenants())[0].companies.flatMap((company) => company.personas).map((persona) => persona.username)).not.toContain("bci.viewer");
    } finally {
      await prisma.user.update({ where: { username: "bci.viewer" }, data: { status: "ACTIVE" } });
    }
    expect(signedIn).toHaveLength(before);
  });

  it("refuses an account that is not a curated persona (E-06 §150)", async () => {
    const before = signedIn.length;
    await expect(signInAsDemoAccountAction("tenant-owner")).resolves.toEqual({ error: "Unknown demo account." });
    // A real login of the five-company group that is no curated persona.
    await expect(signInAsDemoAccountAction("ceo-b")).resolves.toEqual({ error: "Unknown demo account." });
    expect(signedIn).toHaveLength(before);
  });

  it("gives every demo account the role its membership holds, and its own name (C-01 §6, §71)", async () => {
    expect(signedIn.length).toBe(PRIMARY_DEMO_ACCOUNTS.length + ARMAAR_PEOPLE.length);
    for (const user of signedIn) {
      const session = await prisma.session.findUniqueOrThrow({
        where: { id: user.sessionId },
        select: { user: { select: { firstName: true, lastName: true } }, membership: { select: { role: { select: { key: true } } } } },
      });
      const result = await resolveContextForSession(user.sessionId, { expectedUserId: user.id });
      // The Platform Admin's session names no membership: the platform, not a company (E-06 §19).
      if (!session.membership) {
        expect(result).toEqual({ ok: false, reason: "PLATFORM_SESSION" });
        continue;
      }
      if (!result.ok) throw new Error(`${user.username}: ${result.reason}`);
      expect({ username: user.username, role: result.context.role, name: result.context.fullName }).toEqual({
        username: user.username,
        role: session.membership.role.key,
        name: `${session.user.firstName} ${session.user.lastName}`,
      });
    }
  });

  it("offers the same people to the in-app switcher, by name (C-01 §16, §17, §41)", async () => {
    const [tenant, curated] = await demoRosters();
    expect(tenant.name).toBe("ARMAAR GROUP");
    expect(tenant.sections[0].accounts.slice(0, 1)).toEqual([{ code: roles.OWNER.code, label: roles.OWNER.label, name: "Armand Lilo", assignment: "Group Owner", username: "armaar.owner" }]);
    expect(tenant.sections.flatMap((section) => section.accounts).map((account) => account.username).sort()).toEqual(
      ARMAAR_PEOPLE.map((person) => person.username).sort(),
    );
    expect(curated.name).toBe("Five-company demo");
    const accounts = curated.sections.flatMap((section) => section.accounts);
    expect(accounts.map((account) => account.username)).toEqual(PRIMARY_DEMO_ACCOUNTS.map((account) => account.username));
    expect(accounts.every((account) => account.name.length > 0)).toBe(true);
  });
});
