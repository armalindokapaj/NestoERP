import type { NestoSessionUser } from "@/lib/auth/types";

declare module "next-auth" {
  /**
   * `id` and `email` are omitted because Auth.js declares them as optional on
   * DefaultUser; NESTO always has them and reads them from NestoSessionUser.
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
