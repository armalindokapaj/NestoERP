import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "./auth.config";
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
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials, request) {
        return authenticateCredentials(rawCredentials, request?.headers);
      },
    }),
  ],
});
