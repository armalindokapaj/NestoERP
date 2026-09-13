import { CredentialsSignin } from "next-auth";

/**
 * Sign-in refused before the password was checked, because the account or the
 * address has failed too often recently (PRD #38 §17).
 *
 * Distinguishable from a wrong password on purpose: the person needs to know
 * that waiting, not retyping, is the fix. It reveals nothing about whether the
 * account exists — addresses nobody has registered are counted the same way.
 */
export class SignInRateLimited extends CredentialsSignin {
  code = "rate_limited";
}
