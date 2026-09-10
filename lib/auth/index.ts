import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import type { RoleKey } from "@/config/roles";
import { prisma } from "@/lib/database/prisma";
import { authConfig } from "./auth.config";
import { credentialsSchema } from "./schema";

/**
 * Full Auth.js instance (Node runtime).
 *
 * Sign-in resolves the whole user context in one query — user, company and
 * role — matching the flow in spec §7: validate → authenticate → load user →
 * load company → load role → load permissions.
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

        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          include: {
            memberships: {
              where: { status: "ACTIVE" },
              include: { company: true },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
          },
        });

        if (!user || user.status !== "ACTIVE") return null;

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) return null;

        // A user without an active company membership has no NESTO context.
        const membership = user.memberships[0];
        if (!membership || membership.company.status !== "ACTIVE") return null;

        return {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          avatar: user.avatar,
          role: membership.role as RoleKey,
          companyId: membership.company.id,
          companyName: membership.company.name,
          companySlug: membership.company.slug,
          companyLogo: membership.company.logo,
          department: membership.department,
          jobTitle: membership.jobTitle,
        };
      },
    }),
  ],
});
