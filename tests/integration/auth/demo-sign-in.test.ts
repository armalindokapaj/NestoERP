import { afterAll, describe, expect, it, vi } from "vitest";

import { COMPANY_A_USERS } from "@/config/demo-accounts";
import { signInAsDemoRoleAction } from "@/lib/actions/demo";
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
  it.each(COMPANY_A_USERS.map((account) => [account.role, account.username] as const))(
    "signs in as %s by its username",
    async (role, username) => {
      await expect(signInAsDemoRoleAction(role)).resolves.toBeUndefined();
      expect(signedIn.at(-1)?.username).toBe(username);
    },
  );
});
