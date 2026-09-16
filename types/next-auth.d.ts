import type { NestoSessionUser } from "@/lib/auth/types";

declare module "next-auth" {
  /**
   * `id` is omitted because Auth.js already declares it on DefaultUser; NESTO
   * adds the username it signed in with and the session id. Auth.js's own
   * `email` field stays unused — an address is not an identifier here
   * (PRD #50 §6, §66).
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface User extends Omit<NestoSessionUser, "id"> {}

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
