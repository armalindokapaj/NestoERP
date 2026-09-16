import type { NextAuthConfig } from "next-auth";

import { SESSION_TTL_MS } from "./constants";

/**
 * Edge-safe half of the Auth.js configuration.
 *
 * Middleware instantiates NextAuth with only this object, so nothing here may
 * import Prisma, bcrypt or any Node-only API. The Credentials provider — which
 * does touch the database — is added in lib/auth/index.ts.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: SESSION_TTL_MS / 1000,
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        // `user` is what authorize() returned on sign-in.
        token.nesto = {
          id: user.id as string,
          username: user.username as string,
          sessionId: user.sessionId,
        };
      }
      return token;
    },
    session({ session, token }) {
      if (token.nesto) {
        session.user = { ...session.user, ...token.nesto };
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
