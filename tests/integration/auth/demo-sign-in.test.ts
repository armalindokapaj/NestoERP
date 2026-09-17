import { afterAll, describe, expect, it, vi } from "vitest";

import { PRIMARY_DEMO_ACCOUNTS } from "@/config/demo-accounts";
import { signInAsDemoAccountAction } from "@/lib/actions/demo";
import { authenticateCredentials, type AuthenticatedUser } from "@/lib/auth/credentials";
import { prisma } from "../../helpers";

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

  it("refuses an account that is not a curated persona (E-06 §150)", async () => {
    const before = signedIn.length;
    await expect(signInAsDemoAccountAction("tenant-owner")).resolves.toEqual({ error: "Unknown demo account." });
    expect(signedIn).toHaveLength(before);
  });
});
