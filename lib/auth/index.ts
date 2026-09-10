import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@/lib/database/prisma";
import { authConfig } from "./auth.config";
import { recordAuthEvent } from "./events";
import { verifyPassword } from "./password";
import { credentialsSchema } from "./schema";
import { createSession } from "./session-store";

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
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase();

        const user = await prisma.user.findUnique({
          where: { email },
          include: {
            memberships: {
              where: { status: "ACTIVE" },
              include: { company: true },
              orderBy: { createdAt: "asc" },
            },
          },
        });

        // One generic failure for every cause, so the form never reveals
        // whether an account exists (PRD #6 §8).
        if (!user) {
          await recordAuthEvent({ type: "LOGIN_FAILED", metadata: { email } });
          return null;
        }

        const passwordMatches = await verifyPassword(
          parsed.data.password,
          user.passwordHash,
        );
        if (!passwordMatches) {
          await recordAuthEvent({ type: "LOGIN_FAILED", userId: user.id });
          return null;
        }

        if (user.status !== "ACTIVE") {
          await recordAuthEvent({ type: "ACCOUNT_BLOCKED", userId: user.id });
          return null;
        }

        // No active membership means no company workspace to enter
        // (PRD #6 §48).
        const membership = user.memberships.find(
          (candidate) => candidate.company.status === "ACTIVE",
        );

        if (!membership) {
          await recordAuthEvent({ type: "MEMBERSHIP_DENIED", userId: user.id });
          return null;
        }

        const session = await createSession({
          userId: user.id,
          membershipId: membership.id,
          companyId: membership.companyId,
        });

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        await recordAuthEvent({
          type: "LOGIN_SUCCESS",
          userId: user.id,
          companyId: membership.companyId,
          sessionId: session.id,
        });

        return {
          id: user.id,
          email: user.email,
          sessionId: session.id,
        };
      },
    }),
  ],
});
