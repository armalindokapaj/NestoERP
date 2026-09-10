import type { NestoSessionUser } from "@/lib/auth/types";

declare module "next-auth" {
  /**
   * `id` and `email` are omitted because Auth.js already declares them on
   * DefaultUser; NESTO adds only the session id.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface User extends Omit<NestoSessionUser, "id" | "email"> {}

  interface Session {
    user: NestoSessionUser & { name?: string | null; image?: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    nesto?: NestoSessionUser;
  }
}

export {};
