import type { NextAuthConfig } from "next-auth";

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
    maxAge: 60 * 60 * 8, // an eight-hour working day
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        // `user` is the object returned by authorize() on sign-in.
        token.nesto = {
          id: user.id as string,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email as string,
          avatar: user.avatar ?? null,
          role: user.role,
          companyId: user.companyId,
          companyName: user.companyName,
          companySlug: user.companySlug,
          companyLogo: user.companyLogo ?? null,
          department: user.department ?? null,
          jobTitle: user.jobTitle ?? null,
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
