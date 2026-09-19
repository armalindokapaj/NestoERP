import { afterAll, describe, expect, it, vi } from "vitest";

import { ARMAAR_DEMO_ACCOUNTS, PRIMARY_DEMO_ACCOUNTS } from "@/config/demo-accounts";
import { signInAsDemoAccountAction } from "@/lib/actions/demo";
import { authenticateCredentials, type AuthenticatedUser } from "@/lib/auth/credentials";
import { prisma } from "../../helpers";
import { ARMAAR_PEOPLE, PLATFORM_ADMIN } from "../../../prisma/seed/armaar/people";

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

  it.each(ARMAAR_DEMO_ACCOUNTS.map((account) => [account.username, account.role] as const))(
    "signs in as ARMAAR's %s (%s), with ARMAAR's password",
    async (username) => {
      await expect(signInAsDemoAccountAction(username)).resolves.toBeUndefined();
      expect(signedIn.at(-1)?.username).toBe(username);
    },
  );

  it("offers ARMAAR's people as the ARMAAR seed makes them: role, position, and the company they are listed under", () => {
    const [platform, ...people] = ARMAAR_DEMO_ACCOUNTS;
    expect(platform).toMatchObject({ username: PLATFORM_ADMIN.username, role: "PLATFORM_ADMIN", section: "platform" });
    for (const account of people) {
      const person = ARMAAR_PEOPLE.find((candidate) => candidate.username === account.username);
      expect(person, account.username).toBeDefined();
      const position = account.section === "group" ? "GROUP_HEAD" : person!.manages ? "COMPANY_MANAGER" : "MEMBER";
      expect({ username: account.username, role: account.role, position: account.position }).toEqual({
        username: account.username,
        role: person!.role,
        position,
      });
      if (account.section === "group") expect(person!.company, account.username).toBe("ARLIS_ADMINISTRIM");
      if (account.section === "company") expect(person!.company, account.username).toBe("BUILDING_CONSTRUCTION_INVEST");
      if (account.section === "contractor") expect(person!.company, account.username).toBe("ARLIS_NDERTIM");
    }
    const usernames = ARMAAR_DEMO_ACCOUNTS.map((account) => account.username);
    expect(new Set([...usernames, ...PRIMARY_DEMO_ACCOUNTS.map((account) => account.username)]).size).toBe(
      usernames.length + PRIMARY_DEMO_ACCOUNTS.length,
    );
  });

  it("refuses an account that is not a curated persona (E-06 §150)", async () => {
    const before = signedIn.length;
    await expect(signInAsDemoAccountAction("tenant-owner")).resolves.toEqual({ error: "Unknown demo account." });
    expect(signedIn).toHaveLength(before);
  });
});
