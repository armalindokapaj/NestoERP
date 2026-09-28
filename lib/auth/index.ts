import { cookies } from "next/headers";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "./auth.config";
import { endOwnSession } from "./session-store";
import { recordAuthEvent } from "./events";
import { authenticateCredentials } from "./credentials";

/**
 * Full Auth.js instance (Node runtime).
 *
 * Sign-in answers only "who is this person, and inside which company are they
 * operating?". Everything about what they may *do* is resolved separately by
 * resolveUserContext (PRD #6 §132).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  events: {
    async signOut(message) {
      // Auth.js's own sign-out endpoint follows the same revocation rule.
      const user = "token" in message ? message.token?.nesto : undefined;
      if (!user || typeof user !== "object" || !("id" in user) || !("sessionId" in user) || typeof user.id !== "string" || typeof user.sessionId !== "string") return;
      try {
        const ended = await endOwnSession({ sessionId: user.sessionId, userId: user.id });
        if (ended.ended) await recordAuthEvent({ type: "LOGOUT", userId: user.id, sessionId: user.sessionId, companyId: ended.companyId });
      } catch { /* The explicit logout operation reports failures; cookie removal must continue. */ }
    },
    async signIn() {
      // Only a successful new authentication lifts a local logout denial.
      (await cookies()).delete("nesto.signed-out");
    },
  },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials, request) {
        return authenticateCredentials(rawCredentials, request?.headers);
      },
    }),
  ],
});
